import type { CalendarAttendee, CalendarRsvp } from "../../shared/types";

/** Common shape every provider (Google, Zoho/CalDAV, Outlook, ICS) normalizes its events into. */
export interface NormalizedEvent {
  /** Stable within its calendar across syncs (event id, plus the start for a repeat). */
  key: string;
  calendarId: string;
  title: string;
  location: string;
  notes: string;
  start: number;
  end: number;
  allDay: boolean;
  htmlLink: string | null;
  meetingUrl?: string | null;
  attendees?: CalendarAttendee[];
  myStatus?: CalendarRsvp | null;
  organizer?: string | null;
  canEdit?: boolean;
  recurring?: boolean;
  /** What the provider needs to change it later (ids, CalDAV href…). Main process only. */
  ref?: unknown;
}

/** Zoom, Meet, Teams, Webex, Zoho Meeting, Whereby and similar links. */
const MEETING_LINK =
  /https:\/\/(?:[\w-]+\.)*(?:zoom\.us\/(?:j|my|w)\/|meet\.google\.com\/|teams\.microsoft\.com\/l\/meetup-join\/|teams\.live\.com\/meet\/|[\w-]+\.webex\.com\/|meeting\.zoho\.[a-z.]+\/|whereby\.com\/|meet\.jit\.si\/|join\.skype\.com\/|chime\.aws\/)[^\s<>"')\]]*/i;

/** The first meeting link in an event's location or notes. */
export function findMeetingUrl(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = t?.match(MEETING_LINK);
    if (m) return m[0].replace(/[.,;]+$/, "");
  }
  return null;
}
