/**
 * Quick Capture: one line in, filed where it belongs. The text is read for
 * what it is (a task, a reminder, an event, an expense or a note) and turned
 * into a plan the user can see and override before it's saved. The created
 * record stays the real thing (a task in To-do, a reminder in Reminders…);
 * the capture only remembers where it went. Notes stay in the capture inbox.
 * Everything here is pure, so the widget, the pop-up box and the Assistant
 * agree on what "Call mom tomorrow at 5" means.
 */
import type { ExpenseCategory, ExpenseRow } from "./expenses";
import { FALLBACK_CATEGORY, guessCategory, parseQuick } from "./expenses";
import { parseReminder, type ReminderRepeat } from "./reminders";

export type CaptureKind = "task" | "reminder" | "event" | "expense" | "note";
export const CAPTURE_KINDS: CaptureKind[] = ["task", "reminder", "event", "expense", "note"];

export interface CaptureRow {
  id: string;
  /** What was typed, as typed. */
  text: string;
  kind: CaptureKind;
  /** The task, reminder, event or expense it became (null for notes). */
  targetId: string | null;
  /** Notes: dealt with (archived from the inbox). */
  done: boolean;
  createdAt: number;
}

/** Per widget: which captures the list shows. */
export interface CaptureWidgetSettings {
  capFilter: CaptureKind | "all" | "inbox";
}

export interface CaptureSettings {
  /** Electron accelerator, e.g. "CommandOrControl+Shift+Space". */
  hotkey: string;
  hotkeyOn: boolean;
  /** Where new tasks go in To-do. */
  taskSection: "today" | "backlog";
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  hotkey: "CommandOrControl+Shift+Space",
  hotkeyOn: true,
  taskSection: "today",
};

export function cleanCaptureSettings(s: Partial<CaptureSettings> | null | undefined): CaptureSettings {
  const d = DEFAULT_CAPTURE_SETTINGS;
  return {
    hotkey: typeof s?.hotkey === "string" && /^[\w+]{1,60}$/.test(s.hotkey) ? s.hotkey : d.hotkey,
    hotkeyOn: typeof s?.hotkeyOn === "boolean" ? s.hotkeyOn : d.hotkeyOn,
    taskSection: s?.taskSection === "backlog" ? "backlog" : "today",
  };
}

/** "CommandOrControl+Shift+Space" → "Ctrl+Shift+Space" (or ⌘ on a Mac). */
export function hotkeyLabel(acc: string, mac = false): string {
  return acc
    .split("+")
    .map((k) =>
      k === "CommandOrControl" || k === "CmdOrCtrl"
        ? mac
          ? "⌘"
          : "Ctrl"
        : k === "Control"
          ? "Ctrl"
          : k === "Option"
            ? "Alt"
            : k,
    )
    .join(mac ? "" : "+");
}

/* --------------------------------------------------------------- plans -- */

export type CapturePlan =
  | { kind: "task"; title: string; due: number | null; importance: "high" | "medium" | "low" }
  | { kind: "reminder"; title: string; dueAt: number | null; repeat: ReminderRepeat | null }
  | { kind: "event"; title: string; start: number; end: number }
  | { kind: "expense"; amount: number; note: string; categoryId: string; date: string }
  | { kind: "note"; text: string };

export interface CaptureContext {
  now: number;
  /** For "tomorrow" with no time (reminders). */
  defaultTime?: string;
  expense: { categories: ExpenseCategory[]; history: ExpenseRow[]; today: string };
}

const PREFIX: [RegExp, CaptureKind][] = [
  [/^(?:t|task|todo|to-?do)\s*[:>-]\s*/i, "task"],
  [/^(?:r|reminder)\s*[:>-]\s*/i, "reminder"],
  [/^(?:e|event|cal|calendar|meeting)\s*[:>-]\s*/i, "event"],
  [/^(?:x|expense|spend)\s*[:>-]\s*/i, "expense"],
  [/^(?:n|note|idea|thought)\s*[:>-]\s*/i, "note"],
];

const EVENT_WORDS =
  /\b(meeting|meet (?:with|up)|call with|catch[- ]?up|lunch with|dinner with|drinks with|coffee with|breakfast with|appointment|appt|interview|dentist|doctor|doctor's|gp|vet|flight|party|wedding|class|lecture|seminar|webinar|session|standup|stand-up|sync|1:1|one-on-one|demo|workshop|conference|game|match|concert|haircut)\b/i;

const MONEY = /(?:[$€£₦¥₹]\s?\d)|(?:\d(?:[.,]\d+)?\s?(?:usd|eur|gbp|ngn|cad|aud|dollars?|euros?|pounds?|naira|bucks)\b)/i;
const SPEND = /^(?:spent|paid|bought|cost|purchased)\b/i;

const TASK_VERBS = new Set(
  (
    "add answer apply arrange ask book bring buy call cancel change check clean clear collect confirm contact " +
    "create deliver deploy design do draft drop email file finish fill fix follow get give go hire install invite " +
    "learn look make move order organise organize pay pick plan post prepare print publish read refactor register " +
    "remember renew reply research return review schedule sell send set share sign sort start submit take test " +
    "text tidy update upload visit wash water write"
  ).split(" "),
);

const URGENT = /(?:^|\s)(?:!+|urgent|asap|important)(?=\s|$)/gi;

/** Which kind the words look like, and why (for the hint under the box). */
export function detectKind(
  text: string,
  expense?: { categories: ExpenseCategory[]; history: ExpenseRow[] },
): { kind: CaptureKind; why: string } {
  const t = text.trim();
  for (const [re, kind] of PREFIX) if (re.test(t)) return { kind, why: "you said so" };
  if (/^remind(?:\s+me)?\b/i.test(t)) return { kind: "reminder", why: "starts with “remind”" };
  if (SPEND.test(t) || (MONEY.test(t) && t.split(/\s+/).length <= 8)) return { kind: "expense", why: "has an amount" };
  if (t.includes("\n") || t.length > 160) return { kind: "note", why: "it's long" };
  const when = parseReminder(t, Date.now());
  const repeats = when.repeat !== null && /\b(?:every|daily|weekly|monthly|yearly)\b/i.test(t);
  // events here don't repeat, so "every…" is a repeating reminder
  if (repeats) return { kind: "reminder", why: "repeats" };
  if (when.dueAt !== null && when.hasTime && EVENT_WORDS.test(t)) return { kind: "event", why: "a meeting with a time" };
  if (when.dueAt !== null && when.hasTime) return { kind: "reminder", why: "has a time" };
  // "uber 18", "lunch 12.50": a few words, a number, and something you spend on
  const words = t.split(/\s+/);
  if (expense && words.length <= 5 && /(?:^|\s)\d+(?:[.,]\d{1,2})?(?:\s|$)/.test(t) && !when.matched.length) {
    const note = words.filter((w) => !/^\d/.test(w)).join(" ");
    if (note && guessCategory(note, expense.categories, expense.history) !== FALLBACK_CATEGORY) {
      return { kind: "expense", why: "an amount for something you buy" };
    }
  }
  const first = t.split(/\s+/)[0]!.toLowerCase().replace(/[^a-z]/g, "");
  if (/^(?:need to|have to|must|should|don'?t forget to|gotta)\b/i.test(t)) return { kind: "task", why: "something to do" };
  if (TASK_VERBS.has(first)) return { kind: "task", why: "starts with something to do" };
  if (when.dueAt !== null && !when.repeat) return { kind: "task", why: "has a day" };
  if (/\?$/.test(t)) return { kind: "note", why: "a question to keep" };
  return { kind: "note", why: "saved as a note" };
}

function stripPrefix(text: string): string {
  let t = text.trim();
  for (const [re] of PREFIX) t = t.replace(re, "");
  return t.replace(/^remind(?:\s+me)?\s+(?:to\s+|about\s+|that\s+)?/i, "").trim();
}

function tidyTitle(s: string): string {
  const t = s
    .replace(/^(?:i\s+)?(?:need to|have to|must|should|gotta|don'?t forget to)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

/** "3-4pm" / "from 2 to 3:30pm" → a single start time, plus the length. */
function takeRange(text: string): { text: string; minutes: number | null } {
  const re =
    /\b(?:from\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i;
  const m = re.exec(text);
  if (!m) return { text, minutes: null };
  const h2 = Number(m[4]);
  const ap2 = m[6]!.toLowerCase();
  const end = ((h2 % 12) + (ap2 === "pm" ? 12 : 0)) * 60 + Number(m[5] ?? 0);
  const h1 = Number(m[1]);
  let ap1 = (m[3] ?? ap2).toLowerCase();
  let start = ((h1 % 12) + (ap1 === "pm" ? 12 : 0)) * 60 + Number(m[2] ?? 0);
  if (!m[3] && start >= end) {
    ap1 = ap2 === "pm" ? "am" : "pm";
    start = ((h1 % 12) + (ap1 === "pm" ? 12 : 0)) * 60 + Number(m[2] ?? 0);
  }
  if (end <= start) return { text, minutes: null };
  const at = `at ${h1}${m[2] ? `:${m[2]}` : ""}${ap1}`;
  return { text: text.replace(m[0], at), minutes: end - start };
}

function takeDuration(text: string): { text: string; minutes: number | null } {
  const m = /\bfor\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i.exec(text);
  if (!m) return { text, minutes: null };
  const n = Number(m[1]);
  const minutes = /^h/i.test(m[2]!) ? Math.round(n * 60) : Math.round(n);
  return minutes >= 5 && minutes <= 24 * 60 ? { text: text.replace(m[0], " "), minutes } : { text, minutes: null };
}

/** What saving `text` as `kind` will do, or why it can't. */
export function planCapture(text: string, kind: CaptureKind, ctx: CaptureContext): CapturePlan | { error: string } {
  const raw = text.trim();
  if (!raw) return { error: "Type something first." };
  const body = stripPrefix(raw);

  if (kind === "note") return { kind: "note", text: raw.replace(PREFIX.find(([, k]) => k === "note")![0], "").trim() || raw };

  if (kind === "expense") {
    const q = parseQuick(body.replace(SPEND, "").replace(/\s+on\s+/i, " ").trim(), ctx.expense);
    if (!q) return { error: "No amount found. Try “12.50 lunch” or “spent 40 on groceries”." };
    return { kind: "expense", amount: q.amount, note: q.note, categoryId: q.categoryId, date: q.date };
  }

  const important = URGENT.test(body);
  URGENT.lastIndex = 0;
  const clean = body.replace(URGENT, " ").replace(/\s+/g, " ").trim();

  if (kind === "event") {
    const range = takeRange(clean);
    const dur = takeDuration(range.text);
    const p = parseReminder(dur.text, ctx.now, ctx.defaultTime ?? "09:00");
    if (p.dueAt === null || !p.hasTime) return { error: "Events need a day and time, like “Lunch with Ana Friday 1pm”." };
    const minutes = range.minutes ?? dur.minutes ?? 60;
    return { kind: "event", title: tidyTitle(p.title) || "Event", start: p.dueAt, end: p.dueAt + minutes * 60_000 };
  }

  const p = parseReminder(clean, ctx.now, ctx.defaultTime ?? "09:00");
  const title = tidyTitle(p.title) || tidyTitle(clean);
  if (!title) return { error: "What's it about? Add a few words." };

  if (kind === "reminder") return { kind: "reminder", title, dueAt: p.dueAt, repeat: p.repeat };

  // task: a day alone means "by the end of that day"
  let due: number | null = p.dueAt;
  if (due !== null && !p.hasTime) {
    const d = new Date(due);
    d.setHours(23, 59, 0, 0);
    due = d.getTime();
  }
  return { kind: "task", title, due, importance: important ? "high" : "medium" };
}

/* --------------------------------------------------------------- labels -- */

export const KIND_LABEL: Record<CaptureKind, string> = {
  task: "Task",
  reminder: "Reminder",
  event: "Event",
  expense: "Expense",
  note: "Note",
};

function whenLabel(ms: number, now: number, withTime = true): string {
  const d = new Date(ms);
  const today = new Date(now);
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );
  const day =
    days === 0
      ? "today"
      : days === 1
        ? "tomorrow"
        : days === -1
          ? "yesterday"
          : days > 1 && days < 7
            ? d.toLocaleDateString(undefined, { weekday: "long" })
            : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return withTime ? `${day} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : day;
}

/** One line saying where it will go: "Task in Today, due Friday". */
export function describePlan(
  plan: CapturePlan,
  now: number,
  opts: { taskSection: "today" | "backlog"; money?: (cents: number) => string; category?: (id: string) => string },
): string {
  switch (plan.kind) {
    case "task": {
      const where = opts.taskSection === "today" ? "To-do › Today" : "To-do › Backlog";
      const due =
        plan.due === null
          ? ""
          : new Date(plan.due).getHours() === 23 && new Date(plan.due).getMinutes() === 59
            ? ` · due ${whenLabel(plan.due, now, false)}`
            : ` · due ${whenLabel(plan.due, now)}`;
      return `Task in ${where}${due}${plan.importance === "high" ? " · important" : ""}`;
    }
    case "reminder":
      return plan.dueAt === null ? "Reminder with no date" : `Reminder · ${whenLabel(plan.dueAt, now)}`;
    case "event": {
      const end = new Date(plan.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      return `Event in Calendar · ${whenLabel(plan.start, now)}–${end}`;
    }
    case "expense": {
      const amt = opts.money ? opts.money(plan.amount) : (plan.amount / 100).toFixed(2);
      const cat = opts.category ? ` · ${opts.category(plan.categoryId)}` : "";
      const n = new Date(now);
      const ymd = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
      const day = plan.date === ymd ? "" : ` · ${plan.date}`;
      return `Expense · ${amt}${cat}${day}`;
    }
    case "note":
      return "Note in your capture inbox";
  }
}
