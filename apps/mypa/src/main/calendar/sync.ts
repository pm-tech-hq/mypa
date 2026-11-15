/** Orchestrates connecting accounts and refreshing their cached events. */
import { app } from "electron";

import type { CalendarInfo, NewCaldavCalendar, NewZohoCalendar } from "../../shared/types";
import * as db from "../db";
import type { CalendarAccountSecrets } from "../db";
import { discoverCalendars, fetchDavEvents, type DavLogin } from "./caldav";
import {
  connectGoogle,
  fetchGoogleCalendars,
  fetchGoogleEvents,
  refreshGoogleAccessToken,
} from "./google";
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
const NO_GOOGLE_CLIENT =
  "Google sign-in isn't set up in this copy of myPA yet. Add a Google client in the Calendar settings.";

/** Zoho runs a calendar server per data centre (same regions as Zoho Mail). */
const ZOHO_HOSTS: Record<string, string> = {
  com: "calendar.zoho.com",
  eu: "calendar.zoho.eu",
  in: "calendar.zoho.in",
  "com.au": "calendar.zoho.com.au",
  jp: "calendar.zoho.jp",
  ca: "calendar.zohocloud.ca",
  sa: "calendar.zoho.sa",
};
/** A development build under test can point Zoho at a stand-in server. */
const ZOHO_TEST = app.isPackaged ? undefined : process.env.MYPA_ZOHO_TEST;

function syncWindow(): { start: Date; end: Date } {
  const now = Date.now();
  return {
    start: new Date(now - WINDOW_PAST_DAYS * 86_400_000),
    end: new Date(now + WINDOW_FUTURE_DAYS * 86_400_000),
  };
}

export async function ensureFreshGoogleToken(account: CalendarAccountSecrets): Promise<string> {
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

export function davLogin(account: CalendarAccountSecrets): DavLogin {
  if (!account.username || !account.password)
    throw new Error("The password for this calendar couldn't be read. Remove and add it again.");
  return { username: account.username, password: account.password };
}

/** Addresses that mean "you" in guest lists. */
export function selfAddresses(account: CalendarAccountSecrets): string[] {
  return [account.username, account.accountEmail]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase());
}

/** Keeps what you chose to show or hide when a provider's list is read again. */
function mergeCalendars(fresh: CalendarInfo[], old: CalendarInfo[]): CalendarInfo[] {
  const before = new Map(old.map((c) => [c.id, c]));
  return fresh.map((c) => ({ ...c, hidden: before.get(c.id)?.hidden ?? c.hidden }));
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
      const calendars = mergeCalendars(await fetchGoogleCalendars(accessToken), account.calendars);
      db.setAccountCalendars(accountId, calendars);
      const events = await fetchGoogleEvents(
        accessToken,
        calendars.filter((c) => !c.hidden),
        start.toISOString(),
        end.toISOString(),
      );
      db.replaceRemoteEvents(accountId, events);
    } else if (account.provider === "zoho" || account.provider === "caldav") {
      const login = davLogin(account);
      let calendars = account.calendars;
      if (account.serverUrl) {
        // The list can change (a calendar added in Zoho); keep the old one if the lookup fails.
        const fresh = await discoverCalendars(account.serverUrl, login).catch(() => []);
        if (fresh.length) calendars = mergeCalendars(fresh, account.calendars);
        db.setAccountCalendars(accountId, calendars);
      }
      const self = selfAddresses(account);
      const events = [];
      let failure: unknown = null;
      for (const cal of calendars.filter((c) => !c.hidden)) {
        try {
          events.push(...(await fetchDavEvents(cal, login, start, end, self)));
        } catch (err) {
          failure ??= err;
        }
      }
      if (failure && events.length === 0 && calendars.some((c) => !c.hidden)) throw failure;
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
    scope?: string | null;
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
      scope: t.scope,
    });
    const label = db.getCalendarAccountSecrets(id)?.label;
    // "Google Calendar" says nothing once there are two; the address does.
    if (t.email && (!label || label === "Google Calendar")) db.updateCalendarAccount(id, { label: t.email });
    await syncAccount(id);
  } catch (err) {
    db.failAccount(id, err instanceof Error ? err.message : String(err));
  }
}

/** Signs in with your own client when one is given, else the one set up for myPA. */
export async function addGoogleAccount(
  label: string,
  clientId?: string,
  clientSecret?: string,
): Promise<void> {
  const client =
    clientId && clientSecret ? { clientId, clientSecret } : db.googleAppClient();
  if (!client) throw new Error(NO_GOOGLE_CLIENT);
  const id = db.createOAuthAccountPending("google", label, client.clientId, client.clientSecret);
  await finishOAuth(id, connectGoogle(client.clientId, client.clientSecret), GOOGLE_NO_REFRESH);
}

export async function addOutlookAccount(label: string, clientId: string): Promise<void> {
  const id = db.createOAuthAccountPending("outlook", label, clientId, null);
  await finishOAuth(id, connectOutlook(clientId), OUTLOOK_NO_REFRESH);
}

export async function addIcsAccount(label: string, feedUrl: string): Promise<void> {
  const id = db.createIcsAccount(label, feedUrl);
  await syncAccount(id);
}

/** "imappro.zoho.eu" → "eu", "imap.zohocloud.ca" → "ca". */
function zohoRegionOf(host: string): string {
  if (/zohocloud\.ca$/i.test(host)) return "ca";
  return /zoho\.([a-z.]+)$/i.exec(host)?.[1]?.toLowerCase() ?? "com";
}

/**
 * Adds Zoho Calendar. Throws a readable message when the login is refused or
 * no calendars turn up, so the form can say what to fix; nothing is saved then.
 */
export async function addZohoAccount(input: NewZohoCalendar): Promise<void> {
  let email = input.email?.trim() ?? "";
  let password = input.password?.trim() ?? "";
  let region = input.region ?? "com";
  if (input.emailAccountId) {
    const mail = db.getEmailAccountSecrets(input.emailAccountId);
    if (!mail?.password) throw new Error("That mailbox's password couldn't be read. Type it in instead.");
    email = mail.account.address;
    password = mail.password;
    region = zohoRegionOf(mail.account.imapHost);
  }
  if (!email || !password) throw new Error("Enter your Zoho email address and app password.");

  const login = { username: email, password };
  const host = ZOHO_HOSTS[region] ?? ZOHO_HOSTS.com!;
  const base = ZOHO_TEST ?? `https://${host}`;
  let calendars: CalendarInfo[] = [];
  let serverUrl: string | null = null;
  if (input.calendarUrl?.trim()) {
    calendars = await discoverCalendars(input.calendarUrl.trim(), login);
  } else {
    for (const at of [`${base}/`, `${base}/caldav/`]) {
      calendars = await discoverCalendars(at, login).catch((err: unknown) => {
        // A refused password won't get better on the next address.
        if ((err as { status?: number }).status === 401) throw err;
        return [];
      });
      if (calendars.length) {
        serverUrl = at;
        break;
      }
    }
  }
  if (!calendars.length)
    throw new Error(
      "Signed in, but no calendars turned up. In Zoho Calendar open Settings → My Calendars → " +
        "a calendar → Export/Subscribe → CalDAV, and paste its CalDAV URL here.",
    );
  const id = db.createDavAccount({
    provider: "zoho",
    label: input.label?.trim() || email,
    serverUrl,
    username: email,
    password,
    calendars,
  });
  await syncAccount(id);
}

/** Adds any other CalDAV account (iCloud, Fastmail, Nextcloud…). Throws like `addZohoAccount`. */
export async function addCaldavAccount(input: NewCaldavCalendar): Promise<void> {
  const serverUrl = input.serverUrl.trim().replace(/^(?!https?:\/\/)/i, "https://");
  const login = { username: input.username.trim(), password: input.password.trim() };
  if (!login.username || !login.password) throw new Error("Enter the username and password.");
  const calendars = await discoverCalendars(serverUrl, login);
  if (!calendars.length)
    throw new Error("Signed in, but no calendars turned up at that address. Check the server URL.");
  const id = db.createDavAccount({
    provider: "caldav",
    label: input.label?.trim() || login.username,
    serverUrl,
    username: login.username,
    password: login.password,
    calendars,
  });
  await syncAccount(id);
}

/** Retries sign-in for a Google/Outlook account using its stored client credentials;
 *  for an ICS feed or CalDAV, just resyncs. */
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
