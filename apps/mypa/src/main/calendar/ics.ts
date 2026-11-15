/**
 * "Other calendars" — any public/private .ics feed URL (Google, Outlook, and
 * Apple/iCloud all expose one from their own settings). Read-only, no OAuth.
 */
import ical, { type CalendarResponse, type ParameterValue, type VEvent } from "node-ical";

import { findMeetingUrl, type NormalizedEvent } from "./types";

function textOf(value: ParameterValue | undefined, fallback = ""): string {
  if (value == null) return fallback;
  return typeof value === "string" ? value : (value.val ?? fallback);
}

export async function fetchIcsEvents(
  feedUrl: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<NormalizedEvent[]> {
  return eventsFromIcs(await ical.async.fromURL(feedUrl), windowStart, windowEnd);
}

/**
 * Every event in parsed iCalendar data. Repeats are expanded between
 * `windowStart` and `windowEnd`; one-off events outside that window are
 * dropped unless `keepAllSingles` is set.
 */
export function eventsFromIcs(
  data: CalendarResponse,
  windowStart: Date,
  windowEnd: Date,
  keepAllSingles = false,
): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];

  for (const item of Object.values(data)) {
    if (!item || item.type !== "VEVENT") continue;
    const vevent = item as VEvent;

    if (vevent.rrule) {
      const instances = ical.expandRecurringEvent(vevent, {
        from: windowStart,
        to: windowEnd,
      });
      for (const inst of instances) {
        const location = textOf(inst.event.location);
        const notes = textOf(inst.event.description);
        out.push({
          key: `${vevent.uid ?? ""}|${inst.start.getTime()}`,
          calendarId: "feed",
          title: textOf(inst.summary, "(untitled)"),
          location,
          notes,
          start: inst.start.getTime(),
          end: inst.end.getTime(),
          allDay: inst.isFullDay,
          htmlLink: inst.event.url ?? null,
          meetingUrl: findMeetingUrl(location, notes),
          recurring: true,
        });
      }
      continue;
    }

    const start = vevent.start;
    const end = vevent.end ?? vevent.start;
    if (!start) continue;
    if (
      !keepAllSingles &&
      (start.getTime() > windowEnd.getTime() || end.getTime() < windowStart.getTime())
    )
      continue;

    const location = textOf(vevent.location);
    const notes = textOf(vevent.description);
    out.push({
      key: `${vevent.uid ?? ""}|${start.getTime()}`,
      calendarId: "feed",
      title: textOf(vevent.summary, "(untitled)"),
      location,
      notes,
      meetingUrl: findMeetingUrl(location, notes),
      start: start.getTime(),
      end: end.getTime(),
      allDay: Boolean(start.dateOnly),
      htmlLink: vevent.url ?? null,
    });
  }

  return out;
}
