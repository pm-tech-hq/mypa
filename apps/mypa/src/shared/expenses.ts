/** The Expenses widget: types and the pure logic shared by the database, the
 *  widget and the Assistant (periods, the quick-add parser, totals, pace). */

/* ------------------------------------------------------------------ types -- */

/** Amounts are integers in hundredths of the currency (12.34 → 1234), even
 *  for currencies shown without decimals. Negative amounts are refunds. */
export interface ExpenseRow {
  id: string;
  amount: number;
  categoryId: string;
  note: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** The bill that posted it, if any. */
  recurringId: string | null;
  createdAt: number;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  /** A key into the widget's icon set. */
  icon: string;
  /** Spending limit per month, in hundredths; null = none. */
  budget: number | null;
  sort: number;
}

/** A bill or subscription that posts itself once a month. */
export interface ExpenseRecurring {
  id: string;
  amount: number;
  categoryId: string;
  note: string;
  /** Day of the month it's due (29–31 fall on the last day of shorter months). */
  day: number;
  /** First date it can post, YYYY-MM-DD. */
  start: string;
  /** Last date it can post; null = until stopped. */
  end: string | null;
  paused: boolean;
  /** The latest date already posted; occurrences after it post when due. */
  lastPosted: string | null;
  createdAt: number;
}

export interface ExpenseSettings {
  /** ISO 4217 code. */
  currency: string;
  /** Total spending limit per month, in hundredths; null = none. */
  budget: number | null;
  /** The day each month begins (1 = calendar months; 25 for a payday on the 25th). */
  monthStart: number;
}

export const DEFAULT_EXPENSE_SETTINGS: ExpenseSettings = {
  currency: "USD",
  budget: null,
  monthStart: 1,
};

export interface NewExpense {
  amount: number;
  categoryId?: string;
  note?: string;
  date?: string;
}

export type ExpensePatch = Partial<Pick<ExpenseRow, "amount" | "categoryId" | "note" | "date">>;

export interface NewExpenseCategory {
  name: string;
  icon?: string;
  budget?: number | null;
}

export type ExpenseCategoryPatch = Partial<Pick<ExpenseCategory, "name" | "icon" | "budget" | "sort">>;

export interface NewExpenseRecurring {
  amount: number;
  categoryId: string;
  note: string;
  day: number;
  start?: string;
  end?: string | null;
}

export type ExpenseRecurringPatch = Partial<
  Pick<ExpenseRecurring, "amount" | "categoryId" | "note" | "day" | "end" | "paused">
>;

/** Per-widget view state. */
export interface ExpensesWidgetSettings {
  expTab: "month" | "activity" | "bills" | "trends";
  /** Bill suggestions the user waved away, by normalized note. */
  expDismissed: string[];
}

/* ------------------------------------------------------------- categories -- */

/** The categories a new database starts with. Their ids are stable, so the
 *  quick-add keywords keep working after a rename. */
export const SEED_CATEGORIES: { id: string; name: string; icon: string }[] = [
  { id: "groceries", name: "Groceries", icon: "cart" },
  { id: "dining", name: "Eating out", icon: "utensils" },
  { id: "transport", name: "Transport", icon: "car" },
  { id: "housing", name: "Housing", icon: "house" },
  { id: "utilities", name: "Utilities", icon: "zap" },
  { id: "subscriptions", name: "Subscriptions", icon: "repeat" },
  { id: "shopping", name: "Shopping", icon: "bag" },
  { id: "health", name: "Health", icon: "heart" },
  { id: "fun", name: "Fun", icon: "ticket" },
  { id: "travel", name: "Travel", icon: "plane" },
  { id: "other", name: "Other", icon: "tag" },
];

/** Where a deleted category's spending goes. */
export const FALLBACK_CATEGORY = "other";

/** Words that point at a seeded category, for notes the widget hasn't seen before. */
const KEYWORDS: Record<string, string[]> = {
  groceries: [
    "grocery", "groceries", "supermarket", "market", "costco", "walmart", "aldi", "lidl", "tesco",
    "loblaws", "sobeys", "safeway", "kroger", "shoprite", "spar", "food basics", "metro",
    "no frills", "trader joe", "whole foods", "produce", "milk", "bread", "eggs", "fruit",
  ],
  dining: [
    "lunch", "dinner", "breakfast", "brunch", "coffee", "cafe", "café", "starbucks", "tim hortons",
    "restaurant", "takeout", "take-out", "takeaway", "pizza", "burger", "sushi", "mcdonald",
    "kfc", "chicken", "shawarma", "suya", "drinks", "bar", "pub", "beer", "uber eats",
    "doordash", "skip", "chowdeck", "glovo", "snack", "tea", "bakery", "donut",
  ],
  transport: [
    "uber", "lyft", "bolt", "taxi", "cab", "bus", "train", "metro pass", "transit", "presto",
    "fuel", "gas", "petrol", "diesel", "parking", "toll", "car wash", "oil change", "fare",
    "subway", "ferry", "scooter", "keke", "okada",
  ],
  housing: ["rent", "mortgage", "landlord", "condo", "strata", "property tax", "home insurance"],
  utilities: [
    "electric", "electricity", "hydro", "power", "nepa", "water", "internet", "wifi", "phone",
    "mobile", "data", "airtime", "heating", "gas bill", "utility", "utilities",
  ],
  subscriptions: [
    "netflix", "spotify", "youtube", "apple", "icloud", "google one", "prime", "disney",
    "hulu", "dropbox", "notion", "chatgpt", "claude", "openai", "github", "figma", "adobe",
    "subscription", "membership", "patreon", "dstv", "gotv", "showmax",
  ],
  shopping: [
    "amazon", "clothes", "shoes", "shirt", "jeans", "ikea", "best buy", "electronics", "gift",
    "jumia", "konga", "zara", "h&m", "uniqlo", "shein", "mall", "furniture", "laptop",
  ],
  health: [
    "pharmacy", "drug", "medicine", "doctor", "dentist", "clinic", "hospital", "gym", "fitness",
    "therapy", "physio", "vitamins", "shoppers drug", "rexall", "optometrist", "glasses",
  ],
  fun: [
    "movie", "movies", "cinema", "concert", "game", "games", "steam", "playstation", "xbox",
    "nintendo", "tickets", "show", "museum", "book", "books", "party", "bowling", "event",
  ],
  travel: [
    "flight", "airline", "hotel", "airbnb", "booking", "hostel", "visa", "luggage", "air canada",
    "westjet", "expedia", "trip", "vacation", "holiday",
  ],
};

/** The category a note most likely belongs to: the one used last for the same
 *  note, then for the same first word, then a keyword, else Other. */
export function guessCategory(
  note: string,
  categories: ExpenseCategory[],
  history: ExpenseRow[],
): string {
  const ids = new Set(categories.map((c) => c.id));
  const n = normalizeNote(note);
  if (n) {
    const recent = [...history].sort((a, b) => b.createdAt - a.createdAt);
    const same = recent.find((e) => ids.has(e.categoryId) && normalizeNote(e.note) === n);
    if (same) return same.categoryId;
    const first = n.split(" ")[0]!;
    if (first.length >= 3) {
      const like = recent.find(
        (e) => ids.has(e.categoryId) && normalizeNote(e.note).split(" ")[0] === first,
      );
      if (like) return like.categoryId;
    }
    // A category whose name is in the note ("pharmacy" → Pharmacy).
    const named = categories.find((c) => {
      const name = c.name.toLowerCase();
      return name.length >= 3 && (n === name || ` ${n} `.includes(` ${name} `));
    });
    if (named) return named.id;
    let best: { id: string; len: number } | null = null;
    for (const [id, words] of Object.entries(KEYWORDS)) {
      if (!ids.has(id)) continue;
      for (const w of words) {
        if (` ${n} `.includes(` ${w} `) || (w.length >= 5 && n.includes(w))) {
          if (!best || w.length > best.len) best = { id, len: w.length };
        }
      }
    }
    if (best) return best.id;
  }
  if (ids.has(FALLBACK_CATEGORY)) return FALLBACK_CATEGORY;
  return categories[0]?.id ?? FALLBACK_CATEGORY;
}

/** A note reduced to compare places: lower case, no punctuation or numbers. */
export function normalizeNote(note: string): string {
  return note
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}&\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ dates -- */

const pad = (n: number) => String(n).padStart(2, "0");

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Noon, so adding days never trips over a daylight-saving change. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86_400_000);
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** The date in this month for a day-of-month, moved back to the last day when
 *  the month is shorter. */
export function dayInMonth(year: number, month0: number, day: number): string {
  return ymd(new Date(year, month0, Math.min(day, daysInMonth(year, month0)), 12));
}

export function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseYmd(s).getTime());
}

/* ---------------------------------------------------------------- periods -- */

/** A budgeting month: calendar months, or e.g. the 25th to the 24th. */
export interface Period {
  /** First day, inclusive. */
  start: string;
  /** Day after the last, exclusive. */
  end: string;
  days: number;
}

export function periodOf(date: string, monthStart: number): Period {
  const d = parseYmd(date);
  let y = d.getFullYear();
  let m = d.getMonth();
  if (d.getDate() < startDay(y, m, monthStart)) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return periodFrom(y, m, monthStart);
}

function startDay(y: number, m: number, monthStart: number): number {
  return Math.min(Math.max(1, Math.round(monthStart)), daysInMonth(y, m));
}

function periodFrom(y: number, m: number, monthStart: number): Period {
  const start = ymd(new Date(y, m, startDay(y, m, monthStart), 12));
  const ny = m === 11 ? y + 1 : y;
  const nm = (m + 1) % 12;
  const end = ymd(new Date(ny, nm, startDay(ny, nm, monthStart), 12));
  return { start, end, days: daysBetween(start, end) };
}

/** The period `n` months before (negative) or after this one. */
export function shiftPeriod(p: Period, n: number, monthStart: number): Period {
  const d = parseYmd(p.start);
  const total = d.getFullYear() * 12 + d.getMonth() + n;
  return periodFrom(Math.floor(total / 12), ((total % 12) + 12) % 12, monthStart);
}

export function inPeriod(date: string, p: Period): boolean {
  return date >= p.start && date < p.end;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "November 2026", or "25 Oct – 24 Nov" when months start mid-month. */
export function periodLabel(p: Period, monthStart: number, short = false): string {
  const s = parseYmd(p.start);
  if (monthStart <= 1) {
    const name = MONTHS[s.getMonth()]!;
    return short ? name.slice(0, 3) : `${name} ${s.getFullYear()}`;
  }
  const last = parseYmd(addDays(p.end, -1));
  if (short) return MONTHS[s.getMonth()]!.slice(0, 3);
  return `${s.getDate()} ${MONTHS[s.getMonth()]!.slice(0, 3)} – ${last.getDate()} ${MONTHS[last.getMonth()]!.slice(0, 3)}`;
}

/* -------------------------------------------------------------- recurring -- */

/** Every date a bill falls due from `from` (exclusive) to `to` (inclusive). */
export function occurrences(r: ExpenseRecurring, from: string | null, to: string): string[] {
  const out: string[] = [];
  const first = from && from >= r.start ? addDays(from, 1) : r.start;
  const last = r.end && r.end < to ? r.end : to;
  if (first > last) return out;
  const a = parseYmd(first);
  let y = a.getFullYear();
  let m = a.getMonth();
  for (let guard = 0; guard < 600; guard++) {
    const date = dayInMonth(y, m, r.day);
    if (date > last) break;
    if (date >= first) out.push(date);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/** When a bill is next due on or after `today`, or null once it has ended. */
export function nextDue(r: ExpenseRecurring, today: string): string | null {
  let after = addDays(today, -1);
  if (r.lastPosted && r.lastPosted > after) after = r.lastPosted;
  return occurrences(r, after, addDays(today, 400))[0] ?? null;
}

/** Bills not yet posted that fall due later in this period. */
export function upcomingBills(
  recurring: ExpenseRecurring[],
  p: Period,
  today: string,
): { bill: ExpenseRecurring; date: string }[] {
  const out: { bill: ExpenseRecurring; date: string }[] = [];
  const last = addDays(p.end, -1);
  for (const r of recurring) {
    if (r.paused) continue;
    const posted = r.lastPosted && r.lastPosted > today ? r.lastPosted : today;
    const from = posted < p.start ? addDays(p.start, -1) : posted;
    for (const date of occurrences(r, from, last)) out.push({ bill: r, date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------- quick add -- */

export interface QuickParse {
  amount: number;
  note: string;
  categoryId: string;
  /** The category was named with #tag, not guessed. */
  categoryNamed: boolean;
  date: string;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const CURRENCY_MARKS = /[$€£₦¥₹₩₱₺₽₴₪₫฿₵₲₡]|(?:usd|cad|eur|gbp|ngn|inr|aud|jpy)/gi;

/** "nov", "Nov.", "november", "sept" → 10 / 8; anything else (even "market") → -1. */
function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return -1;
  if (w === "sept") return 8;
  return MONTH_NAMES.findIndex((m) => m.startsWith(w));
}

/** "mon", "tues", "thurs", "friday" → 1 / 2 / 4 / 5; "month" → -1. */
function weekdayIndex(word: string): number {
  const w = word.toLowerCase();
  if (w.length < 3) return -1;
  if (w === "tues") return 2;
  if (w === "thur" || w === "thurs") return 4;
  return WEEKDAYS.findIndex((d) => d.startsWith(w));
}

/** Reads an amount like 12, 12.5, 1,250.00, $40, 40$, 2.5k, -20. Hundredths, or null. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(CURRENCY_MARKS, "").replace(/\s+/g, "");
  if (!s) return null;
  let sign = 1;
  if (s.startsWith("-") || s.startsWith("−")) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  let mult = 1;
  if (/k$/i.test(s)) {
    mult = 1000;
    s = s.slice(0, -1);
  }
  // "1.250,50" (comma decimals) and "1,250.50" both work; a lone comma with
  // two digits after is a decimal comma.
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.$/.test(s)) return null;
  const n = Number(s) * mult;
  if (!Number.isFinite(n) || n === 0 || n > 1e10) return null;
  return sign * Math.round(n * 100);
}

/**
 * Understands what people type into a quick-add box:
 * "12.50 lunch", "lunch 12.5", "uber 18 yesterday", "rent 1400 #housing",
 * "refund 20 shoes", "coffee 4 mon", "groceries 86 on nov 3", "2 days ago taxi 9".
 */
export function parseQuick(
  text: string,
  ctx: { categories: ExpenseCategory[]; history: ExpenseRow[]; today: string },
): QuickParse | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  let amount: number | null = null;
  let date = ctx.today;
  let refund = false;
  let categoryId: string | null = null;
  const keep: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const lw = w.toLowerCase().replace(/[,.]$/, "");
    const next = words[i + 1]?.toLowerCase().replace(/[,.]$/, "");
    const next2 = words[i + 2]?.toLowerCase().replace(/[,.]$/, "");

    if (w.startsWith("#") && w.length > 1) {
      const tag = w.slice(1).toLowerCase();
      const hit =
        ctx.categories.find((c) => c.name.toLowerCase().replace(/\s+/g, "") === tag) ??
        ctx.categories.find((c) => c.name.toLowerCase().replace(/\s+/g, "").startsWith(tag)) ??
        ctx.categories.find((c) => c.id === tag);
      if (hit) {
        categoryId = hit.id;
        continue;
      }
    }
    if (lw === "refund" || lw === "refunded" || lw === "returned") {
      refund = true;
      continue;
    }
    if (lw === "today") {
      date = ctx.today;
      continue;
    }
    if (lw === "yesterday" || lw === "yday" || lw === "yest") {
      date = addDays(ctx.today, -1);
      continue;
    }
    if (lw === "on" && next && (isYmd(next) || weekdayIndex(next) >= 0 || monthIndex(next) >= 0)) {
      continue; // "on" before a date
    }
    if (lw === "last" && next && weekdayIndex(next) >= 0) continue;
    // "3 days ago", "2d ago"
    const ago = /^(\d{1,2})d?$/.exec(lw);
    if (ago && (next === "ago" || ((next === "days" || next === "day") && next2 === "ago"))) {
      date = addDays(ctx.today, -Number(ago[1]));
      i += next === "ago" ? 1 : 2;
      continue;
    }
    if (isYmd(lw)) {
      date = lw;
      continue;
    }
    const wd = weekdayIndex(lw);
    if (wd >= 0) {
      const t = parseYmd(ctx.today);
      let back = (t.getDay() - wd + 7) % 7;
      if (back === 0) back = 7; // "mon" on a Monday means last Monday
      date = addDays(ctx.today, -back);
      continue;
    }
    // "nov 3", "3 nov", "3rd nov"
    const mi = monthIndex(lw);
    if (mi >= 0 && next && /^\d{1,2}(st|nd|rd|th)?$/.test(next)) {
      date = pastDate(ctx.today, mi, parseInt(next, 10));
      i += 1;
      continue;
    }
    // "3rd nov" is always a date; a bare "3 nov" only once the amount is known.
    if (
      /^\d{1,2}(st|nd|rd|th)?$/.test(lw) &&
      next &&
      monthIndex(next) >= 0 &&
      (amount !== null || /\D/.test(lw))
    ) {
      date = pastDate(ctx.today, monthIndex(next), parseInt(lw, 10));
      i += 1;
      continue;
    }
    if (amount === null) {
      const a = parseAmount(w);
      if (a !== null) {
        amount = a;
        continue;
      }
    }
    keep.push(w);
  }

  if (amount === null) return null;
  if (refund && amount > 0) amount = -amount;
  const note = tidyNote(keep.join(" "));
  const named = categoryId !== null;
  return {
    amount,
    note,
    categoryId: categoryId ?? guessCategory(note, ctx.categories, ctx.history),
    categoryNamed: named,
    date,
  };
}

/** The most recent date with this month and day that isn't in the future. */
function pastDate(today: string, month0: number, day: number): string {
  const t = parseYmd(today);
  let y = t.getFullYear();
  let d = dayInMonth(y, month0, day);
  if (d > today) {
    y -= 1;
    d = dayInMonth(y, month0, day);
  }
  return d;
}

function tidyNote(s: string): string {
  const t = s.replace(/^(for|at|on|to|-|–|:)\s+/i, "").replace(/\s+/g, " ").trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : "";
}

/* ---------------------------------------------------------------- numbers -- */

const formatters = new Map<string, Intl.NumberFormat>();

/** Money in the user's currency: "$1,234.50", or "$1.2k" when compact. */
export function formatMoney(
  hundredths: number,
  currency: string,
  opts: { compact?: boolean; whole?: boolean; sign?: boolean } = {},
): string {
  const key = `${currency}|${opts.compact ? 1 : 0}|${opts.whole ? 1 : 0}|${opts.sign ? 1 : 0}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        notation: opts.compact ? "compact" : "standard",
        maximumFractionDigits: opts.compact ? 1 : opts.whole ? 0 : undefined,
        minimumFractionDigits: opts.whole || opts.compact ? 0 : undefined,
        signDisplay: opts.sign ? "exceptZero" : "auto",
      });
    } catch {
      f = new Intl.NumberFormat(undefined, {
        notation: opts.compact ? "compact" : "standard",
        maximumFractionDigits: opts.compact || opts.whole ? 0 : 2,
        minimumFractionDigits: opts.compact || opts.whole ? 0 : 2,
        signDisplay: opts.sign ? "exceptZero" : "auto",
      });
    }
    formatters.set(key, f);
  }
  return f.format(hundredths / 100);
}

/** The amount as typed in an edit field: "12.5" → "12.50", whole numbers plain. */
export function amountInput(hundredths: number): string {
  const n = Math.abs(hundredths) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

/** A sensible currency for a country code (from the operating system's region). */
export function currencyForCountry(country: string): string {
  const c = country.toUpperCase();
  const euro = [
    "AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV",
    "MT", "NL", "PT", "SI", "SK",
  ];
  if (euro.includes(c)) return "EUR";
  const map: Record<string, string> = {
    US: "USD", CA: "CAD", GB: "GBP", NG: "NGN", GH: "GHS", KE: "KES", ZA: "ZAR", IN: "INR",
    AU: "AUD", NZ: "NZD", JP: "JPY", CN: "CNY", SG: "SGD", AE: "AED", CH: "CHF", SE: "SEK",
    NO: "NOK", DK: "DKK", PL: "PLN", BR: "BRL", MX: "MXN", PH: "PHP", EG: "EGP", HK: "HKD",
    KR: "KRW", TR: "TRY", IL: "ILS", SA: "SAR", PK: "PKR", BD: "BDT", ID: "IDR", MY: "MYR",
  };
  return map[c] ?? "USD";
}

/** Currencies offered in settings (any ISO code can be typed too). */
export const COMMON_CURRENCIES = [
  "USD", "CAD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR", "INR", "AUD", "NZD", "JPY", "CNY",
  "SGD", "AED", "CHF", "SEK", "BRL", "MXN", "PHP",
];

/* -------------------------------------------------------------- analysis -- */

export interface PeriodSummary {
  period: Period;
  /** All spending in the period up to today (refunds subtract). */
  spent: number;
  /** Spending by category id. */
  byCategory: Map<string, number>;
  /** Spending per day, index 0 = the first day. */
  daily: number[];
  /** Running total per day. */
  cumulative: number[];
  /** Days of the period that have passed, today included (0 for a future period). */
  elapsed: number;
  /** Bills still to post this period. */
  upcoming: { bill: ExpenseRecurring; date: string }[];
  upcomingTotal: number;
  /** Where the period is likely to end: spending so far, the day-to-day rate
   *  for the days left, and the bills still due. */
  projected: number;
  rows: ExpenseRow[];
}

export function summarize(
  expenses: ExpenseRow[],
  recurring: ExpenseRecurring[],
  p: Period,
  today: string,
): PeriodSummary {
  const rows = expenses.filter((e) => inPeriod(e.date, p));
  const daily = new Array<number>(p.days).fill(0);
  const byCategory = new Map<string, number>();
  let spent = 0;
  let variable = 0;
  for (const e of rows) {
    spent += e.amount;
    byCategory.set(e.categoryId, (byCategory.get(e.categoryId) ?? 0) + e.amount);
    const i = daysBetween(p.start, e.date);
    if (i >= 0 && i < p.days) daily[i]! += e.amount;
    if (!e.recurringId) variable += e.amount;
  }
  const cumulative: number[] = [];
  let run = 0;
  for (const d of daily) cumulative.push((run += d));
  const elapsed =
    today < p.start ? 0 : today >= p.end ? p.days : daysBetween(p.start, today) + 1;
  const isCurrent = today >= p.start && today < p.end;
  const upcoming = isCurrent ? upcomingBills(recurring, p, today) : [];
  const upcomingTotal = upcoming.reduce((s, u) => s + u.bill.amount, 0);
  const left = p.days - elapsed;
  // Early in the month a single big purchase would swing the rate wildly; lean
  // on at least a week of days.
  const rate = elapsed > 0 ? Math.max(0, variable) / Math.max(elapsed, Math.min(7, p.days)) : 0;
  const projected = isCurrent ? Math.round(spent + rate * left + upcomingTotal) : spent;
  return { period: p, spent, byCategory, daily, cumulative, elapsed, upcoming, upcomingTotal, projected, rows };
}

/** Spending in the same first `days` days of another period, for "vs last month". */
export function spentInFirstDays(expenses: ExpenseRow[], p: Period, days: number): number {
  const until = addDays(p.start, days);
  let s = 0;
  for (const e of expenses) if (e.date >= p.start && e.date < until && e.date < p.end) s += e.amount;
  return s;
}

/** Days that passed without day-to-day spending (bills don't count), and the
 *  current run of them ending today or yesterday. */
export function noSpendDays(
  expenses: ExpenseRow[],
  p: Period,
  today: string,
): { count: number; streak: number } {
  const spendDays = new Set(expenses.filter((e) => !e.recurringId && e.amount > 0).map((e) => e.date));
  let count = 0;
  const last = today < p.end ? today : addDays(p.end, -1);
  for (let d = p.start; d <= last; d = addDays(d, 1)) if (!spendDays.has(d)) count++;
  let streak = 0;
  let d = spendDays.has(today) ? addDays(today, -1) : today;
  while (!spendDays.has(d) && streak < 366) {
    // Don't count days before anything was ever logged.
    if (!expenses.some((e) => e.date <= d)) break;
    streak++;
    d = addDays(d, -1);
  }
  return { count, streak };
}

/** Where the money went: notes grouped as places, biggest first. */
export function topPlaces(
  rows: ExpenseRow[],
  limit = 5,
): { name: string; total: number; count: number; categoryId: string }[] {
  const groups = new Map<string, { name: string; total: number; count: number; categoryId: string }>();
  for (const e of rows) {
    if (e.amount <= 0) continue;
    const key = normalizeNote(e.note);
    if (!key) continue;
    const g = groups.get(key) ?? { name: e.note.trim(), total: 0, count: 0, categoryId: e.categoryId };
    g.total += e.amount;
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export interface BillSuggestion {
  /** Normalized note, the key for dismissing it. */
  key: string;
  note: string;
  amount: number;
  day: number;
  categoryId: string;
  /** How many of the last months it showed up in. */
  months: number;
}

/**
 * Spending that looks like a monthly bill but isn't one yet: the same place in
 * at least two different months of the last ~100 days, for about the same
 * amount, on about the same day of the month.
 */
export function suggestBills(
  expenses: ExpenseRow[],
  bills: ExpenseRecurring[],
  today: string,
  dismissed: string[] = [],
): BillSuggestion[] {
  const since = addDays(today, -100);
  const billKeys = new Set(bills.map((b) => normalizeNote(b.note)));
  const skip = new Set(dismissed);
  const groups = new Map<string, ExpenseRow[]>();
  for (const e of expenses) {
    if (e.recurringId || e.amount <= 0 || e.date < since || e.date > today) continue;
    const key = normalizeNote(e.note);
    if (!key || billKeys.has(key) || skip.has(key)) continue;
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  }
  const out: BillSuggestion[] = [];
  for (const [key, rows] of groups) {
    const byMonth = new Map<string, ExpenseRow>();
    for (const r of rows) {
      const m = r.date.slice(0, 7);
      // A place visited several times a month is a habit, not a bill.
      if (byMonth.has(m)) {
        byMonth.clear();
        break;
      }
      byMonth.set(m, r);
    }
    if (byMonth.size < 2) continue;
    const list = [...byMonth.values()];
    const amounts = list.map((r) => r.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)]!;
    // Bills charge (nearly) the same each time; usage-based ones like hydro
    // drift a little. Groceries and rides vary more than either.
    const tolerance = rows[0]!.categoryId === "utilities" ? 0.15 : 0.03;
    if (amounts.some((a) => Math.abs(a - median) > median * tolerance)) continue;
    const days = list.map((r) => parseYmd(r.date).getDate());
    if (Math.max(...days) - Math.min(...days) > 3) continue;
    const latest = list.sort((a, b) => b.date.localeCompare(a.date))[0]!;
    out.push({
      key,
      note: latest.note,
      amount: latest.amount,
      day: parseYmd(latest.date).getDate(),
      categoryId: latest.categoryId,
      months: byMonth.size,
    });
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, 3);
}

/** Expenses as a spreadsheet (CSV), oldest first. */
export function toCsv(
  rows: ExpenseRow[],
  categories: ExpenseCategory[],
  bills: ExpenseRecurring[],
  currency: string,
): string {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const billNames = new Map(bills.map((b) => [b.id, b.note]));
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [`Date,Amount (${currency}),Category,Note,Bill`];
  for (const e of [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)) {
    lines.push(
      [
        e.date,
        (e.amount / 100).toFixed(2),
        cell(names.get(e.categoryId) ?? "Other"),
        cell(e.note),
        cell(e.recurringId ? (billNames.get(e.recurringId) ?? "yes") : ""),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** "1st", "2nd", "23rd". */
export function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
