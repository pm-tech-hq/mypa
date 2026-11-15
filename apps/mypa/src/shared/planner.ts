/**
 * Daily Planner: the plan for a day is a list of time blocks. Tasks, calendar
 * events and reminders stay where they live; a task block only points at its
 * task (so ticking either one ticks both) and events are read straight from the
 * calendar. Everything here is pure, so the widget, the main process and the
 * Assistant all plan the same way.
 */

export type PlanBlockKind = "task" | "focus" | "break" | "custom";
export type PlanStatus = "draft" | "approved";

export interface PlanBlock {
  id: string;
  /** "YYYY-MM-DD", local. */
  day: string;
  kind: PlanBlockKind;
  /** For task blocks: the task it's time for. */
  taskId: string | null;
  /** Kept for custom blocks, and as a fallback if the task is deleted. */
  title: string;
  start: number;
  end: number;
  /** For non-task blocks; a task block's done is its task's. */
  done: boolean;
  /** Re-planning and fixing leave locked blocks where they are. */
  locked: boolean;
}

/** What the widget sends to save a day (id is made for new blocks). */
export type PlanBlockInput = Omit<PlanBlock, "id" | "day"> & { id?: string };

export interface PlanDay {
  day: string;
  status: PlanStatus;
  approvedAt: number | null;
  /** "What matters most today?" */
  intention: string;
}

export interface PlannerSettings {
  /** "HH:MM" */
  dayStart: string;
  dayEnd: string;
  lunch: boolean;
  lunchStart: string;
  lunchMinutes: number;
  /** Breathing room after each block. */
  gap: number;
  /** Length of a task block when the task has none yet. */
  defaultMinutes: number;
  /** Kept clear before and after meetings. */
  meetingBuffer: number;
  /** Desktop alert when each block of an approved plan for today starts. */
  alerts: boolean;
}

export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
  dayStart: "09:00",
  dayEnd: "17:30",
  lunch: true,
  lunchStart: "12:30",
  lunchMinutes: 45,
  gap: 10,
  defaultMinutes: 45,
  meetingBuffer: 0,
  alerts: true,
};

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function cleanPlannerSettings(s: Partial<PlannerSettings> | null | undefined): PlannerSettings {
  const d = DEFAULT_PLANNER_SETTINGS;
  const hm = (v: unknown, def: string) => (typeof v === "string" && HM.test(v) ? v : def);
  const num = (v: unknown, def: number, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def;
  const out: PlannerSettings = {
    dayStart: hm(s?.dayStart, d.dayStart),
    dayEnd: hm(s?.dayEnd, d.dayEnd),
    lunch: typeof s?.lunch === "boolean" ? s.lunch : d.lunch,
    lunchStart: hm(s?.lunchStart, d.lunchStart),
    lunchMinutes: num(s?.lunchMinutes, d.lunchMinutes, 10, 180),
    gap: num(s?.gap, d.gap, 0, 60),
    defaultMinutes: num(s?.defaultMinutes, d.defaultMinutes, 10, 240),
    meetingBuffer: num(s?.meetingBuffer, d.meetingBuffer, 0, 60),
    alerts: typeof s?.alerts === "boolean" ? s.alerts : d.alerts,
  };
  if (minutesOf(out.dayEnd) <= minutesOf(out.dayStart)) out.dayEnd = d.dayEnd;
  if (minutesOf(out.dayEnd) <= minutesOf(out.dayStart)) out.dayStart = d.dayStart;
  return out;
}

/* ------------------------------------------------------------------ time -- */

export const MIN = 60_000;

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isDayKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayStartMs(s));
}

/** Local midnight at the start of `day`. */
export function dayStartMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
}

export function dayEndMs(day: string): number {
  return dayStartMs(shiftDay(day, 1));
}

export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return dayKey(new Date(y, m - 1, d + n, 12).getTime());
}

export function minutesOf(hm: string): number {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** `day` at "HH:MM" (or at a number of minutes past midnight), DST-safe. */
export function atTime(day: string, hm: string | number): number {
  const mins = typeof hm === "number" ? hm : minutesOf(hm);
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60).getTime();
}

/** Minutes past local midnight of `ms`. */
export function minuteOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

export function roundUp(ms: number, step = 5): number {
  const s = step * MIN;
  return Math.ceil(ms / s) * s;
}

export function snap(ms: number, step = 5): number {
  const s = step * MIN;
  return Math.round(ms / s) * s;
}

export function durationLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "45m", "1h 30m": for tight spots. */
export function shortDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function dayTitle(day: string, today: string): string {
  const label = new Date(dayStartMs(day) + 12 * 3_600_000).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (day === today) return `Today · ${label}`;
  if (day === shiftDay(today, 1)) return `Tomorrow · ${label}`;
  if (day === shiftDay(today, -1)) return `Yesterday · ${label}`;
  return label;
}

/* ------------------------------------------------------------- intervals -- */

export interface Interval {
  start: number;
  end: number;
}

export interface Busy extends Interval {
  title: string;
  kind: "event" | "lunch" | "block";
  /** For events: the calendar event id. For blocks: the block id. */
  ref?: string;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function mergeIntervals(list: Interval[]): Interval[] {
  const s = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of s) {
    const last = out.at(-1);
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** The parts of `window` not covered by `taken`. */
export function freeSlots(window: Interval, taken: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cur = window.start;
  for (const t of mergeIntervals(taken)) {
    if (t.end <= cur) continue;
    if (t.start >= window.end) break;
    if (t.start > cur) out.push({ start: cur, end: Math.min(t.start, window.end) });
    cur = Math.max(cur, t.end);
  }
  if (cur < window.end) out.push({ start: cur, end: window.end });
  return out;
}

/** The working part of `day` still ahead (today starts at now, rounded up). */
export function workWindow(day: string, s: PlannerSettings, now: number): Interval {
  const start = atTime(day, s.dayStart);
  const end = atTime(day, s.dayEnd);
  const from = dayKey(now) === day ? Math.max(start, roundUp(now)) : start;
  return { start: Math.min(from, end), end };
}

export function lunchInterval(day: string, s: PlannerSettings): Interval | null {
  if (!s.lunch) return null;
  const start = atTime(day, s.lunchStart);
  return { start, end: start + s.lunchMinutes * MIN };
}

/* -------------------------------------------------------------- planning -- */

export type Importance = "high" | "medium" | "low";

export interface PlanTask {
  id: string;
  title: string;
  importance: Importance;
  due: number | null;
  sort: number;
}

/** Something to place: a task, or an existing block being moved. */
export interface PlaceItem {
  key: string;
  kind: PlanBlockKind;
  taskId: string | null;
  title: string;
  minutes: number;
  /** Can be split across gaps if no single gap fits it. */
  splittable: boolean;
}

export interface Placed {
  key: string;
  kind: PlanBlockKind;
  taskId: string | null;
  title: string;
  start: number;
  end: number;
}

export interface PlaceResult {
  placed: Placed[];
  unplaced: { key: string; title: string; minutes: number; reason: string }[];
}

const MIN_CHUNK = 25;
const IMPORTANCE_RANK: Record<Importance, number> = { high: 0, medium: 1, low: 2 };

/** Most important first, then soonest due, then the task list's own order. */
export function orderTasks<T extends PlanTask>(tasks: T[]): T[] {
  return [...tasks].sort(
    (a, b) =>
      IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] ||
      (a.due ?? Infinity) - (b.due ?? Infinity) ||
      a.sort - b.sort,
  );
}

/**
 * Where lunch goes on `day`: at its usual time, or moved up to an hour either
 * way off a meeting. null when lunch is off, a meeting covers most of it (a team
 * lunch, a long call) or meetings leave no room.
 */
export function placeLunch(day: string, s: PlannerSettings, events: Interval[]): Interval | null {
  const lunch = lunchInterval(day, s);
  if (!lunch) return null;
  const len = lunch.end - lunch.start;
  const covered = events.some((e) => Math.min(e.end, lunch.end) - Math.max(e.start, lunch.start) >= len / 2);
  if (covered) return null;
  for (const shift of [0, 15, -15, 30, -30, 45, -45, 60, -60]) {
    const c = { start: lunch.start + shift * MIN, end: lunch.end + shift * MIN };
    if (!events.some((t) => overlaps(t, c))) return c;
  }
  return null;
}

/**
 * Busy time for a day: timed events (not declined, with the meeting buffer),
 * lunch, and blocks that stay put. Events overlapping lunch push lunch away.
 */
export function busyFor(
  day: string,
  s: PlannerSettings,
  events: { id: string; title: string; start: number; end: number }[],
  keep: PlanBlock[],
): Busy[] {
  const from = dayStartMs(day);
  const to = dayEndMs(day);
  const out: Busy[] = [];
  for (const e of events) {
    if (e.end <= from || e.start >= to) continue;
    out.push({
      start: e.start - s.meetingBuffer * MIN,
      end: e.end + s.meetingBuffer * MIN,
      title: e.title,
      kind: "event",
      ref: e.id,
    });
  }
  for (const b of keep) out.push({ start: b.start, end: b.end, title: b.title, kind: "block", ref: b.id });
  const lunch = placeLunch(day, s, events);
  if (lunch) out.push({ ...lunch, title: "Lunch", kind: "lunch" });
  return out;
}

/**
 * First-fit placement into the free time of `window`, in the given order, with
 * `gap` minutes after each placed block. An item no single gap can hold is split
 * into chunks of at least 25 minutes when it's splittable.
 */
export function place(items: PlaceItem[], window: Interval, busy: Interval[], gap: number): PlaceResult {
  let slots = freeSlots(window, busy);
  const placed: Placed[] = [];
  const unplaced: PlaceResult["unplaced"] = [];

  const take = (slotIndex: number, start: number, end: number) => {
    const slot = slots[slotIndex]!;
    const after = { start: end + gap * MIN, end: slot.end };
    const before = { start: slot.start, end: start };
    slots = [
      ...slots.slice(0, slotIndex),
      ...(before.end - before.start >= 5 * MIN ? [before] : []),
      ...(after.end - after.start >= 5 * MIN ? [after] : []),
      ...slots.slice(slotIndex + 1),
    ];
  };

  for (const item of items) {
    const need = item.minutes * MIN;
    const i = slots.findIndex((s) => s.end - s.start >= need);
    if (i >= 0) {
      const start = slots[i]!.start;
      placed.push({ key: item.key, kind: item.kind, taskId: item.taskId, title: item.title, start, end: start + need });
      take(i, start, start + need);
      continue;
    }
    const room = slots.filter((s) => s.end - s.start >= MIN_CHUNK * MIN).reduce((n, s) => n + (s.end - s.start), 0);
    if (!item.splittable || item.minutes < MIN_CHUNK * 2 || room < need) {
      const free = slots.reduce((n, s) => n + (s.end - s.start), 0) / MIN;
      unplaced.push({
        key: item.key,
        title: item.title,
        minutes: item.minutes,
        reason:
          free < 5
            ? "No free time left in the day"
            : `Needs ${durationLabel(item.minutes)}; the longest gap left is ${durationLabel(
                Math.max(0, ...slots.map((s) => (s.end - s.start) / MIN)),
              )}`,
      });
      continue;
    }
    let left = need;
    while (left > 0) {
      const j = slots.findIndex((s) => s.end - s.start >= Math.min(left, MIN_CHUNK * MIN));
      if (j < 0) break;
      const s = slots[j]!;
      let len = Math.min(left, s.end - s.start);
      // don't leave a stub shorter than a chunk for later
      if (left - len > 0 && left - len < MIN_CHUNK * MIN) len = Math.max(MIN_CHUNK * MIN, left - MIN_CHUNK * MIN);
      placed.push({ key: item.key, kind: item.kind, taskId: item.taskId, title: item.title, start: s.start, end: s.start + len });
      take(j, s.start, s.start + len);
      left -= len;
    }
  }
  return { placed, unplaced };
}

/** The usual length of a task's block: its last block, else the default. */
export function taskMinutes(taskId: string, blocks: PlanBlock[], s: PlannerSettings): number {
  const own = blocks.filter((b) => b.taskId === taskId && b.kind === "task");
  if (!own.length) return s.defaultMinutes;
  // a split task's length is the sum of its parts on its latest day
  const lastDay = own.reduce((d, b) => (b.day > d ? b.day : d), own[0]!.day);
  return Math.round(own.filter((b) => b.day === lastDay).reduce((n, b) => n + (b.end - b.start), 0) / MIN);
}

/** Blocks a re-plan leaves alone: locked ones, done ones, non-task ones and anything already over. */
export function staysPut(b: PlanBlock, taskDone: (id: string) => boolean, now: number): boolean {
  if (b.locked || b.kind !== "task") return true;
  if (b.end <= now) return true;
  return b.taskId ? taskDone(b.taskId) : b.done;
}

export interface DraftInput {
  day: string;
  now: number;
  settings: PlannerSettings;
  /** Timed calendar events for the day (declined left out). */
  events: { id: string; title: string; start: number; end: number }[];
  /** The day's current blocks. */
  blocks: PlanBlock[];
  /** Every block (for remembered task lengths). */
  history: PlanBlock[];
  /** Open tasks that could go in the plan. */
  tasks: PlanTask[];
  taskDone: (id: string) => boolean;
}

/** A fresh draft: keeps what stays put, then places every open task by priority. */
export function draftPlan(input: DraftInput): { blocks: PlanBlockInput[]; unplaced: PlaceResult["unplaced"] } {
  const { day, now, settings: s } = input;
  const keep = input.blocks.filter((b) => staysPut(b, input.taskDone, now));
  const keptTasks = new Set(keep.filter((b) => b.taskId).map((b) => b.taskId!));
  const items: PlaceItem[] = orderTasks(input.tasks.filter((t) => !keptTasks.has(t.id))).map((t) => ({
    key: t.id,
    kind: "task",
    taskId: t.id,
    title: t.title,
    minutes: taskMinutes(t.id, input.history, s),
    splittable: true,
  }));
  const busy = busyFor(day, s, input.events, keep);
  const { placed, unplaced } = place(items, workWindow(day, s, now), busy, s.gap);
  return {
    blocks: [
      ...keep.map(toInput),
      ...placed.map((p) => ({
        kind: p.kind,
        taskId: p.taskId,
        title: p.title,
        start: p.start,
        end: p.end,
        done: false,
        locked: false,
      })),
    ].sort((a, b) => a.start - b.start),
    unplaced,
  };
}

export function toInput(b: PlanBlock): PlanBlockInput {
  return {
    id: b.id,
    kind: b.kind,
    taskId: b.taskId,
    title: b.title,
    start: b.start,
    end: b.end,
    done: b.done,
    locked: b.locked,
  };
}

/**
 * Moves only the blocks in `move` to the next free time (keeping their
 * length), leaving everything else where it is.
 */
export function reflow(
  day: string,
  now: number,
  s: PlannerSettings,
  events: DraftInput["events"],
  blocks: PlanBlock[],
  move: Set<string>,
): { blocks: PlanBlockInput[]; unplaced: PlaceResult["unplaced"] } {
  const keep = blocks.filter((b) => !move.has(b.id));
  const moving = blocks.filter((b) => move.has(b.id)).sort((a, b) => a.start - b.start);
  const busy = busyFor(day, s, events, keep);
  // a moved block goes no earlier than now and stays inside the working day if it can
  const win = workWindow(day, s, now);
  const items = moving.map<PlaceItem>((b) => ({
    key: b.id,
    kind: b.kind,
    taskId: b.taskId,
    title: b.title,
    minutes: Math.round((b.end - b.start) / MIN),
    splittable: false,
  }));
  const { placed, unplaced } = place(items, win, busy, s.gap);
  const byKey = new Map(moving.map((b) => [b.id, b]));
  return {
    blocks: [
      ...keep.map(toInput),
      ...placed.map((p) => ({ ...toInput(byKey.get(p.key)!), start: p.start, end: p.end })),
    ].sort((a, b) => a.start - b.start),
    unplaced,
  };
}

/** Next free start for a block of `minutes`, from `from` on (null if the day is full). */
export function nextFree(
  day: string,
  s: PlannerSettings,
  now: number,
  events: DraftInput["events"],
  blocks: PlanBlock[],
  minutes: number,
  from?: number,
): number | null {
  const win = workWindow(day, s, now);
  if (from !== undefined) win.start = Math.max(win.start, from);
  const busy = busyFor(day, s, events, blocks);
  const slot = freeSlots(win, busy).find((x) => x.end - x.start >= minutes * MIN);
  return slot ? slot.start : null;
}

/* ------------------------------------------------------------- conflicts -- */

export interface Conflicts {
  /** Block id → what's wrong with it. */
  byBlock: Map<string, string[]>;
  /** Meetings that overlap each other ("2 meetings overlap at 2:00 PM"). */
  doubleBooked: { a: string; b: string; at: number }[];
}

export function findConflicts(
  day: string,
  s: PlannerSettings,
  events: DraftInput["events"],
  blocks: PlanBlock[],
  isDone: (b: PlanBlock) => boolean,
): Conflicts {
  const byBlock = new Map<string, string[]>();
  const add = (id: string, why: string) => {
    const l = byBlock.get(id) ?? [];
    if (!l.includes(why)) l.push(why);
    byBlock.set(id, l);
  };
  const dayEnd = atTime(day, s.dayEnd);
  const dayStart = atTime(day, s.dayStart);
  const open = blocks.filter((b) => !isDone(b));
  for (const b of open) {
    for (const e of events) if (overlaps(b, e)) add(b.id, `Overlaps “${e.title || "a meeting"}”`);
    for (const o of blocks) if (o.id !== b.id && overlaps(b, o)) add(b.id, `Overlaps “${o.title}”`);
    // only work goes inside working hours; gym at 6pm is fine
    if (b.kind === "task") {
      if (b.end > dayEnd) add(b.id, "Runs past the end of your day");
      else if (b.start < dayStart) add(b.id, "Starts before your day does");
    }
  }
  const timed = [...events].sort((a, b) => a.start - b.start);
  const doubleBooked: Conflicts["doubleBooked"] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length && timed[j]!.start < timed[i]!.end; j++) {
      doubleBooked.push({ a: timed[i]!.title, b: timed[j]!.title, at: timed[j]!.start });
    }
  }
  return { byBlock, doubleBooked };
}

/**
 * The fewest blocks to move to clear the clashes: anything on a meeting or
 * outside the day, and from each pair of clashing blocks just one (the later,
 * or the unlocked one). Locked and done blocks never move.
 */
export function clashMovers(
  day: string,
  s: PlannerSettings,
  events: Interval[],
  blocks: PlanBlock[],
  isDone: (b: PlanBlock) => boolean,
): Set<string> {
  const open = blocks.filter((b) => !isDone(b)).sort((a, b) => a.start - b.start);
  const dayStart = atTime(day, s.dayStart);
  const dayEnd = atTime(day, s.dayEnd);
  const move = new Set<string>();
  for (const b of open) {
    if (b.locked) continue;
    const outside = b.kind === "task" && (b.end > dayEnd || b.start < dayStart);
    if (outside || events.some((e) => overlaps(b, e))) move.add(b.id);
  }
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i]!;
      const b = open[j]!;
      if (!overlaps(a, b) || move.has(a.id) || move.has(b.id)) continue;
      if (!b.locked) move.add(b.id);
      else if (!a.locked) move.add(a.id);
    }
  }
  return move;
}

/* --------------------------------------------------------------- summary -- */

/**
 * Minutes planned (every block but breaks), in meetings (that day) and still
 * free in the working day: from now on for today, none for a past day.
 */
export function summarize(
  day: string,
  s: PlannerSettings,
  events: DraftInput["events"],
  blocks: PlanBlock[],
  now: number = Date.now(),
): { planned: number; meetings: number; free: number } {
  const from = dayStartMs(day);
  const to = dayEndMs(day);
  const inDay = (i: Interval) => ({ start: Math.max(i.start, from), end: Math.min(i.end, to) });
  const len = (l: Interval[]) => mergeIntervals(l).reduce((n, i) => n + Math.max(0, i.end - i.start), 0);
  const meetings = len(events.map(inDay));
  const planned = len(blocks.filter((b) => b.kind !== "break"));
  const win = workWindow(day, s, now);
  const freeTime =
    dayKey(now) > day
      ? 0
      : freeSlots(win, [...events, ...blocks, ...(placeLunch(day, s, events) ? [placeLunch(day, s, events)!] : [])]).reduce(
          (n, x) => n + (x.end - x.start),
          0,
        );
  return {
    planned: Math.round(planned / MIN),
    meetings: Math.round(meetings / MIN),
    free: Math.max(0, Math.round(freeTime / MIN)),
  };
}

/* -------------------------------------------------- side-by-side layout -- */

/** Columns for overlapping items on the timeline: each gets a column and the cluster's width. */
export function columns<T extends Interval>(items: T[]): Map<T, { col: number; cols: number }> {
  const out = new Map<T, { col: number; cols: number }>();
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: T[] = [];
  let clusterEnd = -Infinity;
  let colEnds: number[] = [];
  const flush = () => {
    const cols = colEnds.length || 1;
    for (const it of cluster) out.get(it)!.cols = cols;
    cluster = [];
    colEnds = [];
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let col = colEnds.findIndex((e) => e <= it.start);
    if (col < 0) {
      col = colEnds.length;
      colEnds.push(it.end);
    } else colEnds[col] = it.end;
    out.set(it, { col, cols: 1 });
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

/* ------------------------------------------------------------ quick add -- */

export interface ParsedBlock {
  title: string;
  /** null when no time was said. */
  start: number | null;
  minutes: number | null;
  kind: PlanBlockKind;
}

const TIME = String.raw`(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?`;

function toMinutes(h: number, m: number, ap: string | undefined, guessPm: boolean): number | null {
  if (h > 23 || m > 59) return null;
  const a = ap?.replace(/\./g, "").toLowerCase();
  if (a) {
    if (h < 1 || h > 12) return null;
    return ((h % 12) + (a === "pm" ? 12 : 0)) * 60 + m;
  }
  // a bare "3" on a work day means 3 PM; "9" means 9 AM
  if (h <= 12 && guessPm && h < 7) return (h + 12) * 60 + m;
  return h * 60 + m;
}

/**
 * "Deep work 2-4pm", "Gym at 6pm for 1h", "Review PR 30m", "Break 3:15 15 min".
 * Times are on `day`; a block with no time gets start null.
 */
export function parseBlock(text: string, day: string): ParsedBlock {
  let t = ` ${text.trim()} `;
  let start: number | null = null;
  let minutes: number | null = null;

  const range = new RegExp(String.raw`\s(?:from\s+)?${TIME}\s*(?:-|–|—|to|until|till)\s*${TIME}(?=\s)`, "i").exec(t);
  if (range) {
    const [h1, m1, h2, m2] = [range[1], range[2], range[4], range[5]].map((x) => Number(x ?? 0)) as [
      number, number, number, number,
    ];
    const ap1 = range[3];
    const ap2 = range[6];
    // "2-4pm": the start shares the end's am/pm, unless that puts it after the end ("11-1pm")
    const b = toMinutes(h2, m2, ap2, !ap2);
    let a = toMinutes(h1, m1, ap1 ?? ap2, !ap1 && !ap2);
    if (!ap1 && ap2 && a !== null && b !== null && a >= b) {
      a = toMinutes(h1, m1, /^p/i.test(ap2) ? "am" : "pm", false);
    }
    if (a !== null && b !== null && b > a) {
      start = atTime(day, a);
      minutes = b - a;
      t = t.replace(range[0], " ");
    }
  }

  const dur = /\s(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)(?=\s)/i.exec(t);
  if (dur) {
    const n = Number(dur[1]);
    const m = /^h/i.test(dur[2]!) ? Math.round(n * 60) : Math.round(n);
    if (m >= 5 && m <= 12 * 60) {
      minutes = minutes ?? m;
      t = t.replace(dur[0], " ");
    }
  }
  const half = /\s(?:for\s+)?(half an hour|an hour|one hour)(?=\s)/i.exec(t);
  if (half && minutes === null) {
    minutes = /half/i.test(half[1]!) ? 30 : 60;
    t = t.replace(half[0], " ");
  }

  if (start === null) {
    const at =
      new RegExp(String.raw`\s(?:at|@)\s+${TIME}(?=\s)`, "i").exec(t) ??
      new RegExp(String.raw`\s(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s)`, "i").exec(t) ??
      /\s(\d{1,2}):([0-5]\d)()(?=\s)/.exec(t);
    if (at) {
      const m = toMinutes(Number(at[1]), Number(at[2] ?? 0), at[3] || undefined, !at[3]);
      if (m !== null) {
        start = atTime(day, m);
        t = t.replace(at[0], " ");
      }
    }
  }

  const title = t.replace(/\s+/g, " ").trim();
  const kind: PlanBlockKind = /^(break|coffee|rest|walk|stretch)\b/i.test(title)
    ? "break"
    : /^(focus|deep work|heads? down)\b/i.test(title)
      ? "focus"
      : "custom";
  return { title, start, minutes, kind };
}
