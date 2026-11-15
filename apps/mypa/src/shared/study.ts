/**
 * Study Planner: subjects (with a weekly time goal), exams (with topics) and
 * study sessions. A session is a block of time; it never overlaps a calendar
 * event, a fixed part of the day plan or another session. All the planning is
 * pure, so the widget, the main process and the Assistant agree on it.
 */

import {
  atTime,
  clock,
  dayEndMs,
  dayKey,
  dayStartMs,
  freeSlots,
  isDayKey,
  MIN,
  minutesOf,
  shiftDay,
  type Interval,
} from "./planner";

export interface StudySubject {
  id: string;
  name: string;
  /** A page colour name. */
  color: string;
  /** Minutes a week you aim to study it; 0 = no goal. */
  weeklyMinutes: number;
  archived: boolean;
  sort: number;
  createdAt: number;
}

export interface StudyExam {
  id: string;
  subjectId: string;
  title: string;
  /** "YYYY-MM-DD" */
  day: string;
  /** "HH:MM" or null when only the day is known. */
  time: string | null;
  topics: string[];
  createdAt: number;
}

export interface StudySession {
  id: string;
  subjectId: string;
  /** Revision for this exam, if any. */
  examId: string | null;
  topic: string;
  start: number;
  end: number;
  done: boolean;
  /** Minutes actually studied (from the timer, or the length when ticked). */
  studied: number | null;
  notes: string;
  createdAt: number;
}

export type SubjectPatch = Partial<Pick<StudySubject, "name" | "color" | "weeklyMinutes" | "archived" | "sort">>;
export type ExamPatch = Partial<Pick<StudyExam, "subjectId" | "title" | "day" | "time" | "topics">>;
export type SessionInput = Pick<StudySession, "subjectId" | "topic" | "start" | "end"> &
  Partial<Pick<StudySession, "examId" | "notes" | "done" | "studied">>;
export type SessionPatch = Partial<
  Pick<StudySession, "subjectId" | "examId" | "topic" | "start" | "end" | "done" | "studied" | "notes">
>;

export interface StudySettings {
  /** "HH:MM": when study time can start and must end. */
  dayStart: string;
  dayEnd: string;
  /** Weekdays you study, 0 = Sunday. */
  days: number[];
  /** Usual length of a session. */
  sessionMinutes: number;
  /** Kept free after each session. */
  breakMinutes: number;
  /** Most study time the planner puts in one day. */
  maxPerDay: number;
  /** Desktop alert when a session starts. */
  alerts: boolean;
}

export const DEFAULT_STUDY_SETTINGS: StudySettings = {
  dayStart: "08:00",
  dayEnd: "21:00",
  days: [0, 1, 2, 3, 4, 5, 6],
  sessionMinutes: 50,
  breakMinutes: 10,
  maxPerDay: 180,
  alerts: true,
};

export const SESSION_LENGTHS = [25, 30, 45, 50, 60, 75, 90, 120];
export const WEEKLY_GOALS = [0, 60, 90, 120, 180, 240, 300, 360, 480, 600];

export interface StudyWidgetSettings {
  studyTab?: "week" | "subjects";
  /** Monday of the week shown; absent = this week. */
  studyWeek?: string;
  /** The session the timer is running for. */
  studyTimer?: { id: string; startedAt: number } | null;
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHm(v: unknown): v is string {
  return typeof v === "string" && HM.test(v);
}

export function cleanStudySettings(s: Partial<StudySettings> | null | undefined): StudySettings {
  const d = DEFAULT_STUDY_SETTINGS;
  const num = (v: unknown, def: number, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def;
  const days = Array.isArray(s?.days)
    ? [...new Set(s.days.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
    : d.days;
  const out: StudySettings = {
    dayStart: isHm(s?.dayStart) ? s.dayStart : d.dayStart,
    dayEnd: isHm(s?.dayEnd) ? s.dayEnd : d.dayEnd,
    days: days.length ? days : d.days,
    sessionMinutes: num(s?.sessionMinutes, d.sessionMinutes, 15, 240),
    breakMinutes: num(s?.breakMinutes, d.breakMinutes, 0, 60),
    maxPerDay: num(s?.maxPerDay, d.maxPerDay, 30, 720),
    alerts: typeof s?.alerts === "boolean" ? s.alerts : d.alerts,
  };
  if (minutesOf(out.dayEnd) - minutesOf(out.dayStart) < 30) {
    out.dayStart = d.dayStart;
    out.dayEnd = d.dayEnd;
  }
  return out;
}

/* ------------------------------------------------------------------ days -- */

/** Monday of the week `day` is in. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const wd = new Date(y, m - 1, d, 12).getDay();
  return shiftDay(day, -((wd + 6) % 7));
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
}

export function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).getDay();
}

export function daysUntilDay(day: string, today: string): number {
  return Math.round((dayStartMs(day) - dayStartMs(today)) / 86_400_000);
}

export function weekLabel(monday: string, today: string): string {
  const thisWeek = weekStart(today);
  if (monday === thisWeek) return "This week";
  if (monday === shiftDay(thisWeek, 7)) return "Next week";
  if (monday === shiftDay(thisWeek, -7)) return "Last week";
  const a = new Date(dayStartMs(monday));
  const b = new Date(dayStartMs(shiftDay(monday, 6)));
  const f = (x: Date, month: boolean) =>
    x.toLocaleDateString(undefined, month ? { day: "numeric", month: "short" } : { day: "numeric" });
  return a.getMonth() === b.getMonth() ? `${f(a, false)}–${f(b, true)}` : `${f(a, true)} – ${f(b, true)}`;
}

export function examWhen(exam: StudyExam, today: string): string {
  const n = daysUntilDay(exam.day, today);
  if (n < 0) return n === -1 ? "Yesterday" : `${-n} days ago`;
  if (n === 0) return exam.time ? `Today at ${exam.time}` : "Today";
  if (n === 1) return exam.time ? `Tomorrow at ${exam.time}` : "Tomorrow";
  return `In ${n} days`;
}

export function minutesLabel(m: number): string {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function sessionMinutes(s: Pick<StudySession, "start" | "end">): number {
  return Math.round((s.end - s.start) / MIN);
}

/** Topics from a typed list: one per line, or separated by commas or semicolons. */
export function parseTopics(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n;,]+/)) {
    const t = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out.slice(0, 40);
}

/* ------------------------------------------------------------------ busy -- */

export interface StudyBusy extends Interval {
  title: string;
  kind: "event" | "plan" | "study";
  ref: string;
}

interface BusySources {
  events: { id: string; title: string; start: number; end: number }[];
  /** Day-plan blocks that are fixed: locked, or on a day whose plan is approved. */
  blocks: { id: string; title: string; start: number; end: number }[];
  sessions: Pick<StudySession, "id" | "subjectId" | "topic" | "start" | "end">[];
  subjectName: (id: string) => string;
}

/** Everything a study session must not overlap, from `from` to `to`. */
export function studyBusy(src: BusySources, from: number, to: number, exclude?: string): StudyBusy[] {
  const out: StudyBusy[] = [];
  const keep = (i: Interval) => i.start < to && i.end > from;
  for (const e of src.events) if (keep(e)) out.push({ start: e.start, end: e.end, title: e.title || "(no title)", kind: "event", ref: e.id });
  for (const b of src.blocks) if (keep(b)) out.push({ start: b.start, end: b.end, title: b.title, kind: "plan", ref: b.id });
  for (const s of src.sessions) {
    if (s.id === exclude || !keep(s)) continue;
    const name = src.subjectName(s.subjectId);
    out.push({ start: s.start, end: s.end, title: s.topic ? `${name}: ${s.topic}` : name, kind: "study", ref: s.id });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function clashesOf(slot: Interval, busy: StudyBusy[]): StudyBusy[] {
  return busy.filter((b) => b.start < slot.end && slot.start < b.end);
}

export function clashMessage(c: StudyBusy): string {
  const t = clock;
  const what = c.kind === "study" ? "the study session" : c.kind === "plan" ? "your day plan's" : "";
  return `That clashes with ${what ? `${what} ` : ""}“${c.title}” (${t(c.start)}–${t(c.end)}).`;
}

/** The study hours of `day` still ahead of `now`. */
export function studyWindow(day: string, s: StudySettings, now: number): Interval | null {
  const start = Math.max(atTime(day, s.dayStart), Math.ceil(now / (5 * MIN)) * 5 * MIN);
  const end = atTime(day, s.dayEnd);
  return end - start >= 15 * MIN ? { start, end } : null;
}

/**
 * The first free stretch of `minutes` on `day` inside study hours, keeping
 * a break clear before and after other sessions and events.
 */
export function findSlot(
  day: string,
  minutes: number,
  s: StudySettings,
  busy: Interval[],
  now: number,
  after?: number,
): Interval | null {
  const win = studyWindow(day, s, Math.max(now, after ?? 0));
  if (!win) return null;
  const pad = s.breakMinutes * MIN;
  const taken = busy.map((b) => ({ start: b.start - pad, end: b.end + pad }));
  for (const f of freeSlots(win, taken)) {
    if (f.end - f.start >= minutes * MIN) return { start: f.start, end: f.start + minutes * MIN };
  }
  return null;
}

/** Studied or planned minutes on a day. */
function dayLoad(day: string, sessions: Interval[]): number {
  const from = dayStartMs(day);
  const to = dayEndMs(day);
  return sessions.reduce((n, x) => (x.start < to && x.end > from ? n + (x.end - x.start) / MIN : n), 0);
}

/** The next free slot from `day` on (up to two weeks), on a study day. */
export function nextSlot(
  day: string,
  minutes: number,
  s: StudySettings,
  busyFor: (day: string) => Interval[],
  now: number,
  after?: number,
): Interval | null {
  for (let i = 0; i < 14; i++) {
    const d = shiftDay(day, i);
    if (i > 0 && !s.days.includes(weekday(d))) continue;
    const slot = findSlot(d, minutes, s, busyFor(d), now, i === 0 ? after : undefined);
    if (slot) return slot;
  }
  return null;
}

/* -------------------------------------------------------------- planning -- */

export interface DraftSession {
  key: string;
  subjectId: string;
  examId: string | null;
  topic: string;
  start: number;
  end: number;
}

export interface PlanInput {
  subjects: StudySubject[];
  exams: StudyExam[];
  sessions: StudySession[];
  settings: StudySettings;
  /** Busy time from the calendar and the day plan (not study sessions). */
  busyFor: (day: string) => Interval[];
  now: number;
}

/** Minutes of a subject booked in the week starting `monday` (done or not). */
export function weekMinutes(subjectId: string, sessions: StudySession[], monday: string): { planned: number; done: number } {
  const from = dayStartMs(monday);
  const to = dayStartMs(shiftDay(monday, 7));
  let planned = 0;
  let done = 0;
  for (const x of sessions) {
    if (x.subjectId !== subjectId || x.start < from || x.start >= to) continue;
    planned += sessionMinutes(x);
    if (x.done) done += x.studied ?? sessionMinutes(x);
  }
  return { planned, done };
}

function nextExam(subjectId: string, exams: StudyExam[], today: string): StudyExam | null {
  return (
    exams
      .filter((e) => e.subjectId === subjectId && e.day >= today)
      .sort((a, b) => a.day.localeCompare(b.day))[0] ?? null
  );
}

/** Topics of an exam that no session covers yet. */
export function uncoveredTopics(exam: StudyExam, sessions: StudySession[]): string[] {
  const have = new Set(
    sessions.filter((x) => x.examId === exam.id || x.subjectId === exam.subjectId).map((x) => x.topic.toLowerCase()),
  );
  return exam.topics.filter((t) => !have.has(t.toLowerCase()));
}

/**
 * Fills what's left of the week: each subject with a weekly goal gets sessions
 * until its booked time meets the goal. Subjects with an exam coming up go
 * first; one session per subject per day before any gets a second, so
 * subjects are interleaved across the week. Never more than `maxPerDay`.
 */
export function planWeek(input: PlanInput, monday: string): DraftSession[] {
  const { settings: s, now } = input;
  const today = dayKey(now);
  const days = weekDays(monday).filter((d) => d >= today && s.days.includes(weekday(d)));
  const placed: DraftSession[] = [];
  const need = new Map<string, number>();
  for (const sub of input.subjects) {
    if (sub.archived || sub.weeklyMinutes <= 0) continue;
    const left = sub.weeklyMinutes - weekMinutes(sub.id, input.sessions, monday).planned;
    if (left >= 15) need.set(sub.id, left);
  }
  const urgency = (id: string) => {
    const e = nextExam(id, input.exams, today);
    return e ? daysUntilDay(e.day, today) : 999;
  };
  const order = [...need.keys()].sort((a, b) => urgency(a) - urgency(b) || need.get(b)! - need.get(a)!);
  const topicQueue = new Map<string, { examId: string; topics: string[] }>();
  for (const id of order) {
    const e = nextExam(id, input.exams, today);
    if (e) topicQueue.set(id, { examId: e.id, topics: uncoveredTopics(e, input.sessions) });
  }
  const taken = (day: string) => [...input.busyFor(day), ...input.sessions, ...placed];
  for (let pass = 0; pass < 3; pass++) {
    for (const day of days) {
      for (const id of order) {
        const left = need.get(id) ?? 0;
        if (left < 15) continue;
        const sameDay = placed.filter((p) => p.subjectId === id && dayKey(p.start) === day).length +
          input.sessions.filter((x) => x.subjectId === id && dayKey(x.start) === day).length;
        if (sameDay > pass) continue;
        const load = dayLoad(day, [...input.sessions, ...placed]);
        const len = Math.min(s.sessionMinutes, left, s.maxPerDay - load);
        if (len < Math.min(25, s.sessionMinutes)) continue;
        const slot = findSlot(day, len, s, taken(day), now);
        if (!slot) continue;
        const q = topicQueue.get(id);
        const exam = q ? input.exams.find((e) => e.id === q.examId) : undefined;
        const topic = q?.topics.shift() ?? (exam ? `Revise for ${exam.title}` : "");
        placed.push({ key: `w${placed.length}`, subjectId: id, examId: q?.examId ?? null, topic, ...slot });
        need.set(id, left - len);
      }
    }
  }
  return placed.sort((a, b) => a.start - b.start);
}

/**
 * A revision timetable for an exam, from today until the day before: each
 * topic is learned once in the first part, then reviewed a few days later
 * (spaced), and the last study day before the exam is a full practice run.
 * Topics with sessions already planned are left out.
 */
export function planRevision(input: PlanInput, exam: StudyExam): DraftSession[] {
  const { settings: s, now } = input;
  const today = dayKey(now);
  const last = shiftDay(exam.day, -1);
  const days: string[] = [];
  for (let d = today; d <= last && days.length < 120; d = shiftDay(d, 1)) if (s.days.includes(weekday(d))) days.push(d);
  if (days.length === 0) return [];
  const planned = new Set(
    input.sessions.filter((x) => x.examId === exam.id && x.end > now).map((x) => x.topic.toLowerCase()),
  );
  const topics = (exam.topics.length ? exam.topics : ["Go over your notes"]).filter(
    (t) => !planned.has(t.toLowerCase()) && !planned.has(`review: ${t}`.toLowerCase()),
  );
  const placed: DraftSession[] = [];
  const taken = (day: string) => [...input.busyFor(day), ...input.sessions, ...placed];
  const tryFrom = (idx: number, topic: string, len = s.sessionMinutes) => {
    for (let i = Math.max(0, idx); i < days.length; i++) {
      const day = days[i]!;
      if (dayLoad(day, [...input.sessions, ...placed]) + len > s.maxPerDay) continue;
      const slot = findSlot(day, len, s, taken(day), now);
      if (slot) {
        placed.push({ key: `r${placed.length}`, subjectId: exam.subjectId, examId: exam.id, topic, ...slot });
        return i;
      }
    }
    return -1;
  };
  const n = days.length;
  const practice = n >= 2 && !planned.has("practice run");
  const learnSpan = Math.max(1, Math.ceil((practice ? n - 1 : n) * 0.6));
  const gap = Math.max(1, Math.round(n / 4));
  for (const [i, t] of topics.entries()) {
    const at = Math.floor((i * learnSpan) / Math.max(1, topics.length));
    const got = tryFrom(at, t);
    if (got >= 0 && n > 2) tryFrom(Math.min(got + gap, n - (practice ? 2 : 1)), `Review: ${t}`, Math.max(25, Math.round(s.sessionMinutes * 0.6)));
  }
  if (practice) tryFrom(n - 1, "Practice run", Math.min(120, Math.max(s.sessionMinutes, 60)));
  return placed.sort((a, b) => a.start - b.start);
}

/* ---------------------------------------------------------------- stats -- */

/** Days in a row (to today or yesterday) with at least one finished session. */
export function studyStreak(sessions: StudySession[], today: string): number {
  const days = new Set(sessions.filter((x) => x.done).map((x) => dayKey(x.start)));
  let d = days.has(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = shiftDay(d, -1);
  }
  return n;
}

export function isStudyDay(v: unknown): v is string {
  return isDayKey(v);
}
