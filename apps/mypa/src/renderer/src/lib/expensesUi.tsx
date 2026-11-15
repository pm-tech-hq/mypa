import { useEffect, useState } from "react";

import {
  addDays,
  formatMoney,
  parseYmd,
  ymd,
  type ExpenseCategory,
  type ExpenseRecurring,
  type ExpenseRow,
  type ExpenseSettings,
  type Period,
  type PeriodSummary,
} from "../../../shared/expenses";
import { expenseIcon } from "./expenseIcons";

/** What every Expenses view gets from the widget. */
export interface ExCtx {
  settings: ExpenseSettings;
  today: string;
  /** The period on screen, and whether it's the one we're in. */
  period: Period;
  isCurrent: boolean;
  summary: PeriodSummary;
  /** Every expense not waiting to be deleted, newest first. */
  expenses: ExpenseRow[];
  categories: ExpenseCategory[];
  catById: Map<string, ExpenseCategory>;
  bills: ExpenseRecurring[];
  money: (hundredths: number, opts?: { compact?: boolean; whole?: boolean; sign?: boolean }) => string;
  /** Open the editor for an expense. */
  edit: (e: ExpenseRow) => void;
  /** Delete with an Undo bar. */
  remove: (e: ExpenseRow) => void;
  /** Show the Activity tab filtered to a category. */
  showCategory: (categoryId: string) => void;
  openSettings: () => void;
}

export function moneyFor(currency: string) {
  return (h: number, opts?: { compact?: boolean; whole?: boolean; sign?: boolean }) =>
    formatMoney(h, currency, opts);
}

/** Today's date, kept current across midnight. */
export function useToday(): string {
  const [today, setToday] = useState(() => ymd(new Date()));
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = ymd(new Date());
      setToday((prev) => (prev === now ? prev : now));
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);
  return today;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const dayFmtYear = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const shortFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/** "Today", "Yesterday", "Tomorrow", "Sat 7 Nov" (with the year when it isn't this one). */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  const d = parseYmd(date);
  return d.getFullYear() === parseYmd(today).getFullYear() ? dayFmt.format(d) : dayFmtYear.format(d);
}

/** "7 Nov". */
export function shortDate(date: string): string {
  return shortFmt.format(parseYmd(date));
}

/** "in 3 days", "tomorrow", "today". */
export function inDays(date: string, today: string): string {
  const n = Math.round((parseYmd(date).getTime() - parseYmd(today).getTime()) / 86_400_000);
  if (n <= 0) return "today";
  if (n === 1) return "tomorrow";
  if (n < 14) return `in ${n} days`;
  return shortDate(date);
}

export function CategoryIcon({
  category,
  size = 14,
  className = "ex__cat-icon",
}: {
  category: ExpenseCategory | undefined;
  size?: number;
  className?: string;
}) {
  const Icon = expenseIcon(category?.icon);
  return (
    <span className={className} aria-hidden>
      <Icon size={size} />
    </span>
  );
}

/** Percent change, or null when there's nothing to compare with. */
export function change(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}
