/**
 * Outlook / Microsoft 365 via a user-supplied Azure "Mobile and desktop
 * applications" app registration — a public client, so only a Client ID is
 * needed (no secret; PKCE covers it).
 */
import { createPkcePair, runLoopbackAuth } from "./oauth";
import type { NormalizedEvent } from "./types";

const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPE = "offline_access Calendars.Read User.Read";

export interface OutlookTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  email: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function fetchOutlookEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { mail?: string; userPrincipalName?: string };
    return json.mail ?? json.userPrincipalName ?? null;
  } catch {
    return null;
  }
}

export async function connectOutlook(clientId: string): Promise<OutlookTokens> {
  const pkce = createPkcePair();

  const { code, redirectUri } = await runLoopbackAuth((redirectUri) => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: SCOPE,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
    });
    return `${AUTH_URL}?${params.toString()}`;
  });

  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: pkce.verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    scope: SCOPE,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Outlook sign-in failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as TokenResponse;
  const email = await fetchOutlookEmail(json.access_token);

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + json.expires_in * 1000,
    email,
  };
}

export async function refreshOutlookAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number; refreshToken: string | null }> {
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: SCOPE,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Outlook token refresh failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as TokenResponse;
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    refreshToken: json.refresh_token ?? null,
  };
}

interface GraphEventItem {
  subject?: string;
  bodyPreview?: string;
  isAllDay?: boolean;
  webLink?: string;
  location?: { displayName?: string };
  start?: { dateTime?: string };
  end?: { dateTime?: string };
}

export async function fetchOutlookEvents(
  accessToken: string,
  startIso: string,
  endIso: string,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  let url: string | null =
    `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${encodeURIComponent(startIso)}` +
    `&endDateTime=${encodeURIComponent(endIso)}&$top=100&$orderby=start/dateTime`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
    });
    if (!res.ok) {
      throw new Error(`Outlook events fetch failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as {
      value?: GraphEventItem[];
      "@odata.nextLink"?: string;
    };

    for (const item of json.value ?? []) {
      if (!item.start?.dateTime || !item.end?.dateTime) continue;
      // Graph's "UTC" preference returns naive local-looking strings with no zone suffix.
      const start = Date.parse(`${item.start.dateTime}Z`);
      const end = Date.parse(`${item.end.dateTime}Z`);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;

      events.push({
        title: item.subject ?? "(untitled)",
        location: item.location?.displayName ?? "",
        notes: item.bodyPreview ?? "",
        start,
        end,
        allDay: Boolean(item.isAllDay),
        htmlLink: item.webLink ?? null,
      });
    }
    url = json["@odata.nextLink"] ?? null;
  }

  return events;
}
