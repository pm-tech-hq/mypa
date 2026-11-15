import { useEffect, useMemo, useState } from "react";

import { CalendarClock, Pause, Pencil, Play, Plus, Sparkles, Trash2, X } from "lucide-react";

import {
  amountInput,
  currencySymbol,
  nextDue,
  ordinal,
  parseAmount,
  suggestBills,
  type ExpenseRecurring,
} from "../../../shared/expenses";
import type { WidgetRow } from "../../../shared/types";
import { CategoryIcon, inDays, shortDate, type ExCtx } from "../lib/expensesUi";
import { useReadyStore } from "../lib/store";
import { errorText } from "../lib/tutor";

/** Rent, subscriptions and other monthly bills: they post themselves on their
 *  day, so the month's picture includes them before they're paid. */
export function ExpensesBills({ ctx, widget }: { ctx: ExCtx; widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const { money, today } = ctx;
  const [form, setForm] = useState<ExpenseRecurring | "new" | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(null), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const bills = useMemo(
    () =>
      [...ctx.bills].sort((a, b) => {
        if (a.paused !== b.paused) return a.paused ? 1 : -1;
        return (nextDue(a, today) ?? "9999").localeCompare(nextDue(b, today) ?? "9999");
      }),
    [ctx.bills, today],
  );
  const active = bills.filter((b) => !b.paused && (!b.end || b.end >= today));
  const monthly = active.reduce((s, b) => s + b.amount, 0);
  const dismissed = widget.settings.expDismissed ?? [];
  const suggestions = useMemo(
    () => suggestBills(ctx.expenses, ctx.bills, today, dismissed),
    [ctx.expenses, ctx.bills, today, dismissed],
  );

  const dismiss = (key: string) =>
    void actions.updateWidgetSettings(widget.id, { expDismissed: [...dismissed, key].slice(-100) });

  return (
    <div className="ex__bills">
      <section className="ex__hero ex__hero--bills">
        <span className="ex__eyebrow">Monthly bills</span>
        <div className="ex__hero-row">
          <span className="ex__hero-amount num">{money(monthly)}</span>
          <span className="ex__hero-of num">{money(monthly * 12, { whole: true })} a year</span>
        </div>
        {ctx.settings.budget !== null && monthly > 0 && (
          <p className="ex__hero-note">
            {Math.round((monthly / ctx.settings.budget) * 100)}% of your monthly budget is spoken for
            before you spend a thing.
          </p>
        )}
      </section>

      {suggestions.length > 0 && (
        <section className="ex__section">
          <h3 className="ex__h">
            <Sparkles size={12} aria-hidden /> Looks like a monthly bill
          </h3>
          <ul className="ex__suggest">
            {suggestions.map((s) => (
              <li key={s.key}>
                <CategoryIcon category={ctx.catById.get(s.categoryId)} size={13} />
                <span className="ex__suggest-text">
                  <strong>{s.note}</strong>
                  <span className="ex__muted">
                    {money(s.amount)} around the {ordinal(s.day)}, {s.months} months running
                  </span>
                </span>
                <button
                  type="button"
                  className="ex__chip-btn"
                  onClick={() =>
                    void actions.createExpenseBill({
                      amount: s.amount,
                      note: s.note,
                      categoryId: s.categoryId,
                      day: s.day,
                      // From the next one on; the ones already logged stay as they are.
                      start: (nextDueFromDay(s.day, today)),
                    })
                  }
                >
                  Make it a bill
                </button>
                <button
                  type="button"
                  className="ex__icon-btn"
                  aria-label={`Not a bill: ${s.note}`}
                  title="Not a bill"
                  onClick={() => dismiss(s.key)}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="ex__section">
        <div className="ex__chart-head">
          <h3 className="ex__h">Your bills</h3>
          {form === null && (
            <button type="button" className="ex__link" onClick={() => setForm("new")}>
              <Plus size={12} />
              Add a bill
            </button>
          )}
        </div>

        {form === "new" && <BillForm ctx={ctx} bill={null} onClose={() => setForm(null)} />}

        {bills.length === 0 && form === null ? (
          <div className="blankstate ex__empty">
            <span className="blankstate__icon">
              <CalendarClock size={16} />
            </span>
            <p className="blankstate__title">No bills yet</p>
            <p className="blankstate__text">
              Add rent, phone, internet and subscriptions once. Each posts itself on its day, and
              the month view counts the ones still to come.
            </p>
            <button type="button" className="btn" onClick={() => setForm("new")}>
              <Plus size={13} />
              Add a bill
            </button>
          </div>
        ) : (
          <ul className="ex__bill-list">
            {bills.map((b) =>
              form !== null && form !== "new" && form.id === b.id ? (
                <li key={b.id}>
                  <BillForm ctx={ctx} bill={b} onClose={() => setForm(null)} />
                </li>
              ) : (
                <li key={b.id} className={`ex__bill${b.paused ? " is-paused" : ""}`}>
                  <CategoryIcon category={ctx.catById.get(b.categoryId)} size={14} />
                  <span className="ex__bill-text">
                    <span className="ex__bill-name">{b.note}</span>
                    <span className="ex__bill-when">
                      {b.paused
                        ? "Paused"
                        : (() => {
                            const next = nextDue(b, today);
                            return next
                              ? `${ordinal(b.day)} of each month · next ${inDays(next, today)}`
                              : `Ended ${b.end ? shortDate(b.end) : ""}`;
                          })()}
                    </span>
                  </span>
                  <span className="ex__bill-amount num">{money(b.amount)}</span>
                  <span className="ex__bill-actions">
                    <button
                      type="button"
                      className="ex__icon-btn"
                      aria-label={b.paused ? `Resume ${b.note}` : `Pause ${b.note}`}
                      title={b.paused ? "Resume" : "Pause"}
                      onClick={() => void actions.updateExpenseBill(b.id, { paused: !b.paused })}
                    >
                      {b.paused ? <Play size={13} /> : <Pause size={13} />}
                    </button>
                    <button
                      type="button"
                      className="ex__icon-btn"
                      aria-label={`Edit ${b.note}`}
                      title="Edit"
                      onClick={() => setForm(b)}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className={`ex__icon-btn ex__icon-btn--danger${armed === b.id ? " is-armed" : ""}`}
                      aria-label={armed === b.id ? `Click again to delete ${b.note}` : `Delete ${b.note}`}
                      title={armed === b.id ? "Click again to delete" : "Delete"}
                      onClick={() => {
                        if (armed !== b.id) {
                          setArmed(b.id);
                          return;
                        }
                        setArmed(null);
                        void actions.deleteExpenseBill(b.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
        {bills.length > 0 && (
          <p className="ex__hint">
            Deleting a bill stops it. What it already posted stays in your spending. Pausing skips
            the months it&apos;s paused.
          </p>
        )}
      </section>
    </div>
  );
}

/** The next date that falls on this day of the month, from tomorrow. */
function nextDueFromDay(day: number, today: string): string {
  const t = new Date(`${today}T12:00:00`);
  for (let i = 1; i <= 62; i++) {
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i, 12);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (d.getDate() === Math.min(day, last)) {
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
  }
  return today;
}

function BillForm({
  ctx,
  bill,
  onClose,
}: {
  ctx: ExCtx;
  bill: ExpenseRecurring | null;
  onClose: () => void;
}) {
  const { actions } = useReadyStore();
  const [name, setName] = useState(bill?.note ?? "");
  const [amount, setAmount] = useState(bill ? amountInput(bill.amount) : "");
  const [day, setDay] = useState(bill?.day ?? Number(ctx.today.slice(8, 10)));
  const [categoryId, setCategoryId] = useState(
    bill?.categoryId ?? (ctx.catById.has("subscriptions") ? "subscriptions" : (ctx.categories[0]?.id ?? "")),
  );
  const [postNow, setPostNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dueToday = !bill && day <= Number(ctx.today.slice(8, 10));

  const save = async () => {
    const value = parseAmount(amount);
    if (!name.trim()) return setError("Give the bill a name.");
    if (value === null) return setError("Enter how much it is.");
    try {
      if (bill) {
        await actions.updateExpenseBill(bill.id, {
          note: name,
          amount: Math.abs(value),
          day,
          categoryId,
        });
      } else {
        await actions.createExpenseBill({
          note: name,
          amount: Math.abs(value),
          day,
          categoryId,
          // This month's payment is logged now only when asked; otherwise it starts next time.
          start: dueToday && !postNow ? nextDueFromDay(day, ctx.today) : ctx.today,
        });
      }
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <form
      className="ex__bill-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="ex__bill-form-row">
        <label className="ex__field ex__grow">
          <span>Name</span>
          <input
            className="field"
            autoFocus
            value={name}
            placeholder="Rent, Netflix, Phone…"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="ex__field ex__bill-amount-field">
          <span>Amount</span>
          <span className="ex__money-input">
            <span aria-hidden>{currencySymbol(ctx.settings.currency)}</span>
            <input
              className="field num"
              inputMode="decimal"
              value={amount}
              placeholder="0.00"
              onChange={(e) => setAmount(e.target.value)}
            />
          </span>
        </label>
      </div>
      <div className="ex__bill-form-row">
        <label className="ex__field">
          <span>Day of the month</span>
          <select className="field" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {ordinal(d)}
                {d > 28 ? " (or the last day)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="ex__field ex__grow">
          <span>Category</span>
          <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {ctx.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {dueToday && (
        <label className="ex__check">
          <input type="checkbox" checked={postNow} onChange={(e) => setPostNow(e.target.checked)} />
          <span>
            Log this month&apos;s payment now
            <small>Its day has passed this month. Leave unticked if you already logged it.</small>
          </span>
        </label>
      )}
      {error && (
        <p className="ex__quick-msg is-error" role="alert">
          {error}
        </p>
      )}
      <div className="ex__sheet-actions">
        <span className="ex__grow" />
        <button type="button" className="ex__ghost-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn">
          {bill ? "Save" : "Add bill"}
        </button>
      </div>
    </form>
  );
}
