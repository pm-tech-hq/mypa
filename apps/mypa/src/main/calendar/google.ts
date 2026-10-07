/**
 * Google Calendar via a user-supplied OAuth "Desktop app" client. Google's
 * token endpoint expects the client secret even for installed apps (PKCE is
 * additive there, not a replacement) — see the settings UI copy for where the
 * user gets both values from Google Cloud Console.
 */
import { createPkcePair, runLoopbackAuth } from "./oauth";
import type { NormalizedEvent } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "openid email https://www.googleapis.com/auth/calendar.readonly";

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  email: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
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

export async function connectGoogle(clientId: string, clientSecret: string): Promise<GoogleTokens> {
  const pkce = createPkcePair();

  const { code, redirectUri } = await runLoopbackAuth((redirectUri) => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
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
    throw new Error(`Google token refresh failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
}

interface GoogleEventItem {
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

export async function fetchGoogleEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(`Google events fetch failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as { items?: GoogleEventItem[]; nextPageToken?: string };

    for (const item of json.items ?? []) {
      if (item.status === "cancelled" || !item.start || !item.end) continue;
      const allDay = Boolean(item.start.date && !item.start.dateTime);
      const start = allDay
        ? Date.parse(`${item.start.date}T00:00:00`)
        : Date.parse(item.start.dateTime ?? "");
      const end = allDay
        ? Date.parse(`${item.end.date}T00:00:00`)
        : Date.parse(item.end.dateTime ?? "");
      if (Number.isNaN(start) || Number.isNaN(end)) continue;

      events.push({
        title: item.summary ?? "(untitled)",
        location: item.location ?? "",
        notes: item.description ?? "",
        start,
        end,
        allDay,
        htmlLink: item.htmlLink ?? null,
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);

  return events;
}
