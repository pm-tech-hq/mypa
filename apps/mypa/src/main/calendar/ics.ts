/**
 * "Other calendars" — any public/private .ics feed URL (Google, Outlook, and
 * Apple/iCloud all expose one from their own settings). Read-only, no OAuth.
 */
import ical, { type ParameterValue, type VEvent } from "node-ical";

import type { NormalizedEvent } from "./types";

function textOf(value: ParameterValue | undefined, fallback = ""): string {
  if (value == null) return fallback;
  return typeof value === "string" ? value : (value.val ?? fallback);
}

export async function fetchIcsEvents(
  feedUrl: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<NormalizedEvent[]> {
  const data = await ical.async.fromURL(feedUrl);
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
        out.push({
          title: textOf(inst.summary, "(untitled)"),
          location: textOf(inst.event.location),
          notes: textOf(inst.event.description),
          start: inst.start.getTime(),
          end: inst.end.getTime(),
          allDay: inst.isFullDay,
          htmlLink: inst.event.url ?? null,
        });
      }
      continue;
    }

    const start = vevent.start;
    const end = vevent.end ?? vevent.start;
    if (!start) continue;
    if (start.getTime() > windowEnd.getTime() || end.getTime() < windowStart.getTime()) continue;

    out.push({
      title: textOf(vevent.summary, "(untitled)"),
      location: textOf(vevent.location),
      notes: textOf(vevent.description),
      start: start.getTime(),
      end: end.getTime(),
      allDay: Boolean(start.dateOnly),
      htmlLink: vevent.url ?? null,
    });
  }

  return out;
}
