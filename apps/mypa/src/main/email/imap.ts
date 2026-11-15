/**
 * Reading mail over IMAP. One connection per account, reused for a minute or
 * two and then closed; every operation on an account runs in turn. The inbox
 * is cached (headers only) so the widget opens instantly and works offline;
 * other folders and searches are read from the server when asked for.
 */
import { randomUUID } from "node:crypto";

import { ImapFlow, type FetchMessageObject, type MessageAddressObject } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

import type {
  EmailAction,
  EmailAddress,
  EmailFolder,
  EmailMessage,
  EmailSummary,
} from "../../shared/email";
import * as db from "../db";
import { decodePartial, findTextPart, hasAttachments, htmlToText, sanitizeHtml, snippetOf } from "./mime";
import { EmailAuthError, forgetToken, loginFor } from "./auth";
import { authHelp } from "./presets";

/** How many inbox messages are kept for each account. */
const CACHE_KEEP = 300;
/** On first sync, how many of the newest messages to fetch. */
const INITIAL = 150;
const IDLE_CLOSE_MS = 90_000;
const SNIPPET_BYTES = 2_500;

/* ------------------------------------------------------------- folders -- */

interface Folders {
  gmail: boolean;
  sent: string | null;
  archive: string | null;
  trash: string | null;
  spam: string | null;
  starred: string | null;
  /** Gmail's All Mail: where archived mail lives. */
  all: string | null;
}

async function discoverFolders(client: ImapFlow): Promise<Folders> {
  const list = await client.list();
  const by = (use: string) => list.find((f) => f.specialUse === use)?.path ?? null;
  const named = (re: RegExp) => list.find((f) => re.test(f.name))?.path ?? null;
  const gmail = list.some((f) => f.path.startsWith("[Gmail]/") || f.path.startsWith("[Google Mail]/"));
  const all = by("\\All") ?? (gmail ? named(/^all mail$/i) : null);
  return {
    gmail,
    sent: by("\\Sent") ?? named(/^sent( items| mail)?$/i),
    archive: by("\\Archive") ?? (gmail ? all : null) ?? named(/^archive$/i),
    trash: by("\\Trash") ?? named(/^(trash|deleted( items)?|bin)$/i),
    spam: by("\\Junk") ?? named(/^(spam|junk( e-?mail)?)$/i),
    starred: by("\\Flagged") ?? (gmail ? named(/^starred$/i) : null),
    all,
  };
}

/* ---------------------------------------------------------- connections -- */

interface Conn {
  client: ImapFlow | null;
  folders: Folders | null;
  closeTimer: NodeJS.Timeout | null;
  queue: Promise<unknown>;
}

const conns = new Map<string, Conn>();

export class EmailError extends Error {}

function friendly(err: unknown, accountId: string): EmailError {
  if (err instanceof EmailError) return err;
  if (err instanceof EmailAuthError) return new EmailError(err.message);
  const e = err as { authenticationFailed?: boolean; code?: string; message?: string; responseText?: string };
  const account = db.getEmailAccountSecrets(accountId)?.account;
  if (e.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(e.responseText ?? e.message ?? "")) {
    forgetToken(accountId);
    return new EmailError(authHelp(account?.provider ?? "imap", account?.auth));
  }
  if (e.code === "ENOTFOUND") return new EmailError("Couldn't find the mail server. Check the server name, or your internet connection.");
  if (e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT" || e.code === "ECONNRESET" || e.code === "NoConnection")
    return new EmailError("Couldn't reach the mail server. Check your internet connection.");
  return new EmailError(e.responseText || e.message || String(err));
}

function connFor(accountId: string): Conn {
  let c = conns.get(accountId);
  if (!c) {
    c = { client: null, folders: null, closeTimer: null, queue: Promise.resolve() };
    conns.set(accountId, c);
  }
  return c;
}

async function connect(accountId: string): Promise<ImapFlow> {
  const secrets = db.getEmailAccountSecrets(accountId);
  if (!secrets) throw new EmailError("That email account was removed.");
  const { account } = secrets;
  const login = await loginFor(secrets);
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapPort === 993,
    auth:
      login.kind === "google"
        ? { user: login.user, accessToken: login.accessToken }
        : { user: login.user, pass: login.pass },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
    clientInfo: { name: "myPA" },
  });
  // a dropped connection must not crash the app; the next call reconnects
  client.on("error", () => {
    const c = conns.get(accountId);
    if (c?.client === client) c.client = null;
  });
  await client.connect();
  return client;
}

/** Runs `fn` with the account's connection, one call at a time per account. */
export function withImap<T>(
  accountId: string,
  fn: (client: ImapFlow, folders: Folders) => Promise<T>,
): Promise<T> {
  const c = connFor(accountId);
  const next = c.queue.then(async () => {
    if (c.closeTimer) clearTimeout(c.closeTimer);
    try {
      if (!c.client || !c.client.usable) {
        c.client = await connect(accountId);
        c.folders = null;
      }
      c.folders ??= await discoverFolders(c.client);
      return await fn(c.client, c.folders);
    } catch (err) {
      // a broken connection is replaced next time; a server "NO" leaves it usable
      if (c.client && !c.client.usable) c.client = null;
      throw friendly(err, accountId);
    } finally {
      c.closeTimer = setTimeout(() => void closeAccount(accountId), IDLE_CLOSE_MS);
    }
  });
  c.queue = next.catch(() => undefined);
  return next;
}

export async function closeAccount(accountId: string): Promise<void> {
  const c = conns.get(accountId);
  if (!c) return;
  if (c.closeTimer) clearTimeout(c.closeTimer);
  const client = c.client;
  c.client = null;
  c.folders = null;
  if (client) await client.logout().catch(() => client.close());
}

/** Logs in once to check the account works (used when adding it). */
export async function testLogin(accountId: string): Promise<void> {
  await withImap(accountId, async (client) => {
    await client.noop();
  });
}

/* ---------------------------------------------------------------- ids -- */

/** `account/path/uid`: stable while the message stays in that mailbox. */
export function messageId(accountId: string, path: string, uid: number): string {
  return `${accountId}/${encodeURIComponent(path)}/${uid}`;
}

export function parseId(id: string): { accountId: string; path: string; uid: number } {
  const [accountId, path, uid] = id.split("/");
  if (!accountId || !path || !uid || !/^\d+$/.test(uid)) throw new EmailError("Unknown message.");
  return { accountId, path: decodeURIComponent(path), uid: Number(uid) };
}

/* ------------------------------------------------------------ mapping -- */

const addr = (a: MessageAddressObject | undefined): EmailAddress => ({
  name: a?.name?.trim() ?? "",
  address: a?.address?.trim().toLowerCase() ?? "",
});

function toCached(m: FetchMessageObject, snippet: string | null = null): db.CachedEmail {
  const env = m.envelope ?? {};
  const date = new Date(env.date ?? m.internalDate ?? Date.now()).getTime();
  return {
    uid: m.uid,
    from: addr(env.from?.[0] ?? env.sender?.[0]),
    to: (env.to ?? []).map(addr),
    cc: (env.cc ?? []).map(addr),
    subject: env.subject?.trim() ?? "",
    snippet,
    date: Number.isFinite(date) ? date : Date.now(),
    seen: m.flags?.has("\\Seen") ?? false,
    flagged: m.flags?.has("\\Flagged") ?? false,
    answered: m.flags?.has("\\Answered") ?? false,
    hasAttachments: hasAttachments(m.bodyStructure),
    messageId: env.messageId?.trim() || null,
  };
}

/** Where a message's category is kept: its Message-ID, which survives moves, else its id. */
export function categoryKey(m: { id: string; accountId: string; messageId: string | null }): string {
  return m.messageId ? `${m.accountId}|${m.messageId}` : m.id;
}

function toSummary(accountId: string, path: string, folder: EmailFolder, m: db.CachedEmail): EmailSummary {
  return {
    id: messageId(accountId, path, m.uid),
    accountId,
    folder,
    from: m.from,
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    snippet: m.snippet,
    date: m.date,
    seen: m.seen,
    flagged: m.flagged,
    answered: m.answered,
    hasAttachments: m.hasAttachments,
    category: null,
    messageId: m.messageId,
  };
}

const HEADER_QUERY = { uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true } as const;

/** Snippets for messages in the open mailbox, grouped so each part number is one fetch. */
async function fetchSnippets(client: ImapFlow, msgs: FetchMessageObject[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  type Group = { uids: number[]; info: Map<number, NonNullable<ReturnType<typeof findTextPart>>> };
  const groups = new Map<string, Group>();
  for (const m of msgs) {
    const part = findTextPart(m.bodyStructure);
    if (!part) {
      out.set(m.uid, "");
      continue;
    }
    const g: Group = groups.get(part.part) ?? { uids: [], info: new Map() };
    g.uids.push(m.uid);
    g.info.set(m.uid, part);
    groups.set(part.part, g);
  }
  for (const [key, g] of groups) {
    const rows = await client.fetchAll(
      g.uids,
      { uid: true, bodyParts: [{ key, start: 0, maxLength: SNIPPET_BYTES }] },
      { uid: true },
    );
    for (const r of rows) {
      const info = g.info.get(r.uid);
      const raw = r.bodyParts?.get(key) ?? [...(r.bodyParts?.values() ?? [])][0];
      if (!info || !raw) continue;
      out.set(r.uid, snippetOf(decodePartial(raw, info.encoding, info.charset), info.html));
    }
  }
  return out;
}

/* --------------------------------------------------------------- sync -- */

export interface SyncResult {
  /** New, unread messages since the last sync (empty on the first one). */
  arrived: db.CachedEmail[];
  unread: number;
}

/** Brings the cached inbox up to date: new mail, changed flags, removed mail. */
export function syncInbox(accountId: string): Promise<SyncResult> {
  return withImap(accountId, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // a reused connection keeps the inbox selected; NOOP collects what arrived since
      await client.noop();
      const box = client.mailbox;
      if (!box) throw new EmailError("Couldn't open the inbox.");
      const validity = String(box.uidValidity);
      const state = db.getEmailSyncState(accountId);
      const first = state.uidValidity !== validity;
      let lastUid = first ? 0 : state.lastUid;
      if (first) db.clearEmailMessages(accountId);

      let fresh: FetchMessageObject[] = [];
      if (box.exists > 0) {
        if (first) {
          fresh = await client.fetchAll(`${Math.max(1, box.exists - INITIAL + 1)}:*`, HEADER_QUERY);
        } else {
          // ask by UID rather than trusting the selected mailbox's UIDNEXT, which can be stale;
          // `n:*` always includes the newest message, so keep only the new ones
          fresh = (await client.fetchAll(`${lastUid + 1}:*`, HEADER_QUERY, { uid: true })).filter(
            (m) => m.uid > lastUid,
          );
        }
      }
      const rows = fresh.map((m) => toCached(m));
      db.upsertEmailMessages(accountId, rows);
      for (const m of fresh) lastUid = Math.max(lastUid, m.uid);

      // flags changed and messages gone since last time
      const cached = db.cachedEmailFlags(accountId);
      if (cached.size > 0 && !first) {
        const min = Math.min(...cached.keys());
        const current = await client.fetchAll(`${min}:*`, { uid: true, flags: true }, { uid: true });
        const present = new Set<number>();
        for (const m of current) {
          present.add(m.uid);
          const was = cached.get(m.uid);
          if (!was || !m.flags) continue;
          const now = {
            seen: m.flags.has("\\Seen"),
            flagged: m.flags.has("\\Flagged"),
            answered: m.flags.has("\\Answered"),
          };
          if (now.seen !== was.seen || now.flagged !== was.flagged || now.answered !== was.answered)
            db.setCachedEmailFlags(accountId, m.uid, now);
        }
        db.deleteCachedEmails(
          accountId,
          [...cached.keys()].filter((uid) => uid >= min && !present.has(uid)),
        );
      }
      db.pruneEmailMessages(accountId, CACHE_KEEP);
      db.setEmailSyncState(accountId, validity, lastUid);

      // previews, newest first, a batch per sync
      const missing = db.emailsMissingSnippet(accountId, 40);
      if (missing.length > 0) {
        const heads = await client.fetchAll(missing, { uid: true, bodyStructure: true }, { uid: true });
        for (const [uid, snippet] of await fetchSnippets(client, heads))
          db.setEmailSnippet(accountId, uid, snippet);
      }

      const unseen = await client.search({ seen: false }, { uid: true });
      const unread = Array.isArray(unseen) ? unseen.length : db.countUnreadEmails(accountId);
      const day = Date.now() - 86_400_000;
      const arrived = first
        ? []
        : rows
            .filter((r) => !r.seen && r.date > day)
            .map((r) => db.getCachedEmail(accountId, r.uid) ?? r);
      return { arrived, unread };
    } finally {
      lock.release();
    }
  });
}

/** Unread messages in the inbox, asked of the server. */
export function countUnread(accountId: string): Promise<number> {
  return withImap(accountId, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const found = await client.search({ seen: false }, { uid: true });
      return Array.isArray(found) ? found.length : db.countUnreadEmails(accountId);
    } finally {
      lock.release();
    }
  });
}

/* --------------------------------------------------------------- list -- */

function folderPath(f: Folders, folder: EmailFolder): string | null {
  switch (folder) {
    case "inbox":
      return "INBOX";
    case "starred":
      return f.starred;
    case "sent":
      return f.sent;
    case "archive":
      return f.archive;
    case "trash":
      return f.trash;
    case "spam":
      return f.spam;
  }
}

/** The cached inbox (or its starred/unread part). No network. */
export function listCached(
  accountId: string,
  opts: { unreadOnly?: boolean; flaggedOnly?: boolean; limit: number },
): EmailSummary[] {
  return db
    .listCachedEmails(accountId, opts)
    .map((m) => toSummary(accountId, "INBOX", opts.flaggedOnly ? "starred" : "inbox", m));
}

export interface RemoteQuery {
  search?: string;
  unreadOnly?: boolean;
  from?: string;
  since?: number;
  before?: number;
  limit: number;
}

/** A folder or a search, read from the server. `total` counts every match, not just those returned. */
export function listRemote(
  accountId: string,
  folder: EmailFolder,
  opts: RemoteQuery,
): Promise<{ messages: EmailSummary[]; total: number }> {
  const none = { messages: [], total: 0 };
  return withImap(accountId, async (client, folders) => {
    let path = folderPath(folders, folder);
    let flaggedSearch = false;
    if (!path && folder === "starred") {
      path = "INBOX";
      flaggedSearch = true;
    }
    if (!path) return none;
    const lock = await client.getMailboxLock(path);
    try {
      await client.noop();
      const box = client.mailbox;
      if (!box || box.exists === 0) return none;
      let uids: number[];
      let total = box.exists;
      const q = opts.search?.trim();
      const from = opts.from?.trim();
      if (q || from || opts.since || opts.before || opts.unreadOnly || flaggedSearch) {
        const found = await client.search(
          {
            ...(q ? { text: q } : {}),
            ...(from ? { from } : {}),
            ...(opts.since ? { since: new Date(opts.since) } : {}),
            ...(opts.before ? { before: new Date(opts.before) } : {}),
            ...(opts.unreadOnly ? { seen: false } : {}),
            ...(flaggedSearch ? { flagged: true } : {}),
          },
          { uid: true },
        );
        const all = Array.isArray(found) ? found : [];
        total = all.length;
        uids = all.sort((a, b) => b - a).slice(0, opts.limit);
        if (uids.length === 0) return { messages: [], total };
      } else {
        const start = Math.max(1, box.exists - opts.limit + 1);
        uids = (await client.fetchAll(`${start}:*`, { uid: true })).map((m) => m.uid);
      }
      const msgs = await client.fetchAll(uids, HEADER_QUERY, { uid: true });
      const snippets = await fetchSnippets(client, msgs);
      const messages = msgs
        .map((m) => toSummary(accountId, path, folder, toCached(m, snippets.get(m.uid) ?? null)))
        .sort((a, b) => b.date - a.date);
      return { messages, total };
    } finally {
      lock.release();
    }
  });
}

/* --------------------------------------------------------------- open -- */

export interface OpenedMessage {
  message: EmailMessage;
  parsed: ParsedMail;
}

const toAddrs = (v: ParsedMail["to"]): EmailAddress[] =>
  (Array.isArray(v) ? v : v ? [v] : []).flatMap((a) =>
    a.value.map((x) => ({ name: x.name ?? "", address: (x.address ?? "").toLowerCase() })),
  );

/** The last few messages opened, so replying or loading images doesn't download them again. */
const sources = new Map<string, Buffer>();

/** The raw message. */
export async function fetchSource(id: string): Promise<Buffer> {
  const hit = sources.get(id);
  if (hit) return hit;
  const source = await downloadSource(id);
  sources.set(id, source);
  while (sources.size > 6) sources.delete(sources.keys().next().value!);
  return source;
}

function downloadSource(id: string): Promise<Buffer> {
  const { accountId, path, uid } = parseId(id);
  return withImap(accountId, async (client) => {
    const lock = await client.getMailboxLock(path);
    try {
      const m = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!m || !m.source) throw new EmailError("That email isn't there any more. It may have been moved or deleted.");
      return m.source;
    } finally {
      lock.release();
    }
  });
}

/** Reads a whole message and marks it read. `images` are remote images already fetched. */
export async function openMessage(
  id: string,
  folder: EmailFolder,
  images: Map<string, string> | null = null,
): Promise<OpenedMessage & { remote: string[] }> {
  const { accountId, path, uid } = parseId(id);
  const source = await fetchSource(id);
  const parsed = await simpleParser(source, { maxHtmlLengthToParse: 3_000_000 });
  const cached = path === "INBOX" ? db.getCachedEmail(accountId, uid) : undefined;
  const html = typeof parsed.html === "string" ? sanitizeHtml(parsed.html, images) : null;
  const text = parsed.text?.trim() || (typeof parsed.html === "string" ? htmlToText(parsed.html) : "");
  const from = toAddrs(parsed.from)[0] ?? { name: "", address: "" };
  const message: EmailMessage = {
    id,
    accountId,
    folder,
    from,
    to: toAddrs(parsed.to),
    cc: toAddrs(parsed.cc),
    replyTo: toAddrs(parsed.replyTo),
    subject: parsed.subject ?? "",
    snippet: cached?.snippet ?? snippetOf(text, false),
    date: parsed.date?.getTime() ?? cached?.date ?? Date.now(),
    seen: true,
    flagged: cached?.flagged ?? false,
    answered: cached?.answered ?? false,
    hasAttachments: parsed.attachments.some((a) => a.contentDisposition !== "inline"),
    category: null,
    messageId: parsed.messageId ?? null,
    references: Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references
        ? [parsed.references]
        : [],
    text,
    html: html?.html ?? null,
    blockedImages: html?.blocked ?? 0,
    attachments: parsed.attachments
      .map((a, index) => ({
        index,
        filename: a.filename ?? `attachment-${index + 1}`,
        contentType: a.contentType,
        size: a.size,
        inline: a.contentDisposition === "inline" && Boolean(a.cid),
      }))
      .filter((a) => !a.inline)
      .map(({ inline: _inline, ...a }) => a),
  };
  await setFlags(id, { seen: true }).catch(() => undefined);
  return { message, parsed, remote: html?.remote ?? [] };
}

/* ------------------------------------------------------------ actions -- */

async function setFlags(id: string, f: { seen?: boolean; flagged?: boolean; answered?: boolean }): Promise<void> {
  const { accountId, path, uid } = parseId(id);
  await withImap(accountId, async (client) => {
    const lock = await client.getMailboxLock(path);
    try {
      const add: string[] = [];
      const remove: string[] = [];
      if (f.seen !== undefined) (f.seen ? add : remove).push("\\Seen");
      if (f.flagged !== undefined) (f.flagged ? add : remove).push("\\Flagged");
      if (f.answered !== undefined) (f.answered ? add : remove).push("\\Answered");
      if (add.length) await client.messageFlagsAdd(String(uid), add, { uid: true });
      if (remove.length) await client.messageFlagsRemove(String(uid), remove, { uid: true });
    } finally {
      lock.release();
    }
  });
  if (path === "INBOX") db.setCachedEmailFlags(accountId, uid, f);
}

export const markAnswered = (id: string) => setFlags(id, { answered: true });

interface UndoMove {
  accountId: string;
  /** Moves back from `path` (uids there) to `to`. */
  path: string;
  uids: number[];
  to: string;
  /** Gmail archive: put the Inbox label back on these X-GM-MSGIDs in All Mail. */
  gmailIds?: string[];
  expires: number;
}

const undos = new Map<string, UndoMove>();

function keepUndo(u: Omit<UndoMove, "expires">): string {
  const token = randomUUID();
  const now = Date.now();
  for (const [k, v] of undos) if (v.expires < now) undos.delete(k);
  undos.set(token, { ...u, expires: now + 10 * 60_000 });
  return token;
}

async function ensureFolder(client: ImapFlow, folders: Folders, kind: "archive" | "trash"): Promise<string> {
  const have = folders[kind];
  if (have) return have;
  const name = kind === "archive" ? "Archive" : "Trash";
  await client.mailboxCreate(name).catch(() => undefined);
  folders[kind] = name;
  return name;
}

/**
 * Applies an action to messages of one account and mailbox. Moves return an
 * undo token when the server reports where the messages went.
 */
export async function act(ids: string[], action: EmailAction): Promise<string | null> {
  if (ids.length === 0) return null;
  const parsed = ids.map(parseId);
  const { accountId, path } = parsed[0]!;
  if (parsed.some((p) => p.accountId !== accountId || p.path !== path))
    throw new EmailError("Those emails are in different mailboxes; act on them one mailbox at a time.");
  const uids = parsed.map((p) => p.uid);

  if (action === "read" || action === "unread" || action === "star" || action === "unstar") {
    const f =
      action === "read" || action === "unread"
        ? { seen: action === "read" }
        : { flagged: action === "star" };
    await withImap(accountId, async (client) => {
      const lock = await client.getMailboxLock(path);
      try {
        const flag = "seen" in f ? "\\Seen" : "\\Flagged";
        const on = "seen" in f ? f.seen : f.flagged;
        if (on) await client.messageFlagsAdd(uids, [flag], { uid: true });
        else await client.messageFlagsRemove(uids, [flag], { uid: true });
      } finally {
        lock.release();
      }
    });
    if (path === "INBOX") for (const uid of uids) db.setCachedEmailFlags(accountId, uid, f);
    return null;
  }

  const token = await withImap(accountId, async (client, folders) => {
    const lock = await client.getMailboxLock(path);
    try {
      // Gmail: archiving removes the Inbox label; the mail stays in All Mail.
      if (action === "archive" && folders.gmail) {
        const rows = await client.fetchAll(uids, { uid: true, emailId: true }, { uid: true });
        await client.messageFlagsRemove(uids, ["\\Inbox"], { uid: true, useLabels: true });
        const gmailIds = rows.map((r) => r.emailId).filter((x): x is string => Boolean(x));
        return gmailIds.length && folders.all
          ? keepUndo({ accountId, path: folders.all, uids: [], to: "INBOX", gmailIds })
          : null;
      }
      if (action === "inbox" && folders.gmail && path === folders.all) {
        await client.messageFlagsAdd(uids, ["\\Inbox"], { uid: true, useLabels: true });
        return null;
      }
      if (action === "trash" && path === folders.trash) {
        // already in the bin: delete for good
        await client.messageDelete(uids, { uid: true });
        return null;
      }
      const dest =
        action === "archive"
          ? await ensureFolder(client, folders, "archive")
          : action === "trash"
            ? await ensureFolder(client, folders, "trash")
            : "INBOX";
      if (dest === path) return null;
      const res = await client.messageMove(uids, dest, { uid: true });
      const moved = res && res.uidMap ? [...res.uidMap.values()] : [];
      return moved.length ? keepUndo({ accountId, path: dest, uids: moved, to: path }) : null;
    } finally {
      lock.release();
    }
  });
  if (path === "INBOX") db.deleteCachedEmails(accountId, uids);
  return token;
}

/** Whether a message is in its account's Trash, where deleting is for good. */
export function isInTrash(id: string): Promise<boolean> {
  const { accountId, path } = parseId(id);
  return withImap(accountId, (_client, folders) => Promise.resolve(folders.trash === path));
}

/** Reverses a move made by `act`. Returns the account whose mail changed. */
export async function undo(token: string): Promise<string | null> {
  const u = undos.get(token);
  if (!u) throw new EmailError("That can't be undone any more.");
  undos.delete(token);
  await withImap(u.accountId, async (client) => {
    const lock = await client.getMailboxLock(u.path);
    try {
      if (u.gmailIds) {
        for (const emailId of u.gmailIds) {
          const found = await client.search({ emailId }, { uid: true });
          if (Array.isArray(found) && found.length)
            await client.messageFlagsAdd(found, ["\\Inbox"], { uid: true, useLabels: true });
        }
      } else {
        await client.messageMove(u.uids, u.to, { uid: true });
      }
    } finally {
      lock.release();
    }
  });
  return u.accountId;
}

/* ---------------------------------------------------------------- sent -- */

/** Gmail files what you send by itself; other servers need a copy in Sent. */
export function saveToSent(accountId: string, raw: Buffer, messageIdHeader: string): Promise<void> {
  return withImap(accountId, async (client, folders) => {
    if (folders.gmail) return;
    const sent = folders.sent ?? "Sent";
    if (!folders.sent) {
      await client.mailboxCreate(sent).catch(() => undefined);
      folders.sent = sent;
    }
    // some servers (Zoho among them) can file it themselves; don't add a second copy
    await new Promise((r) => setTimeout(r, 2_500));
    const lock = await client.getMailboxLock(sent);
    try {
      const found = await client.search({ header: { "message-id": messageIdHeader } }, { uid: true });
      if (Array.isArray(found) && found.length > 0) return;
    } finally {
      lock.release();
    }
    await client.append(sent, raw, ["\\Seen"]);
  });
}
