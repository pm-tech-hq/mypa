/** Sending over SMTP: builds the message once, sends it, and files a copy in Sent. */
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename } from "node:path";

import { createTransport } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";

import type { PickedFile, SendEmailInput } from "../../shared/email";
import * as db from "../db";
import { forgetToken, loginFor, type Login } from "./auth";
import { EmailError, fetchSource, markAnswered, saveToSent } from "./imap";
import { authHelp } from "./presets";

const MAX_TOTAL = 25 * 1024 * 1024;

/** Files the user picked in the dialog; `send` attaches only these. */
const picked = new Map<string, { path: string; name: string; size: number }>();

export function rememberPicked(paths: string[]): PickedFile[] {
  return paths.map((path) => {
    const token = randomUUID();
    const file = { path, name: basename(path), size: statSync(path).size };
    picked.set(token, file);
    return { token, name: file.name, size: file.size };
  });
}

const splitList = (s: string | undefined): string[] =>
  (s ?? "")
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function checkAddresses(list: string[], field: string): void {
  for (const a of list) {
    const m = /<([^>]+)>\s*$/.exec(a);
    if (!EMAIL_RE.test((m ? m[1]! : a).trim()))
      throw new EmailError(`“${a}” in ${field} isn't an email address.`);
  }
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const secrets = db.getEmailAccountSecrets(input.accountId);
  if (!secrets) throw new EmailError("That email account was removed.");
  const { account } = secrets;
  let login: Login;
  try {
    login = await loginFor(secrets);
  } catch (err) {
    throw new EmailError(err instanceof Error ? err.message : String(err));
  }

  const to = splitList(input.to);
  const cc = splitList(input.cc);
  const bcc = splitList(input.bcc);
  if (to.length + cc.length + bcc.length === 0) throw new EmailError("Add someone to send it to.");
  checkAddresses(to, "To");
  checkAddresses(cc, "Cc");
  checkAddresses(bcc, "Bcc");

  const attachments: { filename: string; path?: string; content?: Buffer; contentType?: string }[] = [];
  let total = 0;
  for (const token of input.files ?? []) {
    const f = picked.get(token);
    if (!f) throw new EmailError("An attachment is no longer available. Attach it again.");
    total += f.size;
    attachments.push({ filename: f.name, path: f.path });
  }

  let inReplyTo: string | undefined;
  let references: string[] | undefined;
  if (input.replyToId) {
    const orig = await simpleParser(await fetchSource(input.replyToId));
    if (orig.messageId) {
      inReplyTo = orig.messageId;
      const refs = Array.isArray(orig.references)
        ? orig.references
        : orig.references
          ? [orig.references]
          : [];
      references = [...refs, orig.messageId];
    }
  }
  if (input.forwardOfId && !input.dropAttachments) {
    const orig = await simpleParser(await fetchSource(input.forwardOfId));
    for (const a of orig.attachments) {
      if (a.contentDisposition === "inline" && a.cid) continue;
      total += a.size;
      attachments.push({
        filename: a.filename ?? "attachment",
        content: a.content,
        contentType: a.contentType,
      });
    }
  }
  if (total > MAX_TOTAL) throw new EmailError("Attachments are over 25 MB, more than most mail servers accept.");

  const node = new MailComposer({
    from: { name: account.displayName || account.address, address: account.address },
    to,
    cc,
    bcc,
    subject: input.subject,
    text: input.text,
    inReplyTo,
    references,
    attachments,
  }).compile();
  const raw = await node.build();
  const envelope = node.getEnvelope();
  const messageIdHeader = node.messageId();

  const transport = createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpPort === 465,
    requireTLS: account.smtpPort !== 465,
    auth:
      login.kind === "google"
        ? { type: "OAuth2", user: login.user, accessToken: login.accessToken }
        : { user: login.user, pass: login.pass },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  try {
    await transport.sendMail({
      envelope: { from: account.address, to: (envelope.to as string[]) ?? [] },
      raw,
    });
  } catch (err) {
    const e = err as { code?: string; responseCode?: number; message?: string };
    if (e.code === "EAUTH" || e.responseCode === 535) {
      forgetToken(account.id);
      throw new EmailError(authHelp(account.provider, account.auth));
    }
    if (e.code === "ECONNECTION" || e.code === "ETIMEDOUT" || e.code === "ESOCKET")
      throw new EmailError("Couldn't reach the mail server to send. Check your internet connection.");
    throw new EmailError(`Not sent: ${e.message ?? String(err)}`);
  } finally {
    transport.close();
  }

  for (const token of input.files ?? []) picked.delete(token);
  if (input.replyToId) await markAnswered(input.replyToId).catch(() => undefined);
  // the mail is out; filing a copy is best effort
  await saveToSent(account.id, raw, messageIdHeader).catch(() => undefined);
}
