/**
 * How an email account logs in to its servers. Most use an (app) password.
 * Gmail can use "Sign in with Google" instead: the stored secret is then the
 * Google refresh token, traded for a short-lived access token that IMAP and
 * SMTP accept (XOAUTH2). Access tokens stay in memory only.
 */
import { refreshGoogleAccessToken } from "../calendar/google";
import * as db from "../db";

/** Refresh this long before Google says the token expires. */
const SKEW_MS = 60_000;

const tokens = new Map<string, { token: string; expiresAt: number }>();

export class EmailAuthError extends Error {}

/** Holds a fresh access token from a sign-in, so the first connection needn't refresh. */
export function rememberToken(accountId: string, token: string, expiresAt: number): void {
  tokens.set(accountId, { token, expiresAt });
}

/** After a refused login or a new sign-in: the next connection gets a new token. */
export function forgetToken(accountId: string): void {
  tokens.delete(accountId);
}

export type Login =
  | { kind: "password"; user: string; pass: string }
  | { kind: "google"; user: string; accessToken: string };

export async function loginFor(secrets: db.EmailAccountSecrets): Promise<Login> {
  const { account, password } = secrets;
  if (account.auth !== "google") {
    if (!password)
      throw new EmailAuthError(
        "The saved password can't be read on this computer. Enter it again in the widget's settings.",
      );
    return { kind: "password", user: account.address, pass: password };
  }

  const cached = tokens.get(account.id);
  if (cached && cached.expiresAt - SKEW_MS > Date.now())
    return { kind: "google", user: account.address, accessToken: cached.token };

  if (!password)
    throw new EmailAuthError(
      "The Google sign-in can't be read on this computer. Sign in with Google again in the widget's settings.",
    );
  const client = db.googleAppClient();
  if (!client)
    throw new EmailAuthError(
      "Google sign-in isn't set up in this copy of myPA. Use an app password for this account instead.",
    );
  try {
    const { accessToken, expiresAt } = await refreshGoogleAccessToken(
      client.clientId,
      client.clientSecret,
      password,
    );
    tokens.set(account.id, { token: accessToken, expiresAt });
    return { kind: "google", user: account.address, accessToken };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EmailAuthError(
      /signed myPA out/.test(msg)
        ? "Google signed myPA out of this account (the sign-in expired or was removed). Sign in with Google again in the widget's settings."
        : msg,
    );
  }
}
