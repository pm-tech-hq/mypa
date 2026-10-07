/** Pure formatting + ordering helpers for the To-do widget. */

import type { Importance } from "../../../shared/types";

const DAY = 86_400_000;

const RANK: Record<Importance, number> = { high: 0, medium: 1, low: 2 };

export function importanceRank(i: Importance): number {
  return RANK[i];
}

export interface Countdown {
  text: string;
  overdue: boolean;
  /** due within 24h, or overdue */
  urgent: boolean;
}

export function formatCountdown(due: number, now: number): Countdown {
  const delta = due - now;
  const abs = Math.abs(delta);

  const d = Math.floor(abs / DAY);
  const h = Math.floor((abs % DAY) / 3_600_000);
  const m = Math.max(1, Math.floor((abs % 3_600_000) / 60_000));

  let span: string;
  if (d > 0) span = h > 0 ? `${d}d ${h}h` : `${d}d`;
  else if (h > 0) span = `${h}h ${m}m`;
  else span = `${m}m`;

  if (delta <= 0) return { text: `overdue ${span}`, overdue: true, urgent: true };
  return { text: `${span} left`, overdue: false, urgent: delta < DAY };
}

/** 23:59 local time, `days` from the day `now` falls on. */
export function endOfDay(now: number, days = 0): number {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}

/** End of next Monday (a week from today when today is Monday). */
export function endOfNextMonday(now: number): number {
  const day = new Date(now).getDay();
  return endOfDay(now, ((8 - day) % 7) || 7);
}

/** "yyyy-mm-dd" for a timestamp, in local time. */
export function toDateInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Tue, Oct 6" — the absolute form of a due date, for tooltips and menus. */
export function formatDueDate(due: number): string {
  return new Date(due).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatGoalDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
