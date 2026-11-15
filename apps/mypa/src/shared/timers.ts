/**
 * Timers and stopwatches. Time is never counted by ticking: a running one
 * stores when it last started and how much had passed before that, so elapsed
 * time is always `accumulated + (now − startedAt)`. That stays exact through
 * sleep, busy moments and restarts of the app.
 */

export type TimerKind = "timer" | "stopwatch";

export interface TimerRow {
  id: string;
  kind: TimerKind;
  label: string;
  /** Timers only: how long it runs. */
  durationMs: number;
  /** When it was last started; null while stopped. */
  startedAt: number | null;
  /** Time that passed before the current run. */
  accumulatedMs: number;
  /** Stopwatches: elapsed time at each lap. */
  laps: number[];
  /** When the end was announced (timers). */
  firedAt: number | null;
  createdAt: number;
}

export type TimerStatus = "idle" | "running" | "paused" | "done";

export type TimerAction =
  | { kind: "start" }
  | { kind: "pause" }
  | { kind: "reset" }
  | { kind: "lap" }
  /** Adds time to a timer (ms; may be negative). */
  | { kind: "add"; ms: number };

export interface TimerSettings {
  /** A chime in the app when a timer ends (as well as the desktop notification). */
  sound: boolean;
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = { sound: true };

export function cleanTimerSettings(s: Partial<TimerSettings> | null | undefined): TimerSettings {
  return { sound: typeof s?.sound === "boolean" ? s.sound : DEFAULT_TIMER_SETTINGS.sound };
}

export interface TimerWidgetSettings {
  timerTab?: "timers" | "stopwatch";
  /** This widget's stopwatch. */
  stopwatchId?: string;
}

export const MIN_MS = 60_000;
/** The longest timer: 99 hours. */
export const MAX_TIMER_MS = 99 * 3_600_000;
export const TIMER_PRESETS = [1, 3, 5, 10, 15, 25, 30, 60];

export const isRunning = (t: TimerRow) => t.startedAt !== null;

export function elapsed(t: TimerRow, now: number): number {
  return t.accumulatedMs + (t.startedAt !== null ? Math.max(0, now - t.startedAt) : 0);
}

/** Timers: time left (negative once it has ended and is still running over). */
export function remaining(t: TimerRow, now: number): number {
  return t.durationMs - elapsed(t, now);
}

/** When a running timer ends, or null. */
export function endsAt(t: TimerRow): number | null {
  if (t.kind !== "timer" || t.startedAt === null) return null;
  return t.startedAt + (t.durationMs - t.accumulatedMs);
}

export function statusOf(t: TimerRow, now: number): TimerStatus {
  if (t.kind === "timer" && elapsed(t, now) >= t.durationMs && (t.startedAt !== null || t.accumulatedMs > 0)) return "done";
  if (t.startedAt !== null) return "running";
  return t.accumulatedMs > 0 ? "paused" : "idle";
}

/** What an action does to a timer, at `now`. Pure: main applies it and saves. */
export function applyAction(t: TimerRow, a: TimerAction, now: number): TimerRow {
  switch (a.kind) {
    case "start": {
      if (t.startedAt !== null) return t;
      // a finished timer starts again from the top
      if (statusOf(t, now) === "done") return { ...t, accumulatedMs: 0, startedAt: now, firedAt: null };
      return { ...t, startedAt: now };
    }
    case "pause":
      if (t.startedAt === null) return t;
      return { ...t, accumulatedMs: elapsed(t, now), startedAt: null };
    case "reset":
      return { ...t, accumulatedMs: 0, startedAt: null, laps: [], firedAt: null };
    case "lap":
      if (t.kind !== "stopwatch" || t.startedAt === null) return t;
      return { ...t, laps: [...t.laps, elapsed(t, now)] };
    case "add": {
      if (t.kind !== "timer") return t;
      const e = elapsed(t, now);
      if (statusOf(t, now) === "done") {
        // on a finished timer, +1 min means one more minute from now, running
        return { ...t, durationMs: Math.min(MAX_TIMER_MS, e + Math.max(1000, a.ms)), firedAt: null, accumulatedMs: e, startedAt: now };
      }
      return { ...t, durationMs: Math.min(MAX_TIMER_MS, Math.max(1000, t.durationMs + a.ms)) };
    }
  }
}

/* --------------------------------------------------------------- parsing -- */

const UNIT: Record<string, number> = {
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  m: MIN_MS,
  min: MIN_MS,
  mins: MIN_MS,
  minute: MIN_MS,
  minutes: MIN_MS,
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
};

const DURATION_RE =
  /(?:\b\d{1,2}:\d{2}(?::\d{2})?\b)|(?:\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b(?:\s*(?:and\s+)?\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b)*(?:\s*\d+\b(?!\s*[:.]))?)|(?:\b(?:half an hour|an hour|a minute|quarter of an hour)\b)/i;

/**
 * "10" (minutes), "90s", "1h30", "1h 30m", "1 hour and 5 minutes", "1.5h",
 * "5:00" (m:ss), "1:02:03" (h:mm:ss), "half an hour". Null if it isn't one.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  let ms: number | null = null;
  if (/^\d+(?:\.\d+)?$/.test(s)) ms = Number(s) * MIN_MS;
  else if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(s)) {
    const p = s.split(":").map(Number);
    if (p.some((n, i) => i > 0 && n >= 60)) return null;
    ms = p.length === 3 ? (p[0]! * 3600 + p[1]! * 60 + p[2]!) * 1000 : (p[0]! * 60 + p[1]!) * 1000;
  } else if (s === "half an hour") ms = 30 * MIN_MS;
  else if (s === "an hour") ms = 3_600_000;
  else if (s === "a minute") ms = MIN_MS;
  else if (s === "quarter of an hour") ms = 15 * MIN_MS;
  else {
    const parts = [...s.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)?/g)];
    const rest = s.replace(/(\d+(?:\.\d+)?)\s*([a-z]+)?/g, "").replace(/\band\b/g, "").trim();
    if (!parts.length || rest) return null;
    ms = 0;
    let last = 0;
    for (const [, n, u] of parts) {
      let unit = u ? UNIT[u] : undefined;
      // "1h30": a bare number after a unit is the next unit down
      if (!u) unit = last === 3_600_000 ? MIN_MS : last === MIN_MS ? 1000 : undefined;
      if (!unit) return null;
      ms += Number(n) * unit;
      last = unit;
    }
  }
  if (ms === null || !Number.isFinite(ms) || ms < 1000 || ms > MAX_TIMER_MS) return null;
  return Math.round(ms / 1000) * 1000;
}

/** "25m focus", "tea 4 min", "1:30 eggs" → duration and label. */
export function parseTimerInput(input: string): { ms: number; label: string } | null {
  const s = input.trim();
  const whole = parseDuration(s);
  if (whole !== null) return { ms: whole, label: "" };
  const m = DURATION_RE.exec(s);
  if (!m) {
    // "eggs 7": a trailing or leading bare number is minutes
    const bare = /^(\d+(?:\.\d+)?)\s+(.+)$|^(.+?)\s+(\d+(?:\.\d+)?)$/.exec(s);
    if (!bare) return null;
    const ms = parseDuration(bare[1] ?? bare[4]!);
    return ms === null ? null : { ms, label: (bare[2] ?? bare[3]!).trim() };
  }
  const ms = parseDuration(m[0]);
  if (ms === null) return null;
  const label = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length))
    .replace(/\b(?:for|timer)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–:,]\s*|\s*[-–:,]$/g, "");
  return { ms, label };
}

/* ------------------------------------------------------------ formatting -- */

/** 1:02:03, 5:00, 0:07. Negative values get a leading "−". `ceil` rounds up (for counting down). */
export function formatClock(ms: number, opts: { ceil?: boolean } = {}): string {
  const neg = ms < 0;
  const abs = Math.abs(ms);
  const total = opts.ceil && !neg ? Math.ceil(abs / 1000) : Math.floor(abs / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return `${neg ? "−" : ""}${body}`;
}

/** Stopwatch: 0:07.42, 12:03.10, 1:02:03.55 (hundredths, always rounded down). */
export function formatStopwatch(ms: number): string {
  const cs = Math.floor(Math.max(0, ms) / 10) % 100;
  return `${formatClock(Math.max(0, ms))}.${String(cs).padStart(2, "0")}`;
}

/** "5 min", "1 h 30 min", "45 s", "1 min 30 s". */
export function durationLabel(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : "", s ? `${s} s` : ""].filter(Boolean).join(" ") || "0 s";
}

export interface LapRow {
  n: number;
  lap: number;
  total: number;
  best: boolean;
  worst: boolean;
}

/** Laps newest first, with the fastest and slowest marked once there are 3 or more. */
export function lapRows(laps: number[]): LapRow[] {
  const rows = laps.map((total, i) => ({ n: i + 1, lap: total - (laps[i - 1] ?? 0), total, best: false, worst: false }));
  if (rows.length >= 3) {
    const lapsOnly = rows.map((r) => r.lap);
    const min = Math.min(...lapsOnly);
    const max = Math.max(...lapsOnly);
    if (min !== max) {
      rows.find((r) => r.lap === min)!.best = true;
      rows.find((r) => r.lap === max)!.worst = true;
    }
  }
  return rows.reverse();
}

/** Display order: running (ending soonest first), then finished, paused, idle; newest first within each. */
export function sortTimers(list: TimerRow[], now: number): TimerRow[] {
  const rank: Record<TimerStatus, number> = { done: 0, running: 1, paused: 2, idle: 3 };
  return [...list].sort((a, b) => {
    const ra = rank[statusOf(a, now)];
    const rb = rank[statusOf(b, now)];
    if (ra !== rb) return ra - rb;
    if (ra === 1) return remaining(a, now) - remaining(b, now);
    return b.createdAt - a.createdAt;
  });
}
