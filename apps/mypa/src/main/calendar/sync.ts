/** Orchestrates connecting accounts and refreshing their cached events. */
import * as db from "../db";
import type { CalendarAccountSecrets } from "../db";
import { connectGoogle, fetchGoogleEvents, refreshGoogleAccessToken } from "./google";
import { fetchIcsEvents } from "./ics";
import { connectOutlook, fetchOutlookEvents, refreshOutlookAccessToken } from "./outlook";

const WINDOW_PAST_DAYS = 7;
const WINDOW_FUTURE_DAYS = 180;
/** Refresh a bit early so a sync never races an access token's real expiry. */
const REFRESH_SKEW_MS = 60_000;

const GOOGLE_NO_REFRESH =
  "Google didn't return a refresh token. Remove myPA under your Google Account's " +
  "connected apps (myaccount.google.com/permissions), then try connecting again.";
const OUTLOOK_NO_REFRESH = "Microsoft didn't return a refresh token. Try connecting again.";

function syncWindow(): { start: Date; end: Date } {
  const now = Date.now();
  return {
    start: new Date(now - WINDOW_PAST_DAYS * 86_400_000),
    end: new Date(now + WINDOW_FUTURE_DAYS * 86_400_000),
  };
}

async function ensureFreshGoogleToken(account: CalendarAccountSecrets): Promise<string> {
  if (
    account.accessToken &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt - REFRESH_SKEW_MS > Date.now()
  ) {
    return account.accessToken;
  }
  if (!account.refreshToken || !account.clientId || !account.clientSecret) {
    throw new Error("Not signed in — reconnect this calendar.");
  }
  const { accessToken, expiresAt } = await refreshGoogleAccessToken(
    account.clientId,
    account.clientSecret,
    account.refreshToken,
  );
  db.updateAccountTokens(account.id, { accessToken, accessTokenExpiresAt: expiresAt });
  return accessToken;
}

async function ensureFreshOutlookToken(account: CalendarAccountSecrets): Promise<string> {
  if (
    account.accessToken &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt - REFRESH_SKEW_MS > Date.now()
  ) {
    return account.accessToken;
  }
  if (!account.refreshToken || !account.clientId) {
    throw new Error("Not signed in — reconnect this calendar.");
  }
  const { accessToken, expiresAt, refreshToken } = await refreshOutlookAccessToken(
    account.clientId,
    account.refreshToken,
  );
  db.updateAccountTokens(account.id, {
    accessToken,
    accessTokenExpiresAt: expiresAt,
    refreshToken: refreshToken ?? undefined,
  });
  return accessToken;
}

/** Refetches one connected account's events and updates its status. Never throws —
 *  failures are recorded on the account row (`status: "error"`) instead. */
export async function syncAccount(accountId: string): Promise<void> {
  const account = db.getCalendarAccountSecrets(accountId);
  if (!account) return;
  const { start, end } = syncWindow();

  try {
    if (account.provider === "ics") {
      if (!account.feedUrl) throw new Error("Missing feed URL.");
      const events = await fetchIcsEvents(account.feedUrl, start, end);
      db.replaceRemoteEvents(accountId, events);
    } else if (account.provider === "google") {
      const accessToken = await ensureFreshGoogleToken(account);
      const events = await fetchGoogleEvents(accessToken, start.toISOString(), end.toISOString());
      db.replaceRemoteEvents(accountId, events);
    } else {
      const accessToken = await ensureFreshOutlookToken(account);
      const events = await fetchOutlookEvents(
        accessToken,
        start.toISOString(),
        end.toISOString(),
      );
      db.replaceRemoteEvents(accountId, events);
    }
    db.touchAccountSynced(accountId);
  } catch (err) {
    db.failAccount(accountId, err instanceof Error ? err.message : String(err));
  }
}

export async function syncAllAccounts(): Promise<void> {
  for (const id of db.listCalendarAccountIds()) {
    await syncAccount(id);
  }
}

/** Runs the browser OAuth round-trip for a pending/errored account and, on
 *  success, does an initial sync. Never throws — see `syncAccount`. */
async function finishOAuth(
  id: string,
  tokens: Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number;
    email: string | null;
  }>,
  missingRefreshMessage: string,
): Promise<void> {
  try {
    const t = await tokens;
    if (!t.refreshToken) {
      db.failAccount(id, missingRefreshMessage);
      return;
    }
    db.completeOAuthAccount(id, {
      accountEmail: t.email,
      refreshToken: t.refreshToken,
      accessToken: t.accessToken,
      accessTokenExpiresAt: t.expiresAt,
    });
    await syncAccount(id);
  } catch (err) {
    db.failAccount(id, err instanceof Error ? err.message : String(err));
  }
}

export async function addGoogleAccount(
  label: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const id = db.createOAuthAccountPending("google", label, clientId, clientSecret);
  await finishOAuth(id, connectGoogle(clientId, clientSecret), GOOGLE_NO_REFRESH);
}

export async function addOutlookAccount(label: string, clientId: string): Promise<void> {
  const id = db.createOAuthAccountPending("outlook", label, clientId, null);
  await finishOAuth(id, connectOutlook(clientId), OUTLOOK_NO_REFRESH);
}

export async function addIcsAccount(label: string, feedUrl: string): Promise<void> {
  const id = db.createIcsAccount(label, feedUrl);
  await syncAccount(id);
}

/** Retries sign-in for a Google/Outlook account using its stored client credentials;
 *  for an ICS feed, just resyncs. */
export async function reconnectAccount(id: string): Promise<void> {
  const account = db.getCalendarAccountSecrets(id);
  if (!account) return;

  if (account.provider === "google") {
    if (!account.clientId || !account.clientSecret) {
      db.failAccount(id, "Missing client credentials — remove and reconnect this calendar.");
      return;
    }
    await finishOAuth(
      id,
      connectGoogle(account.clientId, account.clientSecret),
      GOOGLE_NO_REFRESH,
    );
  } else if (account.provider === "outlook") {
    if (!account.clientId) {
      db.failAccount(id, "Missing client ID — remove and reconnect this calendar.");
      return;
    }
    await finishOAuth(id, connectOutlook(account.clientId), OUTLOOK_NO_REFRESH);
  } else {
    await syncAccount(id);
  }
}
