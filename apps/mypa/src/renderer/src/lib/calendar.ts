/** Pure formatting + merging helpers for the Calendar widget. */

import type {
  CalendarAccountRow,
  CalendarEventRow,
  CalendarRemoteEventRow,
} from "../../../shared/types";

export interface AgendaItem {
  id: string;
  title: string;
  location: string;
  notes: string;
  start: number;
  end: number;
  allDay: boolean;
  /** "local" for events you added; otherwise the connected calendar's label. */
  source: string;
  local: boolean;
  htmlLink: string | null;
}

/** Local events (always shown) + remote events from connected accounts only,
 *  sorted by start time. */
export function mergeEvents(
  localEvents: CalendarEventRow[],
  remoteEvents: CalendarRemoteEventRow[],
  accounts: CalendarAccountRow[],
): AgendaItem[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const local: AgendaItem[] = localEvents.map((e) => ({
    id: e.id,
    title: e.title,
    location: e.location,
    notes: e.notes,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    source: "local",
    local: true,
    htmlLink: null,
  }));

  const remote: AgendaItem[] = remoteEvents
    .filter((e) => accountById.get(e.accountId)?.status === "connected")
    .map((e) => ({
      id: e.id,
      title: e.title,
      location: e.location,
      notes: e.notes,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      source: accountById.get(e.accountId)?.label ?? "calendar",
      local: false,
      htmlLink: e.htmlLink,
    }));

  return [...local, ...remote].sort((a, b) => a.start - b.start);
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isSameDay(a: number, b: number): boolean {
  return dayKey(a) === dayKey(b);
}

function formatClock(ms: number): { time: string; meridiem: "AM" | "PM" } {
  const d = new Date(ms);
  const meridiem = d.getHours() >= 12 ? "PM" : "AM";
  const h = d.getHours() % 12 || 12;
  return { time: `${h}:${String(d.getMinutes()).padStart(2, "0")}`, meridiem };
}

/** Compact, single-line time range — drops the repeated AM/PM ("12:30–1:30 PM")
 *  when both ends share it, so the fixed-width time column never wraps. */
export function formatEventTime(item: AgendaItem): string {
  if (item.allDay) return "All day";
  const start = formatClock(item.start);
  const end = formatClock(item.end);
  if (start.meridiem === end.meridiem) {
    return `${start.time}–${end.time} ${end.meridiem}`;
  }
  // Non-breaking space before each meridiem so a wrap (rare — start/end
  // straddling noon) breaks at the dash, not mid "12:50 PM".
  return `${start.time} ${start.meridiem}–${end.time} ${end.meridiem}`;
}

export function isOngoing(item: AgendaItem, now: number): boolean {
  return !item.allDay && item.start <= now && item.end >= now;
}

function span(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "ends in 20m" while it runs, "in 25m" when it starts within 12 hours,
 *  otherwise null. */
export function formatRelative(item: AgendaItem, now: number): string | null {
  if (item.allDay) return null;
  if (isOngoing(item, now)) return `ends in ${span(item.end - now)}`;
  const until = item.start - now;
  if (until > 0 && until <= 12 * 3_600_000) return `in ${span(until)}`;
  return null;
}

/** "Tue, Oct 6 · 2:00–3:00 PM" for the details panel. */
export function formatEventWhen(item: AgendaItem): string {
  const day = new Date(item.start).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  return `${day} · ${formatEventTime(item)}`;
}

export function formatDayHeading(ms: number, now: number): string {
  if (isSameDay(ms, now)) return "Today";
  if (isSameDay(ms, now + 86_400_000)) return "Tomorrow";
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export interface DayGroup {
  key: string;
  day: number;
  items: AgendaItem[];
}

export function groupByDay(items: AgendaItem[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const item of items) {
    const key = dayKey(item.start);
    let group = groups.get(key);
    if (!group) {
      group = { key, day: item.start, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return Array.from(groups.values()).sort((a, b) => a.day - b.day);
}
