import { useEffect, useState } from "react";

import { Download, Plus, Trash2 } from "lucide-react";

import {
  COMMON_CURRENCIES,
  amountInput,
  currencySymbol,
  ordinal,
  parseAmount,
  toCsv,
  type ExpenseCategory,
} from "../../../shared/expenses";
import { EXPENSE_ICON_KEYS, expenseIcon } from "../lib/expenseIcons";
import { useReadyStore } from "../lib/store";
import { errorText } from "../lib/tutor";

/** The Expenses section of the widget settings panel. Everything here is
 *  shared by every Expenses widget. */
export function ExpensesSettingsForm() {
  const { snapshot, actions } = useReadyStore();
  const s = snapshot.meta.expenses;
  const [budget, setBudget] = useState(s.budget === null ? "" : amountInput(s.budget));
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const currencies = COMMON_CURRENCIES.includes(s.currency)
    ? COMMON_CURRENCIES
    : [s.currency, ...COMMON_CURRENCIES];

  useEffect(() => setBudget(s.budget === null ? "" : amountInput(s.budget)), [s.budget]);

  const commitBudget = () => {
    const v = budget.trim() ? parseAmount(budget) : null;
    if (budget.trim() && (v === null || v <= 0)) {
      setBudget(s.budget === null ? "" : amountInput(s.budget));
      return;
    }
    if (v !== s.budget) void actions.setExpenseSettings({ budget: v });
  };

  const addCategory = async () => {
    if (!newName.trim()) return;
    try {
      await actions.createExpenseCategory({ name: newName });
      setNewName("");
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const exportAll = async () => {
    const ok = await window.mypa.db.exportExpenses(
      toCsv(snapshot.expenses, snapshot.expenseCategories, snapshot.expenseRecurring, s.currency),
      "All expenses",
    );
    if (ok) setSaved(`Saved ${snapshot.expenses.length} expenses.`);
  };

  return (
    <>
      <p className="wsettings__section">Money</p>

      <label className="wsettings__field">
        <span className="wsettings__label">Currency</span>
        <select
          className="wsettings__input"
          value={s.currency}
          onChange={(e) => void actions.setExpenseSettings({ currency: e.target.value })}
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c} · {currencySymbol(c)}
            </option>
          ))}
        </select>
        <span className="wsettings__hint">
          Changes how amounts are shown; it doesn&apos;t convert what you&apos;ve already logged.
        </span>
      </label>

      <label className="wsettings__field">
        <span className="wsettings__label">Monthly budget</span>
        <span className="ex__money-input">
          <span aria-hidden>{currencySymbol(s.currency)}</span>
          <input
            className="wsettings__input num"
            inputMode="decimal"
            placeholder="No budget"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            onBlur={commitBudget}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </span>
        <span className="wsettings__hint">
          Everything you plan to spend in a month, bills included. Leave empty for none.
        </span>
      </label>

      <label className="wsettings__field">
        <span className="wsettings__label">Months start on the</span>
        <select
          className="wsettings__input"
          value={s.monthStart}
          onChange={(e) => void actions.setExpenseSettings({ monthStart: Number(e.target.value) })}
        >
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {ordinal(d)}
              {d === 1 ? " (calendar months)" : ""}
            </option>
          ))}
        </select>
        <span className="wsettings__hint">
          Paid on the 25th? Start months on the 25th and every total runs payday to payday.
        </span>
      </label>

      <p className="wsettings__section">Categories</p>
      <ul className="ex-set__cats">
        {snapshot.expenseCategories.map((c) => (
          <CategoryRow key={c.id} category={c} currency={s.currency} />
        ))}
      </ul>
      <form
        className="ex-set__add"
        onSubmit={(e) => {
          e.preventDefault();
          void addCategory();
        }}
      >
        <input
          className="wsettings__input"
          placeholder="New category"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!newName.trim()}>
          <Plus size={13} />
          Add
        </button>
      </form>
      {error && <p className="wsettings__hint ex-set__error">{error}</p>}
      <p className="wsettings__hint">
        A budget on a category shows a limit line on its bar. Deleting a category moves its spending
        to Other.
      </p>

      <p className="wsettings__section">Your data</p>
      <div className="wsettings__field">
        <button
          type="button"
          className="ex-set__export"
          onClick={() => void exportAll()}
          disabled={!snapshot.expenses.length}
        >
          <Download size={13} />
          Export every expense (CSV)
        </button>
        <span className="wsettings__hint">
          {saved ??
            "Opens in Excel, Numbers or Google Sheets. Your expenses stay on this computer; the Assistant can log and look up spending if you allow Expenses in its settings."}
        </span>
      </div>
    </>
  );
}

function CategoryRow({ category: c, currency }: { category: ExpenseCategory; currency: string }) {
  const { actions } = useReadyStore();
  const [name, setName] = useState(c.name);
  const [budget, setBudget] = useState(c.budget === null ? "" : amountInput(c.budget));
  const [picking, setPicking] = useState(false);
  const [armed, setArmed] = useState(false);
  const Icon = expenseIcon(c.icon);

  useEffect(() => setName(c.name), [c.name]);
  useEffect(() => setBudget(c.budget === null ? "" : amountInput(c.budget)), [c.budget]);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const commitBudget = () => {
    const v = budget.trim() ? parseAmount(budget) : null;
    if (budget.trim() && (v === null || v <= 0)) {
      setBudget(c.budget === null ? "" : amountInput(c.budget));
      return;
    }
    if (v !== c.budget) void actions.updateExpenseCategory(c.id, { budget: v });
  };

  return (
    <li className="ex-set__cat">
      <div className="ex-set__cat-row">
        <button
          type="button"
          className={`ex-set__icon${picking ? " is-on" : ""}`}
          aria-label={`Icon for ${c.name}`}
          aria-expanded={picking}
          onClick={() => setPicking((v) => !v)}
        >
          <Icon size={14} />
        </button>
        <input
          className="wsettings__input ex-set__name"
          value={name}
          aria-label="Category name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== c.name) void actions.updateExpenseCategory(c.id, { name });
            else setName(c.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span className="ex__money-input ex-set__budget">
          <span aria-hidden>{currencySymbol(currency)}</span>
          <input
            className="wsettings__input num"
            inputMode="decimal"
            placeholder="Budget"
            aria-label={`Monthly budget for ${c.name}`}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            onBlur={commitBudget}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </span>
        {c.id !== "other" ? (
          <button
            type="button"
            className={`ex__icon-btn ex__icon-btn--danger${armed ? " is-armed" : ""}`}
            aria-label={armed ? `Click again to delete ${c.name}` : `Delete ${c.name}`}
            title={armed ? "Click again: its spending moves to Other" : "Delete"}
            onClick={() => {
              if (!armed) return setArmed(true);
              setArmed(false);
              void actions.deleteExpenseCategory(c.id);
            }}
          >
            <Trash2 size={13} />
          </button>
        ) : (
          <span className="ex-set__spacer" />
        )}
      </div>
      {picking && (
        <div className="ex-set__icons" role="radiogroup" aria-label={`Icon for ${c.name}`}>
          {EXPENSE_ICON_KEYS.map((k) => {
            const I = expenseIcon(k);
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={c.icon === k}
                aria-label={k}
                className={`ex-set__icon${c.icon === k ? " is-on" : ""}`}
                onClick={() => {
                  void actions.updateExpenseCategory(c.id, { icon: k });
                  setPicking(false);
                }}
              >
                <I size={14} />
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}
