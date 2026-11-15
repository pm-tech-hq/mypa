import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  List,
  PieChart,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

import {
  amountInput,
  currencySymbol,
  ordinal,
  parseAmount,
  parseQuick,
  parseYmd,
  periodLabel,
  periodOf,
  shiftPeriod,
  summarize,
  type ExpenseRow,
  type ExpensesWidgetSettings,
} from "../../../shared/expenses";
import type { WidgetRow } from "../../../shared/types";
import { expenseIcon } from "../lib/expenseIcons";
import { CategoryIcon, dayLabel, moneyFor, useToday, type ExCtx } from "../lib/expensesUi";
import { useReadyStore } from "../lib/store";
import { useUndo } from "../lib/useUndo";
import { errorText } from "../lib/tutor";
import { ExpensesActivity } from "./ExpensesActivity";
import { ExpensesBills } from "./ExpensesBills";
import { ExpensesMonth } from "./ExpensesMonth";
import { ExpensesTrends } from "./ExpensesTrends";
import { UndoToast } from "./UndoToast";
import "../styles/expenses.css";

type Tab = ExpensesWidgetSettings["expTab"];

const TABS: [Tab, string, typeof PieChart][] = [
  ["month", "Month", PieChart],
  ["activity", "Activity", List],
  ["bills", "Bills", CalendarClock],
  ["trends", "Trends", BarChart3],
];

/** Shown in the quick-add box, one at a time. */
const EXAMPLES = [
  "12.50 lunch",
  "uber 18 yesterday",
  "groceries 86 on sat",
  "rent 1400 #housing",
  "refund 20 shoes",
];

/**
 * The Expenses widget: type what you spent in plain words, see where the month
 * is heading against your budget, keep bills posting themselves, and watch the
 * trend over months. Expenses are app-wide (every Expenses widget shows the
 * same money); this widget only remembers its tab.
 */
export function ExpensesWidget({
  widget,
  onOpenSettings,
}: {
  widget: WidgetRow;
  onOpenSettings: () => void;
}) {
  const { snapshot, actions } = useReadyStore();
  const settings = snapshot.meta.expenses;
  const today = useToday();
  const undo = useUndo(widget.id);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<ExpenseRow | "new" | null>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const tab: Tab = widget.settings.expTab ?? "month";
  const setTab = (t: Tab) => void actions.updateWidgetSettings(widget.id, { expTab: t });

  const money = useMemo(() => moneyFor(settings.currency), [settings.currency]);
  const expenses = useMemo(
    () => snapshot.expenses.filter((e) => !undo.hidden.has(e.id)),
    [snapshot.expenses, undo.hidden],
  );
  const categories = snapshot.expenseCategories;
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const current = periodOf(today, settings.monthStart);
  const period = offset === 0 ? current : shiftPeriod(current, offset, settings.monthStart);
  const summary = useMemo(
    () => summarize(expenses, snapshot.expenseRecurring, period, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, snapshot.expenseRecurring, period.start, period.end, today],
  );

  const remove = useCallback(
    (e: ExpenseRow) => {
      setEditing(null);
      undo.schedule(e.id, `Deleted ${e.note || "expense"}`, () => void actions.deleteExpenses([e.id]));
    },
    [actions, undo],
  );

  const ctx: ExCtx = {
    settings,
    today,
    period,
    isCurrent: offset === 0,
    summary,
    expenses,
    categories,
    catById,
    bills: snapshot.expenseRecurring,
    money,
    edit: (e) => setEditing(e),
    remove,
    showCategory: (id) => {
      setCatFilter(id);
      setTab("activity");
    },
    openSettings: onOpenSettings,
  };

  return (
    <div className="ex">
      <QuickAdd ctx={ctx} onMore={() => setEditing("new")} onAdded={(date) => {
        // Show the month the expense went into.
        const p = periodOf(date, settings.monthStart);
        if (p.start !== period.start) {
          const months =
            (parseYmd(p.start).getFullYear() - parseYmd(current.start).getFullYear()) * 12 +
            parseYmd(p.start).getMonth() -
            parseYmd(current.start).getMonth();
          setOffset(Math.min(0, months));
        }
      }} />

      <div className="ex__bar">
        <div className="seg ex__tabs" role="tablist" aria-label="Expenses">
          {TABS.map(([id, name, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              title={name}
              className={`seg__btn${tab === id ? " is-active" : ""}`}
              onClick={() => setTab(id)}
            >
              <Icon size={13} />
              <span className="ex__tab-name">{name}</span>
            </button>
          ))}
        </div>
        {tab !== "bills" && (
          <div className="ex__period">
            <button
              type="button"
              className="ex__icon-btn"
              aria-label="Previous month"
              onClick={() => setOffset((o) => o - 1)}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              className="ex__period-label"
              title={offset ? "Back to this month" : undefined}
              onClick={() => setOffset(0)}
              disabled={offset === 0}
            >
              {periodLabel(period, settings.monthStart)}
            </button>
            <button
              type="button"
              className="ex__icon-btn"
              aria-label="Next month"
              onClick={() => setOffset((o) => Math.min(0, o + 1))}
              disabled={offset === 0}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>

      <div className="ex__body">
        {tab === "month" && <ExpensesMonth ctx={ctx} />}
        {tab === "activity" && (
          <ExpensesActivity ctx={ctx} category={catFilter} onCategory={setCatFilter} />
        )}
        {tab === "bills" && <ExpensesBills ctx={ctx} widget={widget} />}
        {tab === "trends" && <ExpensesTrends ctx={ctx} />}
      </div>

      {editing && (
        <ExpenseSheet
          ctx={ctx}
          expense={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {undo.latest && (
        <UndoToast
          key={undo.latest.id}
          label={undo.latest.label}
          onUndo={() => undo.undo(undo.latest!.id)}
          onDismiss={() => undo.finish(undo.latest!.id)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- quick add -- */

function QuickAdd({
  ctx,
  onMore,
  onAdded,
}: {
  ctx: ExCtx;
  onMore: () => void;
  onAdded: (date: string) => void;
}) {
  const { actions } = useReadyStore();
  const [text, setText] = useState("");
  const [override, setOverride] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [example, setExample] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // A different example now and then, while the box is empty.
  useEffect(() => {
    if (text) return;
    const t = window.setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 4000);
    return () => window.clearInterval(t);
  }, [text]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2600);
    return () => window.clearTimeout(t);
  }, [flash]);

  const parsed = useMemo(
    () =>
      text.trim()
        ? parseQuick(text, {
            categories: ctx.categories,
            history: ctx.expenses.slice(0, 500),
            today: ctx.today,
          })
        : null,
    [text, ctx.categories, ctx.expenses, ctx.today],
  );
  const categoryId = override ?? parsed?.categoryId ?? null;
  const category = categoryId ? ctx.catById.get(categoryId) : undefined;

  const submit = async () => {
    if (!parsed) {
      if (text.trim()) setError("Start with how much, like “12.50 lunch”.");
      return;
    }
    setError(null);
    try {
      await actions.createExpense({
        amount: parsed.amount,
        note: parsed.note,
        categoryId: categoryId ?? undefined,
        date: parsed.date,
      });
      setFlash(
        `${ctx.money(parsed.amount)} ${parsed.note ? `· ${parsed.note} ` : ""}added to ${category?.name ?? "Other"}`,
      );
      setText("");
      setOverride(null);
      onAdded(parsed.date);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="ex__quick">
      <div className={`ex__quick-row${parsed ? " is-valid" : ""}`}>
        <span className="ex__quick-cur" aria-hidden>
          {currencySymbol(ctx.settings.currency)}
        </span>
        <input
          ref={inputRef}
          className="ex__quick-input"
          value={text}
          placeholder={`Add spending: ${EXAMPLES[example]}`}
          aria-label="Add spending, for example 12.50 lunch yesterday"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
            if (!e.target.value) setOverride(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              setText("");
              setOverride(null);
              setError(null);
            }
          }}
        />
        {parsed ? (
          <button type="button" className="ex__quick-go" onClick={() => void submit()}>
            Add
          </button>
        ) : (
          <button
            type="button"
            className="ex__icon-btn"
            aria-label="Add with details"
            title="Add with details"
            onClick={onMore}
          >
            <SlidersHorizontal size={14} />
          </button>
        )}
      </div>

      {parsed ? (
        <div className="ex__preview" aria-live="polite">
          <span className={`ex__preview-amount num${parsed.amount < 0 ? " is-refund" : ""}`}>
            {parsed.amount < 0 ? `Refund ${ctx.money(-parsed.amount)}` : ctx.money(parsed.amount)}
          </span>
          {parsed.note && <span className="ex__preview-note">{parsed.note}</span>}
          <label className="ex__preview-cat" title="Change the category">
            <CategoryIcon category={category} size={12} className="ex__preview-icon" />
            <select
              value={categoryId ?? ""}
              onChange={(e) => setOverride(e.target.value)}
              aria-label="Category"
            >
              {ctx.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <span className="ex__preview-date">{dayLabel(parsed.date, ctx.today)}</span>
        </div>
      ) : error ? (
        <p className="ex__quick-msg is-error" role="alert">
          {error}
        </p>
      ) : flash ? (
        <p className="ex__quick-msg is-done" role="status">
          {flash}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- add / edit -- */

function ExpenseSheet({
  ctx,
  expense,
  onClose,
}: {
  ctx: ExCtx;
  expense: ExpenseRow | null;
  onClose: () => void;
}) {
  const { actions } = useReadyStore();
  const [amount, setAmount] = useState(expense ? amountInput(expense.amount) : "");
  const [refund, setRefund] = useState(expense ? expense.amount < 0 : false);
  const [note, setNote] = useState(expense?.note ?? "");
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? "");
  const [date, setDate] = useState(expense?.date ?? ctx.today);
  const [repeat, setRepeat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const bill = expense?.recurringId ? ctx.bills.find((b) => b.id === expense.recurringId) : null;

  useEffect(() => amountRef.current?.focus(), []);

  const save = async () => {
    const value = parseAmount(amount);
    if (value === null) {
      setError("Enter how much it was.");
      amountRef.current?.focus();
      return;
    }
    const signed = refund ? -Math.abs(value) : Math.abs(value);
    const cat = categoryId || undefined;
    setBusy(true);
    setError(null);
    try {
      if (expense) {
        await actions.updateExpense(expense.id, {
          amount: signed,
          note,
          date,
          ...(cat ? { categoryId: cat } : {}),
        });
      } else if (repeat) {
        await actions.createExpenseBill({
          amount: signed,
          note: note || "Bill",
          categoryId: cat ?? "subscriptions",
          day: parseYmd(date).getDate(),
          start: date,
        });
      } else {
        await actions.createExpense({ amount: signed, note, categoryId: cat, date });
      }
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="ex__sheet-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="ex__sheet"
        aria-label={expense ? "Edit expense" : "Add expense"}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="ex__sheet-head">
          <span>{expense ? "Edit expense" : "Add expense"}</span>
          <button type="button" className="ex__icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="ex__sheet-amount">
          <span aria-hidden>{currencySymbol(ctx.settings.currency)}</span>
          <input
            ref={amountRef}
            inputMode="decimal"
            className="num"
            placeholder="0.00"
            value={amount}
            aria-label="Amount"
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="seg ex__sheet-kind">
            <button
              type="button"
              className={`seg__btn${!refund ? " is-active" : ""}`}
              aria-pressed={!refund}
              onClick={() => setRefund(false)}
            >
              Spent
            </button>
            <button
              type="button"
              className={`seg__btn${refund ? " is-active" : ""}`}
              aria-pressed={refund}
              onClick={() => setRefund(true)}
            >
              Refund
            </button>
          </div>
        </div>

        <label className="ex__field">
          <span>What for</span>
          <input
            className="field"
            value={note}
            placeholder="Lunch, Uber, Netflix…"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="ex__field">
          <span>Category</span>
          <div className="ex__cat-grid" role="radiogroup" aria-label="Category">
            {ctx.categories.map((c) => {
              const Icon = expenseIcon(c.icon);
              const on = categoryId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`ex__cat-pick${on ? " is-on" : ""}`}
                  onClick={() => setCategoryId(on ? "" : c.id)}
                >
                  <Icon size={14} aria-hidden />
                  <span>{c.name}</span>
                </button>
              );
            })}
          </div>
          {!categoryId && <small className="ex__hint">None picked: guessed from what it was for.</small>}
        </div>

        <div className="ex__sheet-row">
          <label className="ex__field">
            <span>{repeat ? "First payment" : "Date"}</span>
            <input
              type="date"
              className="field"
              value={date}
              max={repeat ? undefined : ctx.today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </label>
          {!expense && (
            <label className="ex__check">
              <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
              <span>
                Every month
                <small>Posts itself on the {ordinal(parseYmd(date).getDate())} of each month</small>
              </span>
            </label>
          )}
        </div>

        {bill && (
          <p className="ex__hint">
            Posted by the bill “{bill.note}”. Changing it here changes only this payment.
          </p>
        )}
        {error && (
          <p className="ex__quick-msg is-error" role="alert">
            {error}
          </p>
        )}

        <div className="ex__sheet-actions">
          {expense && (
            <button type="button" className="ex__danger-btn" onClick={() => ctx.remove(expense)}>
              <Trash2 size={13} />
              Delete
            </button>
          )}
          <span className="ex__grow" />
          <button type="button" className="ex__ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {expense ? "Save" : repeat ? (
              <>
                <Plus size={13} />
                Add bill
              </>
            ) : (
              <>
                <Plus size={13} />
                Add
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
