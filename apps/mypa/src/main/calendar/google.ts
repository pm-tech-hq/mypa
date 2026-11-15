/**
 * Google Calendar over its REST API, signed in through the browser (OAuth
 * "Desktop app" client). Google's token endpoint expects the client secret
 * even for installed apps (PKCE is additive there, not a replacement).
 * Every calendar in the account is read, and events can be added, changed,
 * deleted and answered.
 */
import { randomUUID } from "node:crypto";

import { app } from "electron";

import type {
  CalendarAttendee,
  CalendarInfo,
  CalendarRsvp,
  NewRemoteEvent,
  RemoteEventPatch,
} from "../../shared/types";
import { GOOGLE_WRITE_SCOPE } from "../db";
import { createPkcePair, runLoopbackAuth } from "./oauth";
import { findMeetingUrl, type NormalizedEvent } from "./types";

/** Points everything at a stand-in server when testing a development build. */
const TEST_BASE = app.isPackaged ? undefined : process.env.MYPA_GOOGLE_TEST;
const AUTH_URL = TEST_BASE ? `${TEST_BASE}/auth` : "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = TEST_BASE ? `${TEST_BASE}/token` : "https://oauth2.googleapis.com/token";
const API = TEST_BASE ? `${TEST_BASE}/calendar/v3` : "https://www.googleapis.com/calendar/v3";
/** Read every calendar in the list, and add/change events (not calendars). */
const SCOPE = `openid email https://www.googleapis.com/auth/calendar.readonly ${GOOGLE_WRITE_SCOPE}`;
/** Gmail over IMAP and SMTP: the only scope Google accepts there (XOAUTH2). */
export const GMAIL_SCOPE = "https://mail.google.com/";

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  email: string | null;
  scope: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  scope?: string;
}

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function decodeEmailFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
    };
    return json.email ?? null;
  } catch {
    return null;
  }
}

/** Signs in through the browser. `scope`: the calendar by default; email passes `openid email` + Gmail. */
export async function connectGoogle(
  clientId: string,
  clientSecret: string,
  scope: string = SCOPE,
): Promise<GoogleTokens> {
  const pkce = createPkcePair();

  const { code, redirectUri } = await runLoopbackAuth((redirectUri) => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      access_type: "offline",
      // Always offer the account picker, so a second Google account is easy to add.
      prompt: "consent select_account",
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
    });
    return `${AUTH_URL}?${params.toString()}`;
  });

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: pkce.verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google sign-in failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as TokenResponse;

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + json.expires_in * 1000,
    email: json.id_token ? decodeEmailFromIdToken(json.id_token) : null,
    scope: json.scope ?? null,
  };
}

export async function refreshGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      /invalid_grant/.test(text)
        ? "Google signed myPA out (the sign-in expired or was removed). Reconnect this calendar."
        : `Google token refresh failed (${res.status}): ${text}`,
    );
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
}

async function call<T>(
  token: string,
  path: string,
  init: { method?: string; query?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const url = `${API}${path}${init.query ? `?${new URLSearchParams(init.query)}` : ""}`;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
    } catch {
      /* not JSON */
    }
    if (res.status === 403 && /insufficient/i.test(message))
      message = "myPA isn't allowed to change this calendar. Reconnect it to allow changes.";
    throw new GoogleError(`Google Calendar: ${message}`, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const enc = encodeURIComponent;

/* ------------------------------------------------------------- calendars --- */

interface CalendarListItem {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
  selected?: boolean;
}

/** Every calendar in the account. Ones you've hidden in Google start hidden here too. */
export async function fetchGoogleCalendars(token: string): Promise<CalendarInfo[]> {
  const out: CalendarInfo[] = [];
  let pageToken: string | undefined;
  do {
    const json = await call<{ items?: CalendarListItem[]; nextPageToken?: string }>(
      token,
      "/users/me/calendarList",
      { query: { maxResults: "250", ...(pageToken ? { pageToken } : {}) } },
    );
    for (const c of json.items ?? []) {
      out.push({
        id: c.id,
        name: c.summaryOverride ?? c.summary ?? c.id,
        color: c.backgroundColor ?? null,
        writable: c.accessRole === "owner" || c.accessRole === "writer",
        hidden: !(c.primary || c.selected),
        primary: Boolean(c.primary),
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out.sort((a, b) => Number(b.primary) - Number(a.primary));
}

/* ---------------------------------------------------------------- events --- */

interface GooglePerson {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  organizer?: boolean;
  resource?: boolean;
}

interface GoogleEventItem {
  id: string;
  recurringEventId?: string;
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: GooglePerson[];
  organizer?: GooglePerson;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  guestsCanModify?: boolean;
}

/** What `updateGoogleEvent` and friends need to find the event again. */
export interface GoogleRef {
  calendarId: string;
  eventId: string;
}

const RSVP: Record<string, CalendarRsvp> = {
  accepted: "accepted",
  tentative: "tentative",
  declined: "declined",
  needsAction: "needsAction",
};

function toNormalized(item: GoogleEventItem, cal: CalendarInfo): NormalizedEvent | null {
  if (item.status === "cancelled" || !item.start || !item.end) return null;
  const allDay = Boolean(item.start.date && !item.start.dateTime);
  const start = allDay
    ? Date.parse(`${item.start.date}T00:00:00`)
    : Date.parse(item.start.dateTime ?? "");
  const end = allDay ? Date.parse(`${item.end.date}T00:00:00`) : Date.parse(item.end.dateTime ?? "");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  const attendees: CalendarAttendee[] = (item.attendees ?? [])
    .filter((p) => p.email && !p.resource)
    .map((p) => ({
      name: p.displayName ?? "",
      email: p.email!,
      status: RSVP[p.responseStatus ?? ""] ?? "needsAction",
      organizer: Boolean(p.organizer),
      self: Boolean(p.self),
    }));
  const mine = !item.organizer || Boolean(item.organizer.self);
  const me = attendees.find((a) => a.self);
  const video = item.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
  const ref: GoogleRef = { calendarId: cal.id, eventId: item.id };

  return {
    key: item.id,
    calendarId: cal.id,
    title: item.summary ?? "(untitled)",
    location: item.location ?? "",
    notes: item.description ?? "",
    start,
    end,
    allDay,
    htmlLink: item.htmlLink ?? null,
    meetingUrl: item.hangoutLink ?? video ?? findMeetingUrl(item.location, item.description),
    attendees,
    myStatus: !mine && me ? me.status : null,
    organizer: mine ? null : item.organizer?.displayName || item.organizer?.email || null,
    canEdit: cal.writable && (mine || Boolean(item.guestsCanModify)),
    recurring: Boolean(item.recurringEventId),
    ref,
  };
}

export async function fetchGoogleEvents(
  accessToken: string,
  calendars: CalendarInfo[],
  timeMinIso: string,
  timeMaxIso: string,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for (const cal of calendars) {
    let pageToken: string | undefined;
    do {
      const json = await call<{ items?: GoogleEventItem[]; nextPageToken?: string }>(
        accessToken,
        `/calendars/${enc(cal.id)}/events`,
        {
          query: {
            timeMin: timeMinIso,
            timeMax: timeMaxIso,
            singleEvents: "true",
            orderBy: "startTime",
            maxResults: "250",
            ...(pageToken ? { pageToken } : {}),
          },
        },
      );
      for (const item of json.items ?? []) {
        const e = toNormalized(item, cal);
        if (e) events.push(e);
      }
      pageToken = json.nextPageToken;
    } while (pageToken);
  }
  return events;
}

function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function times(allDay: boolean, start: number, end: number) {
  return allDay
    ? { start: { date: localDate(start) }, end: { date: localDate(end) } }
    : { start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() } };
}

/** Keeps the answers of guests who stay invited. */
function mergeGuests(current: GooglePerson[] | undefined, emails: string[]): GooglePerson[] {
  const byEmail = new Map((current ?? []).map((p) => [p.email?.toLowerCase(), p]));
  const keep = (current ?? []).filter((p) => p.self || p.organizer || p.resource);
  const guests = emails.map((email) => byEmail.get(email.toLowerCase()) ?? { email });
  const out = [...keep];
  for (const g of guests) if (!out.some((p) => p.email?.toLowerCase() === g.email?.toLowerCase())) out.push(g);
  return out;
}

export async function createGoogleEvent(token: string, input: NewRemoteEvent): Promise<GoogleRef> {
  const created = await call<GoogleEventItem>(token, `/calendars/${enc(input.calendarId)}/events`, {
    method: "POST",
    query: { sendUpdates: "all", ...(input.addMeet ? { conferenceDataVersion: "1" } : {}) },
    body: {
      summary: input.title,
      location: input.location || undefined,
      description: input.notes || undefined,
      ...times(input.allDay, input.start, input.end),
      attendees: input.guests.length ? input.guests.map((email) => ({ email })) : undefined,
      conferenceData: input.addMeet
        ? {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          }
        : undefined,
    },
  });
  return { calendarId: input.calendarId, eventId: created.id };
}

export async function updateGoogleEvent(
  token: string,
  ref: GoogleRef,
  patch: RemoteEventPatch,
): Promise<void> {
  const path = `/calendars/${enc(ref.calendarId)}/events/${enc(ref.eventId)}`;
  const current = await call<GoogleEventItem>(token, path);
  const wasAllDay = Boolean(current.start?.date && !current.start?.dateTime);
  const allDay = patch.allDay ?? wasAllDay;
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.notes !== undefined) body.description = patch.notes;
  if (patch.start !== undefined || patch.end !== undefined || patch.allDay !== undefined) {
    const old = toNormalized(current, {
      id: ref.calendarId,
      name: "",
      color: null,
      writable: true,
      hidden: false,
      primary: false,
    });
    Object.assign(body, times(allDay, patch.start ?? old!.start, patch.end ?? old!.end));
  }
  if (patch.guests !== undefined) body.attendees = mergeGuests(current.attendees, patch.guests);
  await call(token, path, { method: "PATCH", query: { sendUpdates: "all" }, body });
}

export async function deleteGoogleEvent(token: string, ref: GoogleRef): Promise<void> {
  try {
    await call(token, `/calendars/${enc(ref.calendarId)}/events/${enc(ref.eventId)}`, {
      method: "DELETE",
      query: { sendUpdates: "all" },
    });
  } catch (err) {
    // Already gone is what we wanted.
    if (!(err instanceof GoogleError && err.status === 410)) throw err;
  }
}

export async function respondGoogleEvent(
  token: string,
  ref: GoogleRef,
  answer: CalendarRsvp,
): Promise<void> {
  const path = `/calendars/${enc(ref.calendarId)}/events/${enc(ref.eventId)}`;
  const current = await call<GoogleEventItem>(token, path);
  const attendees = current.attendees ?? [];
  if (!attendees.some((p) => p.self)) throw new Error("You're not on this event's guest list.");
  await call(token, path, {
    method: "PATCH",
    query: { sendUpdates: "all" },
    body: {
      attendees: attendees.map((p) => (p.self ? { ...p, responseStatus: answer } : p)),
    },
  });
}
