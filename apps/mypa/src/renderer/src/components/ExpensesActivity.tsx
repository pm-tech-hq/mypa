import { useMemo, useState } from "react";

import { Download, Repeat, Search, Trash2, X } from "lucide-react";

import { periodLabel, toCsv, type ExpenseRow } from "../../../shared/expenses";
import { CategoryIcon, dayLabel, type ExCtx } from "../lib/expensesUi";

/** Every expense in the month, grouped by day, searchable and editable. */
export function ExpensesActivity({
  ctx,
  category,
  onCategory,
}: {
  ctx: ExCtx;
  category: string | null;
  onCategory: (id: string | null) => void;
}) {
  const { money, today } = ctx;
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const q = query.trim().toLowerCase();

  // Searching looks across every month; otherwise just the month on screen.
  const rows = useMemo(() => {
    const pool = q ? ctx.expenses : ctx.summary.rows;
    return pool.filter((e) => {
      if (category && e.categoryId !== category) return false;
      if (!q) return true;
      const cat = ctx.catById.get(e.categoryId)?.name.toLowerCase() ?? "";
      return e.note.toLowerCase().includes(q) || cat.includes(q) || (e.amount / 100).toFixed(2).includes(q);
    });
  }, [q, ctx.expenses, ctx.summary.rows, category, ctx.catById]);

  const groups = useMemo(() => {
    const out: { date: string; rows: ExpenseRow[]; total: number }[] = [];
    for (const e of [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)) {
      const last = out[out.length - 1];
      if (last && last.date === e.date) {
        last.rows.push(e);
        last.total += e.amount;
      } else out.push({ date: e.date, rows: [e], total: e.amount });
    }
    return out;
  }, [rows]);

  const total = rows.reduce((s, e) => s + e.amount, 0);
  const cat = category ? ctx.catById.get(category) : undefined;

  const exportCsv = async () => {
    const name = `Expenses ${q ? `matching ${query.trim()}` : periodLabel(ctx.period, ctx.settings.monthStart)}${cat ? ` ${cat.name}` : ""}`;
    const ok = await window.mypa.db.exportExpenses(
      toCsv(rows, ctx.categories, ctx.bills, ctx.settings.currency),
      name,
    );
    if (ok) setSaved(`Saved ${rows.length} ${rows.length === 1 ? "expense" : "expenses"}.`);
  };

  return (
    <div className="ex__activity">
      <div className="ex__filters">
        <label className="ex__search">
          <Search size={13} aria-hidden />
          <input
            value={query}
            placeholder="Search every month"
            aria-label="Search expenses"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={12} />
            </button>
          )}
        </label>
        <select
          className="field ex__cat-filter"
          value={category ?? ""}
          aria-label="Category"
          onChange={(e) => onCategory(e.target.value || null)}
        >
          <option value="">All categories</option>
          {ctx.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {groups.length === 0 ? (
        <div className="blankstate ex__empty">
          <p className="blankstate__title">
            {q ? "Nothing matches" : cat ? `No ${cat.name} spending this month` : "No spending this month"}
          </p>
          <p className="blankstate__text">
            {q
              ? "Search finds notes, categories and amounts in every month."
              : "Add some in the box above."}
          </p>
          {(q || cat) && (
            <button
              type="button"
              className="ex__link"
              onClick={() => {
                setQuery("");
                onCategory(null);
              }}
            >
              Show everything
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="ex__days">
            {groups.map((g) => (
              <section key={g.date} className="ex__day">
                <h3 className="ex__day-head">
                  <span>{dayLabel(g.date, today)}</span>
                  <span className="num">{money(g.total)}</span>
                </h3>
                <ul>
                  {g.rows.map((e) => {
                    const c = ctx.catById.get(e.categoryId);
                    return (
                      <li key={e.id} className="ex__item">
                        <button type="button" className="ex__item-main" onClick={() => ctx.edit(e)}>
                          <CategoryIcon category={c} size={13} />
                          <span className="ex__item-text">
                            <span className="ex__item-note">{e.note || c?.name || "Expense"}</span>
                            <span className="ex__item-meta">
                              {c?.name ?? "Other"}
                              {e.recurringId && (
                                <span className="ex__badge">
                                  <Repeat size={10} aria-hidden /> Bill
                                </span>
                              )}
                              {e.amount < 0 && <span className="ex__badge">Refund</span>}
                            </span>
                          </span>
                          <span className={`ex__item-amount num${e.amount < 0 ? " is-refund" : ""}`}>
                            {e.amount < 0 ? `−${money(-e.amount)}` : money(e.amount)}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="ex__item-del"
                          aria-label={`Delete ${e.note || "expense"}`}
                          title="Delete"
                          onClick={() => ctx.remove(e)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          <div className="ex__foot">
            <span className="num">
              {rows.length} {rows.length === 1 ? "expense" : "expenses"} · {money(total)}
            </span>
            {saved ? (
              <span className="ex__muted">{saved}</span>
            ) : (
              <button type="button" className="ex__link" onClick={() => void exportCsv()}>
                <Download size={12} />
                Export CSV
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
