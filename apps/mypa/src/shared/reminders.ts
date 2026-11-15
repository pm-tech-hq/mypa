/** The Reminders widget: types and the pure logic shared by the database, the
 *  scheduler, the widget and the Assistant (repeats, the plain-words parser,
 *  grouping and labels). Times are epoch milliseconds; repeats are worked out
 *  in local time so "every day at 9" stays at 9 across daylight-saving changes. */

/* ------------------------------------------------------------------ types -- */

export type RepeatUnit = "hour" | "day" | "week" | "month" | "year";

export interface ReminderRepeat {
  unit: RepeatUnit;
  /** Every N units, 1 or more. */
  every: number;
  /** Weekly only: the weekdays it falls on (0 = Sunday). Empty = the due date's weekday. */
  days?: number[];
  /** Local YYYY-MM-DD: no occurrences after this day. */
  until?: string | null;
}

export interface ReminderRow {
  id: string;
  title: string;
  notes: string;
  /** When it's due; null = no date (a someday reminder that never alerts). */
  dueAt: number | null;
  repeat: ReminderRepeat | null;
  important: boolean;
  /** Set when snoozed: alert again at this time instead of `dueAt`. */
  snoozedUntil: number | null;
  /** The alert time it last notified for, so each alert fires once. */
  firedAt: number | null;
  /** Completed (one-off reminders only; repeating ones move to their next date). */
  doneAt: number | null;
  createdAt: number;
}

export interface NewReminder {
  title: string;
  notes?: string;
  dueAt?: number | null;
  repeat?: ReminderRepeat | null;
  important?: boolean;
}

export type ReminderPatch = Partial<
  Pick<ReminderRow, "title" | "notes" | "dueAt" | "repeat" | "important" | "snoozedUntil">
>;

export interface RemindersWidgetSettings {
  remTab: "upcoming" | "done";
  /** "HH:MM" used when a reminder has a date but no time. */
  remDefaultTime: string;
  /** Minutes for the quick snooze button. */
  remSnooze: number;
}

export const DEFAULT_REMINDERS_SETTINGS: RemindersWidgetSettings = {
  remTab: "upcoming",
  remDefaultTime: "09:00",
  remSnooze: 10,
};

/* ------------------------------------------------------------- date bits -- */

const MIN = 60_000;
const HOUR = 60 * MIN;

export function ymdOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/** Same local wall-clock time, `n` days later (DST-safe). */
function plusDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** `n` months later on the same day, clamped to the month's last day (Jan 31 → Feb 28). */
function plusMonths(ms: number, n: number, day: number): number {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  const target = new Date(y, m, 1, d.getHours(), d.getMinutes(), 0, 0);
  target.setDate(Math.min(day, daysInMonth(target.getFullYear(), target.getMonth())));
  return target.getTime();
}

export function parseHm(hm: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  const h = m ? Math.min(23, Number(m[1])) : 9;
  return { h, m: m ? Math.min(59, Number(m[2])) : 0 };
}

/** `ymd` at `hm` local time. */
export function atTime(ymd: string, hm: string): number {
  const [y, mo, d] = ymd.split("-").map(Number) as [number, number, number];
  const { h, m } = parseHm(hm);
  return new Date(y, mo - 1, d, h, m, 0, 0).getTime();
}

/* ---------------------------------------------------------------- repeats -- */

export function cleanRepeat(r: unknown): ReminderRepeat | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Partial<ReminderRepeat>;
  const units: RepeatUnit[] = ["hour", "day", "week", "month", "year"];
  if (!o.unit || !units.includes(o.unit)) return null;
  const every = Math.max(1, Math.min(999, Math.round(Number(o.every) || 1)));
  const out: ReminderRepeat = { unit: o.unit, every };
  if (o.unit === "week" && Array.isArray(o.days)) {
    const days = [...new Set(o.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
    if (days.length) out.days = days;
  }
  if (typeof o.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.until)) out.until = o.until;
  return out;
}

/** The first occurrence strictly after `after`, counting from the series
 *  anchored at `due`; null when the repeat has ended. */
export function nextOccurrence(due: number, repeat: ReminderRepeat, after: number): number | null {
  const every = Math.max(1, repeat.every);
  const until = repeat.until ? atTime(repeat.until, "23:59") + 59_999 : Infinity;
  let t: number;

  if (repeat.unit === "hour") {
    const step = every * HOUR;
    t = due + step * Math.max(1, Math.floor((after - due) / step) + 1);
  } else if (repeat.unit === "day") {
    const gap = Math.max(0, Math.round((startOfDay(after) - startOfDay(due)) / 86_400_000));
    t = plusDays(due, Math.floor(gap / every) * every);
    while (t <= after) t = plusDays(t, every);
  } else if (repeat.unit === "week") {
    const days = repeat.days?.length ? repeat.days : [new Date(due).getDay()];
    // Walk day by day from the week the series is in; weeks are counted from the due date's week.
    const weekStart = (ms: number) => startOfDay(plusDays(ms, -new Date(ms).getDay()));
    const anchorWeek = weekStart(due);
    let d = atDayTime(Math.max(startOfDay(after), startOfDay(due)), due);
    for (let i = 0; i < 7 * every + 14; i++) {
      const weeks = Math.round((weekStart(d) - anchorWeek) / (7 * 86_400_000));
      if (d > after && d >= due && weeks % every === 0 && days.includes(new Date(d).getDay())) {
        return d <= until ? d : null;
      }
      d = plusDays(d, 1);
    }
    return null;
  } else if (repeat.unit === "month") {
    const day = new Date(due).getDate();
    const a = new Date(after);
    const s = new Date(due);
    let n = Math.max(0, (a.getFullYear() - s.getFullYear()) * 12 + a.getMonth() - s.getMonth());
    n = Math.floor(n / every) * every;
    t = plusMonths(due, n, day);
    while (t <= after) {
      n += every;
      t = plusMonths(due, n, day);
    }
  } else {
    const day = new Date(due).getDate();
    let n = Math.max(0, new Date(after).getFullYear() - new Date(due).getFullYear());
    n = Math.floor(n / every) * every;
    t = plusMonths(due, n * 12, day);
    while (t <= after) {
      n += every;
      t = plusMonths(due, n * 12, day);
    }
  }
  return t <= until ? t : null;
}

/** `dayMs`'s date at `timeOf`'s wall-clock time. */
function atDayTime(dayMs: number, timeOf: number): number {
  const d = new Date(dayMs);
  const t = new Date(timeOf);
  d.setHours(t.getHours(), t.getMinutes(), 0, 0);
  return d.getTime();
}

/** When a repeating reminder is ticked off: its next date after both the
 *  current one and now, so missed occurrences don't pile up. */
export function advance(r: Pick<ReminderRow, "dueAt" | "repeat">, now: number): number | null {
  if (r.dueAt === null || !r.repeat) return null;
  return nextOccurrence(r.dueAt, r.repeat, Math.max(r.dueAt, now));
}

/** When it will (or did) alert. */
export function alertAt(r: Pick<ReminderRow, "dueAt" | "snoozedUntil">): number | null {
  return r.snoozedUntil ?? r.dueAt;
}

/* ----------------------------------------------------------------- labels -- */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function repeatLabel(r: ReminderRepeat | null): string {
  if (!r) return "Never";
  const n = r.every;
  let s: string;
  if (r.unit === "hour") s = n === 1 ? "Every hour" : `Every ${n} hours`;
  else if (r.unit === "day") s = n === 1 ? "Every day" : `Every ${n} days`;
  else if (r.unit === "week") {
    const days = r.days ?? [];
    const key = days.join(",");
    if (n === 1 && key === "1,2,3,4,5") s = "Every weekday";
    else if (n === 1 && key === "0,6") s = "Every weekend";
    else if (n === 1 && days.length === 7) s = "Every day";
    else {
      const on = days.length ? ` on ${days.map((d) => WD_SHORT[d]).join(", ")}` : "";
      s = (n === 1 ? "Every week" : `Every ${n} weeks`) + on;
    }
  } else if (r.unit === "month") s = n === 1 ? "Every month" : `Every ${n} months`;
  else s = n === 1 ? "Every year" : `Every ${n} years`;
  if (r.until) {
    const [y, m, d] = r.until.split("-").map(Number) as [number, number, number];
    s += `, until ${new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  }
  return s;
}

export function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Today 5:00 PM", "Tomorrow 9:00 AM", "Fri 5:00 PM", "Sat 12 Dec, 9:00 AM". */
export function whenLabel(ms: number, now: number): string {
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / 86_400_000);
  const time = clockLabel(ms);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  if (days > 1 && days < 7) return `${WD_SHORT[new Date(ms).getDay()]} ${time}`;
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  const date = new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${date}, ${time}`;
}

/** "in 5 min", "in 2 h", "3 days ago". */
export function relativeLabel(ms: number, now: number): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const fmt = (n: number, unit: string) => `${n} ${unit}${n === 1 || unit === "min" || unit === "h" ? "" : "s"}`;
  let s: string;
  if (abs < MIN) return diff >= 0 ? "now" : "just now";
  if (abs < HOUR) s = fmt(Math.round(abs / MIN), "min");
  else if (abs < 24 * HOUR) s = fmt(Math.round(abs / HOUR), "h");
  else s = fmt(Math.round(abs / (24 * HOUR)), "day");
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

/* --------------------------------------------------------------- grouping -- */

export type ReminderGroup = "overdue" | "today" | "tomorrow" | "week" | "later" | "nodate";

export const GROUP_LABEL: Record<ReminderGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "Next 7 days",
  later: "Later",
  nodate: "No date",
};

export function groupOf(r: ReminderRow, now: number): ReminderGroup {
  const at = alertAt(r);
  if (at === null) return "nodate";
  if (at <= now) return "overdue";
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return "week";
  return "later";
}

/** Open reminders, soonest first; undated ones last (important first, then newest). */
export function sortOpen(list: ReminderRow[]): ReminderRow[] {
  return [...list].sort((a, b) => {
    const x = alertAt(a);
    const y = alertAt(b);
    if (x === null && y === null) {
      if (a.important !== b.important) return a.important ? -1 : 1;
      return b.createdAt - a.createdAt;
    }
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y || Number(b.important) - Number(a.important);
  });
}

/* ----------------------------------------------------------------- parser -- */

export interface ParsedReminder {
  title: string;
  dueAt: number | null;
  repeat: ReminderRepeat | null;
  /** True when the text named a time (not just a day). */
  hasTime: boolean;
  /** The words that were understood as when, for highlighting. */
  matched: string[];
}

const DAY_NAMES: Record<string, number> = {
  sun: 0, sunday: 0, sundays: 0,
  mon: 1, monday: 1, mondays: 1,
  tue: 2, tues: 2, tuesday: 2, tuesdays: 2,
  wed: 3, weds: 3, wednesday: 3, wednesdays: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4,
  fri: 5, friday: 5, fridays: 5,
  sat: 6, saturday: 6, saturdays: 6,
};
const DAY_RE = "(sun(?:day)?s?|mon(?:day)?s?|tue(?:s(?:day)?)?s?|wed(?:s|nesday)?s?|thu(?:r(?:s(?:day)?)?)?s?|fri(?:day)?s?|sat(?:urday)?s?)";

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function monthIndex(name: string): number {
  const k = name.toLowerCase();
  return MONTHS[k] ?? MONTHS[k.slice(0, 3)] ?? 0;
}

const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, "forty-five": 45, half: 0.5,
};
const NUM_RE = "(\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty-five|half)";
const num = (s: string): number => NUM_WORDS[s.toLowerCase()] ?? Number(s);

/** Month-first (US) or day-first numeric dates, from the system locale. */
function monthFirst(): boolean {
  try {
    const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2020, 11, 31));
    return parts.findIndex((p) => p.type === "month") < parts.findIndex((p) => p.type === "day");
  } catch {
    return true;
  }
}

/** Hour without am/pm: 1–7 reads as afternoon/evening, 8–11 as morning, 12 as noon. */
function guessHour(h: number): number {
  if (h === 12) return 12;
  if (h >= 1 && h <= 7) return h + 12;
  return h;
}

/**
 * Reads a reminder typed in plain words: "call mom tomorrow at 5",
 * "pay rent every month on the 1st", "in 20 min check the oven",
 * "standup every weekday 9am", "dentist on dec 12 at 3:30pm".
 * The rest of the text becomes the title.
 */
export function parseReminder(text: string, now: number, defaultTime = "09:00"): ParsedReminder {
  let s = ` ${text.replace(/\s+/g, " ").trim()} `;
  const matched: string[] = [];
  /** Where each understood phrase ended, to spot a bare hour right after one. */
  const ends: number[] = [];

  /** Finds `re` (case-insensitive) and blanks it out of the text. */
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = new RegExp(re.source, "i").exec(s);
    if (!m) return null;
    matched.push(m[0].trim());
    ends.push(m.index + m[0].length);
    s = s.slice(0, m.index) + " ".repeat(m[0].length) + s.slice(m.index + m[0].length);
    return m;
  };

  let day: number | null = null; // start-of-day ms
  let time: { h: number; m: number } | null = null;
  let offset: number | null = null; // absolute ms from "in 20 min"
  let repeat: ReminderRepeat | null = null;
  const today = startOfDay(now);

  /* ---- repeats ---- */
  let m: RegExpExecArray | null;
  if ((m = take(/\b(?:every|each) ?(weekday|work ?day|weekend)s?\b/))) {
    repeat = { unit: "week", every: 1, days: /end/i.test(m[1]!) ? [0, 6] : [1, 2, 3, 4, 5] };
  } else if ((m = take(/\b(?:on )?weekdays\b/))) {
    repeat = { unit: "week", every: 1, days: [1, 2, 3, 4, 5] };
  } else if (
    (m = take(new RegExp(`\\b(?:every|each) ?(other )?${DAY_RE}((?:(?:,|,? and|,? &) ?${DAY_RE})*)\\b`)))
  ) {
    const names = `${m[2]} ${m[3] ?? ""}`.toLowerCase().match(new RegExp(DAY_RE, "gi")) ?? [];
    repeat = {
      unit: "week",
      every: m[1] ? 2 : 1,
      days: [...new Set(names.map((n) => DAY_NAMES[n.toLowerCase()]!))].sort(),
    };
  } else if ((m = take(/\b(?:on )?(sun|mon|tues|wednes|thurs|fri|satur)days\b/))) {
    // "on mondays" (plural) = every Monday
    repeat = { unit: "week", every: 1, days: [DAY_NAMES[`${m[1]!.toLowerCase()}day`]!] };
  } else if ((m = take(new RegExp(`\\b(?:every|each) ${NUM_RE} ?(min(?:ute)?s?|hours?|hrs?|days?|weeks?|wks?|months?|years?)\\b`)))) {
    const n = Math.max(1, Math.round(num(m[1]!)));
    const u = m[2]!.toLowerCase();
    const unit: RepeatUnit = u.startsWith("h") ? "hour" : u.startsWith("d") ? "day" : u.startsWith("w") ? "week" : u.startsWith("mo") ? "month" : u.startsWith("y") ? "year" : "hour";
    repeat = { unit, every: u.startsWith("mi") ? Math.max(1, Math.round(n / 60)) : n };
  } else if ((m = take(/\b(?:every|each) other (day|week|month|year)\b/))) {
    repeat = { unit: m[1]!.toLowerCase() as RepeatUnit, every: 2 };
  } else if ((m = take(/\b(?:every|each) ?(hour|day|night|morning|evening|week|month|year)\b|\b(hourly|daily|nightly|weekly|fortnightly|biweekly|monthly|quarterly|yearly|annually)\b/))) {
    const w = (m[1] ?? m[2]!).toLowerCase();
    if (w === "hour" || w === "hourly") repeat = { unit: "hour", every: 1 };
    else if (w === "week" || w === "weekly") repeat = { unit: "week", every: 1 };
    else if (w === "fortnightly" || w === "biweekly") repeat = { unit: "week", every: 2 };
    else if (w === "month" || w === "monthly") repeat = { unit: "month", every: 1 };
    else if (w === "quarterly") repeat = { unit: "month", every: 3 };
    else if (w === "year" || w === "yearly" || w === "annually") repeat = { unit: "year", every: 1 };
    else {
      repeat = { unit: "day", every: 1 };
      if (w === "night" || w === "nightly") time = { h: 21, m: 0 };
      if (w === "morning") time = { h: 9, m: 0 };
      if (w === "evening") time = { h: 18, m: 0 };
    }
  }

  /* ---- relative offsets: "in 20 minutes", "in an hour and a half" ---- */
  if ((m = take(new RegExp(`\\bin ${NUM_RE} ?(and a half )?(min(?:ute)?s?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|years?)( and a half)?\\b`)))) {
    let n = num(m[1]!);
    if (m[2] || m[4]) n += 0.5;
    const u = m[3]!.toLowerCase();
    if (u.startsWith("mi") || u === "m") offset = now + n * MIN;
    else if (u.startsWith("h")) offset = now + n * HOUR;
    else if (u.startsWith("d")) offset = plusDays(now, Math.round(n));
    else if (u.startsWith("w")) offset = plusDays(now, Math.round(n * 7));
    else if (u.startsWith("mo")) offset = plusMonths(now, Math.round(n), new Date(now).getDate());
    else offset = plusMonths(now, Math.round(n) * 12, new Date(now).getDate());
  } else if ((m = take(/\bin half an hour\b/))) {
    offset = now + 30 * MIN;
  }

  /* ---- times ---- */
  if ((m = take(/\b(?:at |@ ?)?(noon|midday|midnight)\b/))) {
    time = /mid(?!day)/i.test(m[1]!) ? { h: 23, m: 59 } : { h: 12, m: 0 };
  } else if ((m = take(/\b(?:at |@ ?)?(\d{1,2})(?::|\.)(\d{2}) ?([ap])\.?m?\.?(?=\W)/))) {
    time = { h: (Number(m[1]) % 12) + (m[3]!.toLowerCase() === "p" ? 12 : 0), m: Number(m[2]) };
  } else if ((m = take(/\b(?:at |@ ?)?(\d{1,2}) ?([ap])\.?m\.?(?=\W)/))) {
    time = { h: (Number(m[1]) % 12) + (m[2]!.toLowerCase() === "p" ? 12 : 0), m: 0 };
  } else if ((m = take(/\b(?:at |@ ?)?([01]?\d|2[0-3]):([0-5]\d)\b/))) {
    const h = Number(m[1]);
    // "at 5:30" with no am/pm: a 24-hour clock if 13+ or a leading zero, else guess.
    time = { h: h >= 13 || m[1]!.startsWith("0") ? h : guessHour(h), m: Number(m[2]) };
  } else if ((m = take(/\b(?:at|@) ?(\d{1,2})\b(?! ?(?:min|hour|day|week|month|year|st|nd|rd|th))/))) {
    const h = Number(m[1]);
    if (h <= 23) time = { h: h >= 13 ? h : guessHour(h), m: 0 };
  }

  /* ---- day words ---- */
  if ((m = take(/\b(tonight|this evening)\b/))) {
    day = today;
    time ??= { h: 20, m: 0 };
    if (/evening/i.test(m[1]!)) time = time.h === 20 && time.m === 0 ? { h: 18, m: 0 } : time;
  } else if ((m = take(/\bthis (morning|afternoon)\b/))) {
    day = today;
    time ??= /morning/i.test(m[1]!) ? { h: 9, m: 0 } : { h: 15, m: 0 };
  } else if ((m = take(/\b(?:the )?day after (?:tomorrow|tmrw)\b/))) {
    day = plusDays(today, 2);
  } else if ((m = take(/\b(tomorrow|tmrw|tmr|tom)( (?:morning|afternoon|evening|night))?\b/))) {
    day = plusDays(today, 1);
    const part = (m[2] ?? "").trim().toLowerCase();
    if (part) time ??= part === "morning" ? { h: 9, m: 0 } : part === "afternoon" ? { h: 15, m: 0 } : part === "evening" ? { h: 18, m: 0 } : { h: 20, m: 0 };
  } else if ((m = take(/\btoday\b/))) {
    day = today;
  } else if ((m = take(/\bnext week\b/))) {
    // next Monday
    const wd = new Date(today).getDay();
    day = plusDays(today, ((8 - wd) % 7) || 7);
  } else if ((m = take(/\bnext month\b/))) {
    const d = new Date(today);
    day = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  } else if ((m = take(/\bthis weekend\b|\bweekend\b/))) {
    const wd = new Date(today).getDay();
    day = plusDays(today, wd === 6 || wd === 0 ? 0 : 6 - wd);
    time ??= { h: 10, m: 0 };
  } else if ((m = take(new RegExp(`\\b(?:on )?(?:(next|this) )?${DAY_RE}\\b`)))) {
    const target = DAY_NAMES[m[2]!.toLowerCase()]!;
    const wd = new Date(today).getDay();
    let add = (target - wd + 7) % 7;
    if (m[1]?.toLowerCase() === "next") {
      // "next friday" = the Friday of next week (weeks start on Monday)
      const nextMonday = plusDays(today, ((8 - wd) % 7) || 7);
      day = plusDays(nextMonday, (target + 6) % 7);
    } else {
      // "on friday" said on a Friday means today; it rolls to next week below if the time has passed.
      day = plusDays(today, add);
    }
  }

  /* ---- explicit dates ---- */
  if (day === null) {
    const year = new Date(now).getFullYear();
    let date: Date | null = null;
    let explicitYear = false;
    if ((m = take(/\b(?:on )?(\d{4})-(\d{2})-(\d{2})\b/))) {
      date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      explicitYear = true;
    } else if ((m = take(new RegExp(`\\b(?:on )?${MONTH_RE}\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b`)))) {
      date = new Date(m[3] ? Number(m[3]) : year, monthIndex(m[1]!), Number(m[2]));
      explicitYear = !!m[3];
    } else if ((m = take(new RegExp(`\\b(?:on )?(?:the )?(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MONTH_RE}\\.?(?:,? (\\d{4}))?\\b`)))) {
      date = new Date(m[3] ? Number(m[3]) : year, monthIndex(m[2]!), Number(m[1]));
      explicitYear = !!m[3];
    } else if ((m = take(/\b(?:on )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const [mo, d] = monthFirst() ? [a, b] : [b, a];
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) date = new Date(y, mo - 1, d);
      explicitYear = !!m[3];
    } else if ((m = take(/\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)\b/))) {
      const n = Number(m[1]);
      const d = new Date(today);
      date = new Date(d.getFullYear(), d.getMonth(), Math.min(n, daysInMonth(d.getFullYear(), d.getMonth())));
      if (date.getTime() < today) date = new Date(d.getFullYear(), d.getMonth() + 1, Math.min(n, daysInMonth(d.getFullYear(), d.getMonth() + 1)));
    }
    if (date && !Number.isNaN(date.getTime())) {
      // A date without a year that's already past means next year.
      if (!explicitYear && date.getTime() < today) date.setFullYear(date.getFullYear() + 1);
      day = date.getTime();
    }
  }

  /* ---- a part of the day after a day word: "tuesday night", "monday in the morning" ---- */
  if (!time && (day !== null || repeat !== null) && (m = take(/\b(?:in the )?(morning|afternoon|evening|night)\b/))) {
    const part = m[1]!.toLowerCase();
    time = part === "morning" ? { h: 9, m: 0 } : part === "afternoon" ? { h: 15, m: 0 } : part === "evening" ? { h: 18, m: 0 } : { h: 21, m: 0 };
  }

  /* ---- "tomorrow 5", "every weekday 9": a bare hour at the end or right after a date ---- */
  if (!time && offset === null && (day !== null || repeat !== null) && repeat?.unit !== "hour") {
    let bare: { index: number; length: number; h: number } | null = null;
    const last = /\s(\d{1,2})\s*$/.exec(s);
    if (last) bare = { index: last.index, length: last[0].length, h: Number(last[1]) };
    for (const end of ends) {
      if (bare) break;
      const after = /^(\s*)(\d{1,2})(?=\s|$)/.exec(s.slice(end));
      if (after) bare = { index: end + after[1]!.length, length: after[2]!.length, h: Number(after[2]) };
    }
    if (bare && bare.h >= 1 && bare.h <= 23) {
      time = { h: bare.h >= 13 ? bare.h : guessHour(bare.h), m: 0 };
      matched.push(String(bare.h));
      s = s.slice(0, bare.index) + " ".repeat(bare.length) + s.slice(bare.index + bare.length);
    }
  }

  /* ---- put it together ---- */
  let dueAt: number | null = null;
  const def = parseHm(defaultTime);
  if (offset !== null) {
    dueAt = offset;
    if (time && Math.abs(offset - now) >= 24 * HOUR) {
      const d = new Date(offset);
      d.setHours(time.h, time.m, 0, 0);
      dueAt = d.getTime();
    }
  } else if (day !== null || time !== null || repeat !== null) {
    const base = day ?? today;
    const t = time ?? (repeat?.unit === "hour" && day === null ? { h: new Date(now).getHours() + 1, m: 0 } : def);
    const d = new Date(base);
    d.setHours(t.h, t.m, 0, 0);
    dueAt = d.getTime();
    // A time with no day that's already passed today means tomorrow.
    if (day === null && dueAt <= now) dueAt = plusDays(dueAt, 1);
    // "on friday" said on a Friday after the time has passed: next week.
    if (day !== null && day === today && dueAt <= now && /\b(mon|tue|wed|thu|fri|sat|sun)/i.test(matched.join(" "))) dueAt = plusDays(dueAt, 7);
  }

  // A repeat on given weekdays starts on the first matching day.
  if (repeat && dueAt !== null && repeat.unit === "week" && repeat.days?.length && !repeat.days.includes(new Date(dueAt).getDay())) {
    const next = nextOccurrence(dueAt, { ...repeat }, dueAt);
    if (next !== null) dueAt = next;
  }
  // "every monday 9am" said Monday 10am: the first one is next Monday.
  if (repeat && dueAt !== null && dueAt <= now) {
    dueAt = nextOccurrence(dueAt, repeat, now) ?? dueAt;
  }
  // "pay rent every month on the 1st": "the 1st" anchors the monthly repeat.

  const title = s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:please )?(?:remind me|reminder|remember)(?: to| about| that)?\b[:,]?\s*/i, "")
    .replace(/^(?:to|about)\s+/i, "")
    .replace(/\s+(?:on|at|by|in|for|from|the)$/i, "")
    .replace(/^(?:on|at|by)\s+/i, "")
    .replace(/[\s,.;:-]+$/, "")
    .trim();

  return {
    title: title ? title[0]!.toUpperCase() + title.slice(1) : "",
    dueAt,
    repeat,
    hasTime: time !== null || offset !== null,
    matched,
  };
}

export const WEEKDAY_NAMES = WEEKDAYS;
export const WEEKDAY_SHORT = WD_SHORT;
