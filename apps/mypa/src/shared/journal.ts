/**
 * Journal: one private page per day. Everything here is pure (days, tags,
 * prompts, streaks, search, export) so the widget and the Assistant agree.
 *
 * A journal day runs from 3am to 3am, so writing just after midnight still
 * lands on the day you're writing about.
 */

import { dayKey, dayStartMs, isDayKey, shiftDay } from "./planner";

export { isDayKey, shiftDay };

/** 1 awful · 2 low · 3 okay · 4 good · 5 great. */
export type Mood = 1 | 2 | 3 | 4 | 5;

export const MOODS: { value: Mood; label: string }[] = [
  { value: 1, label: "Awful" },
  { value: 2, label: "Low" },
  { value: 3, label: "Okay" },
  { value: 4, label: "Good" },
  { value: 5, label: "Great" },
];
export const moodLabel = (m: number | null) => MOODS.find((x) => x.value === m)?.label ?? "";
export const isMood = (v: unknown): v is Mood => v === 1 || v === 2 || v === 3 || v === 4 || v === 5;

export interface JournalEntry {
  id: string;
  /** YYYY-MM-DD, one entry per day. */
  day: string;
  /** The text; "" while the journal is locked. */
  body: string;
  mood: Mood | null;
  /** Lower-case #tags found in the text (kept even while locked). */
  tags: string[];
  /** The prompt the entry answers, if one was used. */
  prompt: string;
  words: number;
  createdAt: number;
  updatedAt: number;
}

export interface JournalSettings {
  /** Show a writing prompt on empty days. */
  prompts: boolean;
  /** Minutes without use before a passcode-locked journal locks again; 0 = only on restart. */
  lockAfter: number;
  /** Show "On this day" from past months and years. */
  onThisDay: boolean;
}

export const DEFAULT_JOURNAL_SETTINGS: JournalSettings = { prompts: true, lockAfter: 10, onThisDay: true };
export const LOCK_AFTER_CHOICES = [0, 1, 5, 10, 30, 60];

export function cleanJournalSettings(p: Partial<JournalSettings> | null | undefined): JournalSettings {
  const s = { ...DEFAULT_JOURNAL_SETTINGS, ...(p ?? {}) };
  return {
    prompts: s.prompts !== false,
    lockAfter: LOCK_AFTER_CHOICES.includes(Number(s.lockAfter)) ? Number(s.lockAfter) : 10,
    onThisDay: s.onThisDay !== false,
  };
}

/** What the widget needs to know about the lock. */
export interface JournalMeta {
  settings: JournalSettings;
  /** A passcode is set. */
  hasPasscode: boolean;
  /** Entries are hidden until the passcode is entered. */
  locked: boolean;
  /** Bodies are encrypted on disk with the OS keychain (false on a Linux box without one). */
  encrypted: boolean;
}

/** Per widget: which tab it shows. */
export interface JournalWidgetSettings {
  journalTab: "write" | "entries" | "insights";
}

/* ------------------------------------------------------------------ days -- */

export const ROLLOVER_HOUR = 3;

/** The journal day `ms` belongs to (before 3am counts as the day before). */
export function journalDay(ms: number): string {
  return dayKey(ms - ROLLOVER_HOUR * 3_600_000);
}

export function dayLabel(day: string, today: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const d = new Date(dayStartMs(day) + 12 * 3_600_000);
  const sameYear = d.getFullYear() === new Date(dayStartMs(today)).getFullYear();
  const label = d.toLocaleDateString(undefined, {
    weekday: opts.weekday === false ? undefined : "long",
    month: "long",
    day: "numeric",
    year: opts.year || !sameYear ? "numeric" : undefined,
  });
  if (day === today) return `Today · ${label}`;
  if (day === shiftDay(today, -1)) return `Yesterday · ${label}`;
  return label;
}

/** Whole days from a to b. */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayStartMs(b) - dayStartMs(a)) / 86_400_000);
}

/* ------------------------------------------------------------------ text -- */

export function countWords(text: string): number {
  const m = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/** #tags in the text, lower-case, in the order they first appear. */
export function extractTags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(^|[^\p{L}\p{N}&#/])#([\p{L}][\p{L}\p{N}_-]{0,39})/gu)) {
    const t = m[2]!.toLowerCase().replace(/[-_]+$/, "");
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 30);
}

/** First line or two, for lists. */
export function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/* --------------------------------------------------------------- prompts -- */

export interface Prompt {
  text: string;
  kind: "gratitude" | "reflect" | "feelings" | "growth" | "ahead" | "memory";
}

export const PROMPTS: Prompt[] = [
  { kind: "gratitude", text: "What are three things you're grateful for today?" },
  { kind: "gratitude", text: "Who made your day a little better, and how?" },
  { kind: "gratitude", text: "What small thing went right today that you'd normally overlook?" },
  { kind: "gratitude", text: "What's something you have now that you once wished for?" },
  { kind: "reflect", text: "What took most of your attention today? Was it worth it?" },
  { kind: "reflect", text: "What would you do differently if you could replay today?" },
  { kind: "reflect", text: "What surprised you today?" },
  { kind: "reflect", text: "What did you learn today, about anything?" },
  { kind: "reflect", text: "Describe today in three words, then explain them." },
  { kind: "reflect", text: "What conversation from today is still on your mind?" },
  { kind: "feelings", text: "How are you, really? Not the polite answer." },
  { kind: "feelings", text: "What drained your energy today, and what gave you some back?" },
  { kind: "feelings", text: "What's weighing on you? Write it down so you don't have to carry it." },
  { kind: "feelings", text: "When did you feel most like yourself today?" },
  { kind: "feelings", text: "What are you worried about, and how likely is it really?" },
  { kind: "growth", text: "What's one thing you did today that future you will thank you for?" },
  { kind: "growth", text: "Where did you avoid something hard today? What's one small step toward it?" },
  { kind: "growth", text: "What habit are you building, and how did it go today?" },
  { kind: "growth", text: "What would make tomorrow a good day?" },
  { kind: "growth", text: "What are you proud of this week?" },
  { kind: "ahead", text: "What are you looking forward to?" },
  { kind: "ahead", text: "What's the one thing that matters most tomorrow?" },
  { kind: "ahead", text: "If this month went perfectly, what would have happened?" },
  { kind: "ahead", text: "What do you want to remember about this season of your life?" },
  { kind: "memory", text: "What made you laugh today?" },
  { kind: "memory", text: "Describe a moment from today in detail: where, who, what you noticed." },
  { kind: "memory", text: "What did you eat, read, watch or hear today that stuck with you?" },
  { kind: "memory", text: "Write a letter to yourself one year from now." },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The prompt for a day: the same all day, different each day. `shuffle`
 * steps through the rest. Low moods lean toward feelings, Sundays toward
 * looking ahead, Fridays toward the week.
 */
export function promptFor(day: string, shuffle = 0, mood: Mood | null = null): Prompt {
  const weekday = new Date(dayStartMs(day) + 12 * 3_600_000).getDay();
  let pool = PROMPTS;
  if (shuffle === 0) {
    const lean =
      mood !== null && mood <= 2
        ? "feelings"
        : weekday === 0
          ? "ahead"
          : weekday === 5
            ? "growth"
            : null;
    if (lean) pool = PROMPTS.filter((p) => p.kind === lean);
  }
  const i = (hash(day) + shuffle * 7) % pool.length;
  return pool[i]!;
}

/* --------------------------------------------------------------- streaks -- */

export interface JournalStats {
  entries: number;
  words: number;
  /** Days in a row up to today (or yesterday, if today isn't written yet). */
  streak: number;
  longest: number;
  /** Entries in the last 30 days. */
  last30: number;
  avgMood30: number | null;
  /** Most used tags, most first. */
  topTags: { tag: string; count: number }[];
}

const written = (e: JournalEntry) => e.words > 0 || e.mood !== null || e.body.trim() !== "";

export function journalStats(entries: JournalEntry[], today: string): JournalStats {
  const real = entries.filter(written);
  const days = new Set(real.map((e) => e.day));
  let streak = 0;
  let d = days.has(today) ? today : shiftDay(today, -1);
  while (days.has(d)) {
    streak++;
    d = shiftDay(d, -1);
  }
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of sorted) {
    run = prev && shiftDay(prev, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  const since = shiftDay(today, -29);
  const recent = real.filter((e) => e.day >= since && e.day <= today);
  const moods = recent.map((e) => e.mood).filter((m): m is Mood => m !== null);
  const tagCount = new Map<string, number>();
  for (const e of real) for (const t of e.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  return {
    entries: real.length,
    words: real.reduce((n, e) => n + e.words, 0),
    streak,
    longest,
    last30: recent.length,
    avgMood30: moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null,
    topTags: [...tagCount]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 12),
  };
}

/** Entries written on this calendar date in earlier months and years. */
export function onThisDay(entries: JournalEntry[], day: string): { entry: JournalEntry; ago: string }[] {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const out: { entry: JournalEntry; ago: string }[] = [];
  const byDay = new Map(entries.filter(written).map((e) => [e.day, e]));
  // a year (or several) ago
  for (let n = 1; n <= 10; n++) {
    const k = `${y - n}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const e = byDay.get(k);
    if (e) out.push({ entry: e, ago: n === 1 ? "A year ago" : `${n} years ago` });
  }
  // a month ago, six months ago (when that date exists)
  for (const n of [1, 6]) {
    const t = new Date(y, m - 1 - n, d, 12);
    if (t.getDate() !== d) continue;
    const e = byDay.get(dayKey(t.getTime()));
    if (e) out.push({ entry: e, ago: n === 1 ? "A month ago" : "Six months ago" });
  }
  // a week ago
  const w = byDay.get(shiftDay(day, -7));
  if (w) out.push({ entry: w, ago: "A week ago" });
  return out;
}

/* ---------------------------------------------------------------- search -- */

export interface JournalQuery {
  text: string;
  mood: Mood | null;
}

/** Words must all appear; #tag words match tags; "quoted phrases" stay together. */
export function searchEntries(entries: JournalEntry[], q: JournalQuery): JournalEntry[] {
  const raw = q.text.trim().toLowerCase();
  const phrases = [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1]!.trim()).filter(Boolean);
  const rest = raw.replace(/"[^"]*"/g, " ").split(/\s+/).filter(Boolean);
  const tags = rest.filter((w) => w.startsWith("#") && w.length > 1).map((w) => w.slice(1));
  const words = [...rest.filter((w) => !w.startsWith("#")), ...phrases];
  return entries
    .filter(written)
    .filter((e) => {
      if (q.mood !== null && e.mood !== q.mood) return false;
      if (tags.some((t) => !e.tags.includes(t))) return false;
      if (words.length) {
        const hay = `${e.body}\n${e.prompt}`.toLowerCase();
        if (words.some((w) => !hay.includes(w))) return false;
      }
      return true;
    })
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Where the first search word appears, with some text either side. */
export function matchSnippet(body: string, query: string, max = 160): string {
  const word = query
    .toLowerCase()
    .replace(/"/g, "")
    .split(/\s+/)
    .find((w) => w && !w.startsWith("#"));
  const flat = body.replace(/\s+/g, " ").trim();
  if (!word) return excerpt(flat, max);
  const at = flat.toLowerCase().indexOf(word);
  if (at < 0 || at < max / 2) return excerpt(flat, max);
  const start = Math.max(0, at - Math.floor(max / 3));
  return `…${excerpt(flat.slice(start), max - 1)}`;
}

/* ---------------------------------------------------------------- export -- */

/** The whole journal as Markdown, oldest first. */
export function journalMarkdown(entries: JournalEntry[]): string {
  const list = entries.filter(written).sort((a, b) => (a.day < b.day ? -1 : 1));
  const parts = ["# Journal", ""];
  for (const e of list) {
    const d = new Date(dayStartMs(e.day) + 12 * 3_600_000).toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    parts.push(`## ${d}`, "");
    const meta = [e.mood !== null ? `Mood: ${moodLabel(e.mood)}` : "", e.tags.length ? e.tags.map((t) => `#${t}`).join(" ") : ""]
      .filter(Boolean)
      .join(" · ");
    if (meta) parts.push(`*${meta}*`, "");
    if (e.prompt) parts.push(`> ${e.prompt}`, "");
    if (e.body.trim()) parts.push(e.body.trim(), "");
  }
  return `${parts.join("\n").trimEnd()}\n`;
}

/** Month grid (weeks starting Monday) for the insights calendar. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1, 12);
  const lead = (first.getDay() + 6) % 7;
  const daysIn = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysIn; d++) cells.push(dayKey(new Date(year, month, d, 12).getTime()));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
