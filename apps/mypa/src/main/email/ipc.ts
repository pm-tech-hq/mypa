/** IPC for the Email widget, the background sync and new-mail notifications. */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { BrowserWindow, dialog, ipcMain } from "electron";
import { simpleParser } from "mailparser";

import {
  EMAIL_IPC,
  type EmailAccount,
  type EmailAccountPatch,
  type EmailCategoryPatch,
  type EmailAction,
  type EmailDraft,
  type EmailEvent,
  type EmailFolder,
  type EmailListQuery,
  type EmailListResult,
  type EmailMessage,
  type EmailSummary,
  type NewEmailAccount,
  type NewGoogleEmailAccount,
  type SendEmailInput,
} from "../../shared/email";
import { connectGoogle, GMAIL_SCOPE } from "../calendar/google";
import * as db from "../db";
import { notify } from "../system";
import { forgetToken, rememberToken } from "./auth";
import * as imap from "./imap";
import { serversFor } from "./presets";
import { rememberPicked, sendEmail } from "./send";

const SYNC_EVERY_MS = 2 * 60_000;
/** Accounts in error are retried less often, so a wrong password doesn't get them locked. */
const RETRY_ERROR_MS = 15 * 60_000;

function emit(e: EmailEvent): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(EMAIL_IPC.event, e);
}

const emitAccounts = () => emit({ type: "accounts", accounts: db.listEmailAccounts() });

/* --------------------------------------------------------------- sync -- */

const syncing = new Map<string, Promise<void>>();
/** A check asked for while one runs: one more follows it, so nothing new is missed. */
const again = new Map<string, Promise<void>>();

/** Syncs one account's inbox; never throws (errors land on the account). */
export function syncAccount(id: string): Promise<void> {
  const running = syncing.get(id);
  if (running) {
    let next = again.get(id);
    if (!next) {
      next = running.then(() => {
        again.delete(id);
        return syncAccount(id);
      });
      again.set(id, next);
    }
    return next;
  }
  const job = (async () => {
    try {
      const { arrived, unread } = await imap.syncInbox(id);
      db.touchEmailAccountSynced(id, unread);
      const account = db.getEmailAccountSecrets(id)?.account;
      if (account?.notify && arrived.length > 0) announce(account, arrived);
    } catch (err) {
      if (db.getEmailAccountSecrets(id))
        db.setEmailAccountStatus(id, "error", err instanceof Error ? err.message : String(err));
    } finally {
      syncing.delete(id);
      emitAccounts();
      emit({ type: "mail", accountId: id });
    }
  })();
  syncing.set(id, job);
  return job;
}

function announce(account: EmailAccount, arrived: db.CachedEmail[]): void {
  const who = (m: db.CachedEmail) => m.from.name || m.from.address || "Someone";
  if (arrived.length === 1) {
    const m = arrived[0]!;
    notify({ title: who(m), body: m.subject || "(no subject)", subtitle: account.label });
  } else {
    notify({
      title: `${arrived.length} new emails · ${account.label}`,
      body: arrived
        .slice(0, 3)
        .map((m) => `${who(m)}: ${m.subject || "(no subject)"}`)
        .join("\n"),
    });
  }
}

function syncDue(): void {
  const now = Date.now();
  for (const a of db.listEmailAccounts()) {
    const since = now - (a.lastSyncedAt ?? 0);
    if (a.status !== "error" || since > RETRY_ERROR_MS) void syncAccount(a.id);
  }
}

/* ----------------------------------------------------------- accounts -- */

/** App passwords are shown in groups ("abcd efgh ijkl mnop") but have no spaces. */
const cleanPassword = (provider: EmailAccount["provider"], password: string): string =>
  provider === "imap" ? password : password.replace(/\s+/g, "");

async function addAccount(input: NewEmailAccount): Promise<EmailAccount> {
  const address = input.address.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error("Enter the full email address.");
  const password = cleanPassword(input.provider, input.password);
  if (!password) throw new Error("Enter the app password.");
  if (db.listEmailAccounts().some((a) => a.address === address))
    throw new Error(`${address} is already connected.`);
  const servers = serversFor(input);
  const id = db.createEmailAccount({
    provider: input.provider,
    label: input.label?.trim() || address,
    address,
    displayName: input.displayName?.trim() ?? "",
    password,
    ...servers,
  });
  emitAccounts();
  try {
    await imap.testLogin(id);
  } catch (err) {
    db.setEmailAccountStatus(id, "error", err instanceof Error ? err.message : String(err));
    emitAccounts();
    return db.listEmailAccounts().find((a) => a.id === id)!;
  }
  await syncAccount(id);
  return db.listEmailAccounts().find((a) => a.id === id)!;
}

/* ------------------------------------------------- Sign in with Google -- */

const GOOGLE_NO_REFRESH =
  "Google didn't return a lasting sign-in. Remove myPA under your Google Account's connected apps (myaccount.google.com/permissions), then try again.";

/** One sign-in at a time: a second click would open a second browser tab. */
let signingIn: Promise<unknown> | null = null;

/** Opens Google's sign-in in the browser; resolves with the account picked and its tokens. */
async function googleSignIn(): Promise<{ address: string; refreshToken: string; accessToken: string; expiresAt: number }> {
  if (signingIn) throw new Error("A Google sign-in is already open in your browser. Finish it there first.");
  const client = db.googleAppClient();
  if (!client)
    throw new Error("Google sign-in isn't set up in this copy of myPA. Use an app password instead.");
  const job = connectGoogle(client.clientId, client.clientSecret, `openid email ${GMAIL_SCOPE}`);
  signingIn = job;
  try {
    const t = await job;
    if (!t.scope || !t.scope.split(" ").includes(GMAIL_SCOPE))
      throw new Error(
        "Google didn't give myPA access to your email. Sign in again and tick the box that lets myPA read, send and manage your email.",
      );
    if (!t.email) throw new Error("Google didn't say which account you signed in with. Try again.");
    if (!t.refreshToken) throw new Error(GOOGLE_NO_REFRESH);
    return {
      address: t.email.toLowerCase(),
      refreshToken: t.refreshToken,
      accessToken: t.accessToken,
      expiresAt: t.expiresAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "access_denied") throw new Error("Sign-in was cancelled.", { cause: err });
    if (msg === "Sign-in timed out") throw new Error("Sign-in timed out. Try again when you're ready.", { cause: err });
    throw err;
  } finally {
    signingIn = null;
  }
}

/** Saves a fresh Google sign-in on an account and checks it works. */
async function saveGoogleSignIn(
  id: string,
  s: { refreshToken: string; accessToken: string; expiresAt: number },
): Promise<void> {
  await imap.closeAccount(id);
  db.updateEmailAccount(id, { password: s.refreshToken, auth: "google" });
  rememberToken(id, s.accessToken, s.expiresAt);
  emitAccounts();
  try {
    await imap.testLogin(id);
  } catch (err) {
    db.setEmailAccountStatus(id, "error", err instanceof Error ? err.message : String(err));
    emitAccounts();
    return;
  }
  await syncAccount(id);
}

async function addGoogleAccount(input: NewGoogleEmailAccount): Promise<EmailAccount> {
  const s = await googleSignIn();
  // already here (e.g. with an app password): switch it to the Google sign-in
  const existing = db.listEmailAccounts().find((a) => a.address === s.address);
  if (existing) {
    await saveGoogleSignIn(existing.id, s);
    return db.listEmailAccounts().find((a) => a.id === existing.id)!;
  }
  const id = db.createEmailAccount({
    provider: "gmail",
    auth: "google",
    label: input.label?.trim() || s.address,
    address: s.address,
    displayName: input.displayName?.trim() ?? "",
    password: s.refreshToken,
    ...serversFor({ provider: "gmail", address: s.address, password: "" }),
  });
  await saveGoogleSignIn(id, s);
  return db.listEmailAccounts().find((a) => a.id === id)!;
}

async function reconnectGoogle(id: string): Promise<EmailAccount[]> {
  const account = db.getEmailAccountSecrets(id)?.account;
  if (!account) throw new Error("That email account was removed.");
  const s = await googleSignIn();
  if (s.address !== account.address)
    throw new Error(`You signed in as ${s.address}, but this account is ${account.address}. Try again and pick ${account.address}.`);
  await saveGoogleSignIn(id, s);
  return db.listEmailAccounts();
}

/* --------------------------------------------------------------- list -- */

/** Where each listed message was seen, so opening it knows its folder. */
const folderOf = new Map<string, EmailFolder>();
/** Where each listed message's category is kept (see `imap.categoryKey`). */
const keyOf = new Map<string, string>();

async function list(q: EmailListQuery): Promise<EmailListResult> {
  const accounts = db
    .listEmailAccounts()
    .filter((a) => !q.accountIds || q.accountIds.includes(a.id));
  const limit = Math.min(q.limit ?? 60, 300);
  // a category is kept here, not on the server: read wide, then keep that category
  const category = q.category?.trim().toLowerCase() || null;
  const fetchLimit = category ? 300 : limit;
  const errors: EmailListResult["errors"] = [];
  const filtered = Boolean(q.search?.trim() || q.from?.trim() || q.since || q.before);
  const cachedOnly = !filtered && q.folder === "inbox";
  let total = 0;
  const lists = await Promise.all(
    accounts.map(async (a): Promise<EmailSummary[]> => {
      // the inbox is served from the cache, which the background sync keeps current
      if (cachedOnly) {
        const rows = imap.listCached(a.id, { unreadOnly: q.unreadOnly, limit: fetchLimit });
        total += q.unreadOnly ? a.unread : rows.length;
        return rows;
      }
      try {
        const res = await imap.listRemote(a.id, q.folder, {
          search: q.search,
          from: q.from,
          since: q.since,
          before: q.before,
          unreadOnly: q.unreadOnly,
          limit: fetchLimit,
        });
        total += res.total;
        return res.messages;
      } catch (err) {
        errors.push({ accountId: a.id, message: err instanceof Error ? err.message : String(err) });
        return !filtered && (q.folder === "inbox" || q.folder === "starred")
          ? imap.listCached(a.id, {
              unreadOnly: q.unreadOnly,
              flaggedOnly: q.folder === "starred",
              limit: fetchLimit,
            })
          : [];
      }
    }),
  );
  let messages = lists.flat().sort((a, b) => b.date - a.date);
  const cats = db.emailCategories(messages.map(imap.categoryKey));
  messages = messages.map((m) => ({ ...m, category: cats.get(imap.categoryKey(m)) ?? null }));
  if (category) {
    messages = messages.filter((m) => m.category?.toLowerCase() === category);
    total = messages.length;
  }
  for (const m of messages) {
    folderOf.set(m.id, m.folder);
    keyOf.set(m.id, imap.categoryKey(m));
  }
  return { messages: messages.slice(0, limit), errors, total: Math.max(total, Math.min(messages.length, limit)) };
}

/** Sorts messages into categories (or clears them). Ids are ones a list returned. */
export function setCategories(patches: EmailCategoryPatch[]): void {
  const touched = new Set<string>();
  db.setEmailCategories(
    patches.map((p) => {
      const { accountId } = imap.parseId(p.id);
      touched.add(accountId);
      const category = p.category?.trim().slice(0, 40) || null;
      return { key: keyOf.get(p.id) ?? p.id, accountId, category };
    }),
  );
  for (const accountId of touched) emit({ type: "mail", accountId });
}

/** The current category of each listed message that has one. */
export function categoriesOf(ids: string[]): Map<string, string> {
  const byKey = db.emailCategories(ids.map((id) => keyOf.get(id) ?? id));
  const out = new Map<string, string>();
  for (const id of ids) {
    const c = byKey.get(keyOf.get(id) ?? id);
    if (c) out.set(id, c);
  }
  return out;
}

/* --------------------------------------------------------------- open -- */

async function open(id: string, images: Map<string, string> | null = null): Promise<EmailMessage> {
  const folder = folderOf.get(id) ?? "inbox";
  const { message } = await imap.openMessage(id, folder, images);
  void refreshUnread(message.accountId);
  const key = imap.categoryKey(message);
  keyOf.set(id, key);
  return { ...message, category: db.emailCategories([key]).get(key) ?? null };
}

/** Updates an account's unread count after the user read or moved mail. */
async function refreshUnread(accountId: string): Promise<void> {
  try {
    db.setEmailUnread(accountId, await imap.countUnread(accountId));
    emitAccounts();
  } catch {
    /* the next sync corrects it */
  }
  emit({ type: "mail", accountId });
}

/** Downloads the remote images of a message and inlines them, at the user's request. */
async function loadImages(id: string): Promise<EmailMessage> {
  const folder = folderOf.get(id) ?? "inbox";
  const { remote } = await imap.openMessage(id, folder);
  const images = new Map<string, string>();
  const queue = remote.slice(0, 60);
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
        const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
        if (!res.ok || !type.startsWith("image/") || type.includes("svg")) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 4 * 1024 * 1024) continue;
        images.set(url, `data:${type};base64,${buf.toString("base64")}`);
      } catch {
        /* a missing image stays blank */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return open(id, images);
}

async function saveAttachment(e: Electron.IpcMainInvokeEvent, id: string, index: number): Promise<boolean> {
  const parsed = await simpleParser(await imap.fetchSource(id));
  const a = parsed.attachments[index];
  if (!a) throw new Error("That attachment isn't in the email.");
  const win = BrowserWindow.fromWebContents(e.sender);
  const name = (a.filename ?? `attachment-${index + 1}`).replace(/[\\/:*?"<>|]+/g, "_");
  const opts = { defaultPath: name };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return false;
  await writeFile(res.filePath, a.content);
  return true;
}

/* ------------------------------------------------------------ actions -- */

const OPPOSITE: Partial<Record<EmailAction, EmailAction>> = {
  read: "unread",
  unread: "read",
  star: "unstar",
  unstar: "star",
};

/**
 * Applies an action to messages from any accounts and folders (grouped per
 * mailbox). Returns how many were changed and a way to reverse it.
 */
export async function manageEmails(
  ids: string[],
  action: EmailAction,
): Promise<{ changed: number; undo: (() => Promise<void>) | null }> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const { accountId, path } = imap.parseId(id);
    const key = `${accountId}/${path}`;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const tokens: string[] = [];
  const accounts = new Set<string>();
  let changed = 0;
  for (const group of groups.values()) {
    const token = await imap.act(group, action);
    if (token) tokens.push(token);
    accounts.add(imap.parseId(group[0]!).accountId);
    changed += group.length;
  }
  // the unread count and the cached inbox follow
  for (const accountId of accounts)
    void (action === "inbox" ? syncAccount(accountId) : refreshUnread(accountId));
  const opposite = OPPOSITE[action];
  const undo = opposite
    ? async () => {
        await manageEmails(ids, opposite);
      }
    : tokens.length
      ? async () => {
          const back = new Set<string>();
          for (const t of tokens) {
            const accountId = await imap.undo(t);
            if (accountId) back.add(accountId);
          }
          await Promise.all([...back].map((a) => syncAccount(a)));
        }
      : null;
  return { changed, undo };
}

/** Undo for the widget's actions, by token. A handful is plenty: undo shows for seconds. */
const actionUndos = new Map<string, () => Promise<void>>();

function keepActionUndo(fn: () => Promise<void>): string {
  const token = randomUUID();
  actionUndos.set(token, fn);
  for (const k of [...actionUndos.keys()].slice(0, -30)) actionUndos.delete(k);
  return token;
}

/* ------------------------------------------------------------- drafts -- */

let drafts: EmailDraft[] = [];

/** Drafts written by the Assistant wait here until the user sends or dismisses them. */
export function addDraft(d: Omit<EmailDraft, "id" | "createdAt">): EmailDraft {
  const draft = { ...d, id: randomUUID(), createdAt: Date.now() };
  drafts = [draft, ...drafts].slice(0, 20);
  emit({ type: "drafts", drafts });
  return draft;
}

/* ------------------------------------------------- for the Assistant -- */

export function dismissDraftById(id: string): void {
  drafts = drafts.filter((d) => d.id !== id);
  emit({ type: "drafts", drafts });
}

export { list as listEmails, open as openEmail };

/* ------------------------------------------------------------ handlers -- */

export function registerEmailHandlers(): void {
  ipcMain.handle(EMAIL_IPC.accounts, () => db.listEmailAccounts());
  ipcMain.handle(EMAIL_IPC.addAccount, (_e, input: NewEmailAccount) => addAccount(input));
  ipcMain.handle(EMAIL_IPC.updateAccount, async (_e, id: string, patch: EmailAccountPatch) => {
    const provider = db.getEmailAccountSecrets(id)?.account.provider ?? "imap";
    const password = patch.password?.trim() ? cleanPassword(provider, patch.password) : undefined;
    db.updateEmailAccount(id, {
      label: patch.label?.trim() || undefined,
      displayName: patch.displayName?.trim(),
      notify: patch.notify,
      signature: patch.signature,
      password,
      // a typed password replaces a Google sign-in
      ...(password ? { auth: "password" as const } : {}),
    });
    if (password) {
      forgetToken(id);
      await imap.closeAccount(id);
      await syncAccount(id);
    }
    emitAccounts();
    return db.listEmailAccounts();
  });
  ipcMain.handle(EMAIL_IPC.addGoogle, (_e, input: NewGoogleEmailAccount) => addGoogleAccount(input ?? {}));
  ipcMain.handle(EMAIL_IPC.reconnectGoogle, (_e, id: string) => reconnectGoogle(id));
  ipcMain.handle(EMAIL_IPC.removeAccount, async (_e, id: string) => {
    forgetToken(id);
    await imap.closeAccount(id);
    db.deleteEmailAccount(id);
    drafts = drafts.filter((d) => d.accountId !== id);
    emitAccounts();
    return db.listEmailAccounts();
  });
  ipcMain.handle(EMAIL_IPC.syncAccount, async (_e, id: string) => {
    await syncAccount(id);
    return db.listEmailAccounts();
  });
  ipcMain.handle(EMAIL_IPC.list, (_e, q: EmailListQuery) => list(q));
  ipcMain.handle(EMAIL_IPC.open, (_e, id: string) => open(id));
  ipcMain.handle(EMAIL_IPC.loadImages, (_e, id: string) => loadImages(id));
  ipcMain.handle(EMAIL_IPC.act, async (_e, ids: string[], action: EmailAction) => {
    const { undo } = await manageEmails(ids, action);
    return { undoToken: undo ? keepActionUndo(undo) : null };
  });
  ipcMain.handle(EMAIL_IPC.undo, async (_e, token: string) => {
    const fn = actionUndos.get(token);
    if (!fn) throw new Error("That can't be undone any more.");
    actionUndos.delete(token);
    await fn();
  });
  ipcMain.handle(EMAIL_IPC.pickFiles, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = { properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[] };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? [] : rememberPicked(res.filePaths);
  });
  ipcMain.handle(EMAIL_IPC.saveAttachment, (e, id: string, index: number) => saveAttachment(e, id, index));
  ipcMain.handle(EMAIL_IPC.send, async (_e, input: SendEmailInput) => {
    await sendEmail(input);
    void syncAccount(input.accountId);
  });
  ipcMain.handle(EMAIL_IPC.setCategories, (_e, patches: EmailCategoryPatch[]) =>
    setCategories(patches),
  );
  ipcMain.handle(EMAIL_IPC.drafts, () => drafts);
  ipcMain.handle(EMAIL_IPC.dismissDraft, (_e, id: string) => {
    dismissDraftById(id);
    return drafts;
  });
}

export function startEmailSync(): void {
  // let the window come up first
  setTimeout(syncDue, 5_000);
  setInterval(syncDue, SYNC_EVERY_MS);
}
