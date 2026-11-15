/**
 * Daily Briefing: today at a glance, built only from what's in myPA (calendar,
 * tasks, reminders, study, projects, bills, inbox). Nothing here is guessed:
 * every line points at a real row, and most can be acted on in place. The
 * optional written version is made from `facts` alone and checked against them.
 */

import { formatMoney, nextDue } from "./expenses";
import { clock, dayKey, dayStartMs, shiftDay } from "./planner";
import { HEALTH_LABEL, summarize as summarizeProject } from "./projects";
import { alertAt } from "./reminders";
import type { Snapshot, WidgetKind } from "./types";

export type BriefKind =
  | "event"
  | "allday"
  | "study"
  | "reminder"
  | "task"
  | "project"
  | "exam"
  | "bill"
  | "inbox"
  | "plan"
  | "journal"
  | "shopping"
  | "recap";

export type BriefAction =
  | { kind: "task-done"; id: string }
  | { kind: "task-today"; id: string }
  | { kind: "reminder-done"; id: string }
  | { kind: "reminder-snooze"; id: string }
  | { kind: "join"; url: string }
  | { kind: "open"; widget: WidgetKind };

export interface BriefItem {
  key: string;
  kind: BriefKind;
  /** Start time, for timed things. */
  at: number | null;
  /** End time, for events and sessions. */
  end?: number | null;
  text: string;
  detail?: string;
  tone?: "late" | "soon" | "done";
  actions: BriefAction[];
}

export interface BriefSection {
  id: "today" | "attention" | "tasks" | "coming" | "also" | "yesterday";
  title: string;
  items: BriefItem[];
  /** Left out for space. */
  more: number;
}

export interface Briefing {
  day: string;
  greeting: string;
  headline: string;
  sections: BriefSection[];
  /** Plain lines for the written version; the same data all day (not "now"-relative). */
  facts: string[];
}

export interface BriefingSettings {
  /** Desktop notification with the headline each morning. */
  morning: boolean;
  /** "HH:MM" */
  morningAt: string;
  /** Show what you finished yesterday. */
  yesterday: boolean;
}

export const DEFAULT_BRIEFING_SETTINGS: BriefingSettings = { morning: true, morningAt: "07:30", yesterday: true };

export function cleanBriefingSettings(s: Partial<BriefingSettings> | null | undefined): BriefingSettings {
  const d = DEFAULT_BRIEFING_SETTINGS;
  return {
    morning: typeof s?.morning === "boolean" ? s.morning : d.morning,
    morningAt: typeof s?.morningAt === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.morningAt) ? s.morningAt : d.morningAt,
    yesterday: typeof s?.yesterday === "boolean" ? s.yesterday : d.yesterday,
  };
}

/** The written version kept for a day. */
export interface BriefingNote {
  day: string;
  /** Hash of the facts it was written from; differs once the day's data changes. */
  hash: string;
  text: string;
  model: string;
  at: number;
}

/** Which areas to include (the Assistant passes only what it may read). */
export type BriefArea = "calendar" | "tasks" | "reminders" | "study" | "expenses" | "capture" | "journal" | "shopping";
const ALL_AREAS: BriefArea[] = ["calendar", "tasks", "reminders", "study", "expenses", "capture", "journal", "shopping"];

const IMPORTANCE_RANK = { high: 0, medium: 1, low: 2 } as const;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function cap(list: BriefItem[], n: number): { items: BriefItem[]; more: number } {
  return { items: list.slice(0, n), more: Math.max(0, list.length - n) };
}

export function hashFacts(facts: string[]): string {
  let h = 2166136261;
  for (const ch of facts.join("\n")) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

interface TimedEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  meetingUrl: string | null;
}

function eventsOf(s: Snapshot): TimedEvent[] {
  const connected = new Set(s.calendarAccounts.filter((a) => a.status === "connected").map((a) => a.id));
  return [
    ...s.calendarEvents.map((e) => ({
      id: e.id,
      title: e.title || "(no title)",
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location,
      meetingUrl: null,
    })),
    ...s.calendarRemoteEvents
      .filter((e) => connected.has(e.accountId) && e.myStatus !== "declined")
      .map((e) => ({
        id: e.id,
        title: e.title || "(no title)",
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        location: e.location,
        meetingUrl: e.meetingUrl,
      })),
  ];
}

function onDay(e: { start: number; end: number; allDay: boolean }, from: number, to: number): boolean {
  // all-day events are stored as local midnight to midnight
  return e.start < to && e.end > from && (!e.allDay || e.start < to - 1);
}

export function greetingFor(now: number, name?: string | null): string {
  const h = new Date(now).getHours();
  const hello = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${hello}, ${name}` : hello;
}

/**
 * Builds the briefing for the day `now` falls in. Sections are "now"-aware
 * (what's left today); `facts` cover the whole day so the written version
 * doesn't go stale every time a meeting ends.
 */
export function buildBriefing(
  s: Snapshot,
  now: number,
  opts: { areas?: BriefArea[]; settings?: BriefingSettings } = {},
): Briefing {
  const areas = new Set(opts.areas ?? ALL_AREAS);
  const settings = opts.settings ?? DEFAULT_BRIEFING_SETTINGS;
  const day = dayKey(now);
  const from = dayStartMs(day);
  const to = dayStartMs(shiftDay(day, 1));
  const tomorrowEnd = dayStartMs(shiftDay(day, 2));
  const kinds = new Set(s.widgets.map((w) => w.kind));
  const open = (widget: WidgetKind): BriefAction[] => (kinds.has(widget) ? [{ kind: "open", widget }] : []);
  const facts: string[] = [];
  const t = (ms: number) => clock(ms);

  /* ---- today's schedule ---- */
  const today: BriefItem[] = [];
  const allEvents = areas.has("calendar") ? eventsOf(s) : [];
  const todays = allEvents.filter((e) => onDay(e, from, to)).sort((a, b) => a.start - b.start);
  for (const e of todays.filter((e) => e.allDay)) {
    today.push({ key: `a:${e.id}`, kind: "allday", at: null, text: e.title, detail: "All day", actions: [] });
    facts.push(`All day: ${e.title}`);
  }
  let earlier = 0;
  for (const e of todays.filter((e) => !e.allDay)) {
    facts.push(`Event ${t(e.start)}–${t(e.end)}: ${e.title}${e.location ? ` (at ${e.location})` : ""}`);
    if (e.end <= now) {
      earlier++;
      continue;
    }
    today.push({
      key: `e:${e.id}`,
      kind: "event",
      at: e.start,
      end: e.end,
      text: e.title,
      detail: [e.start <= now ? "Now" : null, e.location || null].filter(Boolean).join(" · ") || undefined,
      tone: e.start <= now ? "soon" : undefined,
      actions: e.meetingUrl ? [{ kind: "join", url: e.meetingUrl }] : [],
    });
  }
  if (areas.has("study")) {
    const names = new Map(s.studySubjects.map((x) => [x.id, x.name]));
    for (const x of s.studySessions.filter((x) => x.start >= from && x.start < to).sort((a, b) => a.start - b.start)) {
      const name = names.get(x.subjectId) ?? "Study";
      facts.push(`Study ${t(x.start)}–${t(x.end)}: ${name}${x.topic ? `, ${x.topic}` : ""}${x.done ? " (done)" : ""}`);
      if (x.done || x.end <= now) continue;
      today.push({
        key: `s:${x.id}`,
        kind: "study",
        at: x.start,
        end: x.end,
        text: `Study: ${name}`,
        detail: [x.start <= now ? "Now" : null, x.topic || null].filter(Boolean).join(" · ") || undefined,
        tone: x.start <= now ? "soon" : undefined,
        actions: [],
      });
    }
  }
  if (areas.has("reminders")) {
    for (const r of s.reminders) {
      const at = alertAt(r);
      if (r.doneAt !== null || at === null || at < now || at >= to) continue;
      facts.push(`Reminder ${t(at)}: ${r.title}`);
      today.push({
        key: `r:${r.id}`,
        kind: "reminder",
        at,
        text: r.title,
        detail: "Reminder",
        actions: [{ kind: "reminder-done", id: r.id }],
      });
    }
  }
  today.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  if (areas.has("tasks") && kinds.has("planner")) {
    const plan = s.planDays.find((d) => d.day === day);
    const hasOpen = s.tasks.some((x) => !x.done && x.section === "today");
    if (plan?.status !== "approved" && hasOpen && new Date(now).getHours() < 17) {
      today.push({
        key: "plan",
        kind: "plan",
        at: null,
        text: "Your day isn't planned yet",
        detail: "Fit today's tasks around your calendar",
        actions: open("planner"),
      });
    }
  }

  /* ---- needs attention ---- */
  const attention: BriefItem[] = [];
  const todayTasks: BriefItem[] = [];
  if (areas.has("tasks")) {
    const openTasks = s.tasks.filter((x) => !x.done);
    const overdue = openTasks
      .filter((x) => x.due !== null && x.due < from)
      .sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
    for (const x of overdue) {
      const days = Math.max(1, Math.round((from - dayStartMs(dayKey(x.due!))) / 86_400_000));
      facts.push(`Overdue task (${plural(days, "day")} late): ${x.title}${x.project ? ` [${x.project}]` : ""}`);
      attention.push({
        key: `t:${x.id}`,
        kind: "task",
        at: null,
        text: x.title,
        detail: `${plural(days, "day")} late${x.project ? ` · ${x.project}` : ""}`,
        tone: "late",
        actions: [
          { kind: "task-today", id: x.id },
          { kind: "task-done", id: x.id },
        ],
      });
    }
    const due = openTasks
      .filter((x) => (x.section === "today" || (x.due !== null && x.due >= from && x.due < to)) && !(x.due !== null && x.due < from))
      .sort(
        (a, b) =>
          IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] ||
          (a.due ?? Infinity) - (b.due ?? Infinity) ||
          a.sort - b.sort,
      );
    for (const x of due) {
      const dueToday = x.due !== null && x.due < to;
      facts.push(`Task for today${x.importance === "high" ? " (important)" : ""}${dueToday ? " (due today)" : ""}: ${x.title}`);
      todayTasks.push({
        key: `t:${x.id}`,
        kind: "task",
        at: null,
        text: x.title,
        detail: [x.importance === "high" ? "Important" : null, dueToday ? "Due today" : null, x.project || null]
          .filter(Boolean)
          .join(" · ") || undefined,
        tone: dueToday ? "soon" : undefined,
        actions: [{ kind: "task-done", id: x.id }],
      });
    }
    for (const p of s.projects.filter((p) => p.status === "active")) {
      const sum = summarizeProject(p, s.tasks, s.steps, now);
      if (sum.health !== "at-risk" && sum.health !== "behind") continue;
      facts.push(`Project ${HEALTH_LABEL[sum.health].toLowerCase()}: ${p.name}${sum.reason ? ` (${sum.reason})` : ""}`);
      attention.push({
        key: `p:${p.id}`,
        kind: "project",
        at: null,
        text: `${p.name} is ${HEALTH_LABEL[sum.health].toLowerCase()}`,
        detail: sum.reason || undefined,
        tone: sum.health === "behind" ? "late" : "soon",
        actions: open("projects"),
      });
    }
  }
  if (areas.has("reminders")) {
    for (const r of s.reminders) {
      const at = alertAt(r);
      if (r.doneAt !== null || at === null || at >= now) continue;
      facts.push(`Missed reminder (${dayKey(at) === day ? t(at) : dayKey(at)}): ${r.title}`);
      attention.push({
        key: `r:${r.id}`,
        kind: "reminder",
        at,
        text: r.title,
        detail: `Reminder, ${dayKey(at) === day ? t(at) : new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`,
        tone: "late",
        actions: [
          { kind: "reminder-snooze", id: r.id },
          { kind: "reminder-done", id: r.id },
        ],
      });
    }
  }

  /* ---- coming up ---- */
  const coming: BriefItem[] = [];
  if (areas.has("calendar")) {
    const tomorrow = allEvents.filter((e) => onDay(e, to, tomorrowEnd) && !e.allDay).sort((a, b) => a.start - b.start);
    const first = tomorrow[0];
    if (first) {
      facts.push(`Tomorrow: ${plural(tomorrow.length, "event")}, the first is ${first.title} at ${t(first.start)}`);
      coming.push({
        key: "tomorrow",
        kind: "event",
        at: first.start,
        text: `Tomorrow: ${first.title}`,
        detail: tomorrow.length > 1 ? `First of ${plural(tomorrow.length, "event")}` : undefined,
        actions: [],
      });
    }
  }
  if (areas.has("tasks")) {
    for (const x of s.tasks.filter((x) => !x.done && x.due !== null && x.due >= to && x.due < tomorrowEnd)) {
      facts.push(`Task due tomorrow: ${x.title}`);
      coming.push({ key: `t:${x.id}`, kind: "task", at: null, text: x.title, detail: "Due tomorrow", actions: [{ kind: "task-today", id: x.id }] });
    }
  }
  if (areas.has("study")) {
    const names = new Map(s.studySubjects.map((x) => [x.id, x.name]));
    for (const e of s.studyExams) {
      const n = Math.round((dayStartMs(e.day) - from) / 86_400_000);
      if (n < 0 || n > 7) continue;
      const when = n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
      facts.push(`Exam ${when} (${e.day}${e.time ? ` ${e.time}` : ""}): ${names.get(e.subjectId) ?? ""} ${e.title}`.trim());
      const item: BriefItem = {
        key: `x:${e.id}`,
        kind: "exam",
        at: null,
        text: `${names.get(e.subjectId) ?? "Exam"}: ${e.title}`,
        detail: `Exam ${when}${e.time ? ` at ${e.time}` : ""}`,
        tone: n <= 2 ? "soon" : undefined,
        actions: open("study"),
      };
      (n <= 2 ? attention : coming).push(item);
    }
  }
  if (areas.has("expenses")) {
    const currency = s.meta.expenses.currency;
    for (const b of s.expenseRecurring) {
      if (b.paused) continue;
      const d = nextDue(b, day);
      if (!d) continue;
      const n = Math.round((dayStartMs(d) - from) / 86_400_000);
      if (n < 0 || n > 3) continue;
      const when = n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
      const amount = formatMoney(b.amount, currency);
      facts.push(`Bill due ${when}: ${b.note || "Bill"} ${amount}`);
      coming.push({
        key: `b:${b.id}`,
        kind: "bill",
        at: null,
        text: `${b.note || "Bill"} · ${amount}`,
        detail: `Due ${when}`,
        actions: open("expenses"),
      });
    }
  }

  /* ---- also ---- */
  const also: BriefItem[] = [];
  if (areas.has("capture")) {
    const inbox = s.captures.filter((c) => c.kind === "note" && !c.done).length;
    if (inbox > 0) {
      facts.push(`Inbox: ${plural(inbox, "note")} to sort`);
      also.push({ key: "inbox", kind: "inbox", at: null, text: `${plural(inbox, "note")} in your inbox to sort`, actions: open("capture") });
    }
  }
  if (areas.has("shopping")) {
    const left = s.shoppingItems.filter((i) => !i.checked).length;
    if (left > 0) {
      facts.push(`Shopping list: ${plural(left, "item")} to buy`);
      also.push({ key: "shopping", kind: "shopping", at: null, text: `${plural(left, "item")} on your shopping list`, actions: open("shopping") });
    }
  }
  if (areas.has("journal") && kinds.has("journal") && !s.meta.journal.locked) {
    const wrote = s.journalEntries.some((e) => e.day === day && e.words > 0);
    if (!wrote && new Date(now).getHours() >= 12) {
      also.push({ key: "journal", kind: "journal", at: null, text: "You haven't written in your journal today", actions: open("journal") });
    }
  }

  /* ---- yesterday ---- */
  const yesterday: BriefItem[] = [];
  if (settings.yesterday) {
    const yFrom = dayStartMs(shiftDay(day, -1));
    if (areas.has("tasks")) {
      const done = s.tasks.filter((x) => x.done && x.doneAt !== null && x.doneAt >= yFrom && x.doneAt < from);
      if (done.length) {
        facts.push(`Yesterday you finished ${plural(done.length, "task")}`);
        yesterday.push({
          key: "y-tasks",
          kind: "recap",
          at: null,
          text: `Finished ${plural(done.length, "task")}`,
          detail: done
            .slice(0, 3)
            .map((x) => x.title)
            .join(", ") + (done.length > 3 ? "…" : ""),
          tone: "done",
          actions: [],
        });
      }
    }
    if (areas.has("study")) {
      const mins = s.studySessions
        .filter((x) => x.done && x.start >= yFrom && x.start < from)
        .reduce((n, x) => n + (x.studied ?? Math.round((x.end - x.start) / 60_000)), 0);
      if (mins > 0) {
        const label = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`;
        facts.push(`Yesterday you studied ${label}`);
        yesterday.push({ key: "y-study", kind: "recap", at: null, text: `Studied ${label}`, tone: "done", actions: [] });
      }
    }
  }

  /* ---- headline ---- */
  const evening = new Date(now).getHours() >= 18;
  const left = today.filter((i) => i.kind === "event" || i.kind === "study").length;
  const overdueN = attention.filter((i) => i.kind === "task").length;
  const parts: string[] = [];
  if (areas.has("calendar") || areas.has("study"))
    parts.push(left ? `${plural(left, "thing")} left on your calendar today` : evening ? "Your calendar is clear for the rest of today" : "Nothing else on your calendar today");
  if (areas.has("tasks")) {
    if (todayTasks.length) parts.push(`${plural(todayTasks.length, "task")} for today`);
    if (overdueN) parts.push(`${overdueN} overdue`);
  }
  const next = today.find((i) => i.at !== null && i.at > now && (i.kind === "event" || i.kind === "study"));
  const nowItem = today.find((i) => i.at !== null && i.at <= now && (i.kind === "event" || i.kind === "study"));
  let tail = "";
  // some locales already end the time with a full stop ("2:10 p.m.")
  const stop = (x: string) => (/[.!?]$/.test(x) ? x : `${x}.`);
  if (nowItem) tail = ` Now: ${stop(`${nowItem.text}, until ${t(nowItem.end!)}`)}`;
  else if (next) tail = ` Next: ${stop(`${next.text} at ${t(next.at!)}`)}`;
  else if (coming[0]?.key === "tomorrow") tail = ` ${coming[0].text} at ${t(coming[0].at!)}.`;
  const headline = parts.length ? `${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.${tail}` : "Nothing to report yet.";

  const sections: BriefSection[] = [];
  const add = (id: BriefSection["id"], title: string, list: BriefItem[], n: number) => {
    if (list.length) sections.push({ id, title, ...cap(list, n) });
  };
  add("today", "Today", today, 12);
  add("attention", "Needs attention", attention, 6);
  add("tasks", "Today's tasks", todayTasks, 6);
  add("coming", "Coming up", coming, 6);
  add("also", "Also", also, 4);
  add("yesterday", "Yesterday", yesterday, 3);

  return { day, greeting: greetingFor(now, s.meta?.profile?.name), headline, sections, facts };
}

/* ------------------------------------------------------- written version -- */

export function notePrompt(facts: string[], day: string): string {
  const date = new Date(dayStartMs(day)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return [
    `Write my briefing for ${date} as a short note to me, 3 to 6 sentences, warm and plain.`,
    "Use ONLY the facts below. Do not add any event, task, time, person, place or number that isn't in them, and don't guess at anything (no weather, no traffic, no advice about things not listed).",
    "Lead with what matters most: anything overdue or soon, then the shape of the day, then one suggestion of what to do first, drawn from the facts. Use the times exactly as written.",
    "",
    "FACTS:",
    ...(facts.length ? facts.map((f) => `- ${f}`) : ["- Nothing is scheduled and there are no tasks."]),
  ].join("\n");
}

/** Minutes-of-day for every clock time written in `text` ("9:30", "9:30 AM", "2 pm"). */
export function timesIn(text: string): number[] {
  const out: number[] = [];
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?\b|\b(\d{1,2}):(\d{2})\b/gi;
  for (const m of text.matchAll(re)) {
    if (m[4] !== undefined) {
      const h = Number(m[4]);
      const min = Number(m[5]);
      if (h < 24 && min < 60) out.push(h * 60 + min);
      continue;
    }
    let h = Number(m[1]) % 12;
    if (m[3]!.toLowerCase() === "p") h += 12;
    out.push(h * 60 + Number(m[2] ?? 0));
  }
  return out;
}

/**
 * Times in the written version that appear nowhere in the facts: a sign it
 * made something up. A 12-hour time also matches its 24-hour twin, since the
 * model may write 2:00 for 14:00.
 */
export function inventedTimes(note: string, facts: string[]): number[] {
  const known = new Set(timesIn(facts.join("\n")));
  return timesIn(note).filter((m) => !known.has(m) && !known.has((m + 720) % 1440));
}
