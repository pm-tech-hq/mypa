/**
 * Importing a .ics file (an export from Google, Outlook, Apple Calendar, or an
 * invite attachment) copies its events into the local calendar — unlike an
 * "Other calendars" feed, which stays linked and read-only.
 */
import { basename } from "node:path";

import ical from "node-ical";

import type { NewCalendarEvent } from "../../shared/types";
import { eventsFromIcs } from "./ics";

/** Local events don't repeat, so a repeating event becomes copies within this range. */
const REPEAT_BACK_MS = 365 * 86_400_000;
const REPEAT_AHEAD_MS = 2 * 365 * 86_400_000;
/** Guards against a runaway file (e.g. an every-minute rule). */
const MAX_EVENTS = 10_000;

export async function readIcsFiles(paths: string[]): Promise<NewCalendarEvent[]> {
  const now = Date.now();
  const from = new Date(now - REPEAT_BACK_MS);
  const to = new Date(now + REPEAT_AHEAD_MS);
  const out: NewCalendarEvent[] = [];

  for (const path of paths) {
    let data;
    try {
      data = await ical.async.parseFile(path);
    } catch {
      throw new Error(`Couldn't read ${basename(path)} — is it a calendar (.ics) file?`);
    }
    for (const e of eventsFromIcs(data, from, to, true)) {
      out.push({
        title: e.title,
        start: e.start,
        // Some files leave out the end; give those a sensible length.
        end: e.end > e.start ? e.end : e.start + (e.allDay ? 86_400_000 : 3_600_000),
        allDay: e.allDay,
        location: e.location,
        notes: e.notes,
      });
      if (out.length > MAX_EVENTS)
        throw new Error(`That's more than ${MAX_EVENTS.toLocaleString()} events — too many to import.`);
    }
  }
  return out;
}
