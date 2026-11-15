import { useMemo, useState } from "react";

import { ArrowDownRight, ArrowUpRight, Receipt, Wallet } from "lucide-react";

import {
  addDays,
  periodLabel,
  shiftPeriod,
  spentInFirstDays,
  summarize,
} from "../../../shared/expenses";
import { CategoryIcon, change, inDays, shortDate, type ExCtx } from "../lib/expensesUi";

/** This month at a glance: where it stands against the budget, where it's
 *  heading, how it compares with last month, and each category's share. */
export function ExpensesMonth({ ctx }: { ctx: ExCtx }) {
  const { summary: sum, settings, period, isCurrent, money, today } = ctx;
  const budget = settings.budget;
  const prev = shiftPeriod(period, -1, settings.monthStart);
  const prevSum = useMemo(
    () => summarize(ctx.expenses, ctx.bills, prev, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.expenses, ctx.bills, prev.start, today],
  );
  const prevSameDay = isCurrent ? spentInFirstDays(ctx.expenses, prev, sum.elapsed) : prevSum.spent;
  const delta = change(sum.spent, prevSameDay);
  const daysLeft = period.days - sum.elapsed + (isCurrent ? 1 : 0); // today still counts
  const left = budget !== null ? budget - sum.spent - sum.upcomingTotal : null;
  const perDay = left !== null && isCurrent && daysLeft > 0 ? Math.floor(left / daysLeft) : null;
  const over = budget !== null && sum.spent > budget;

  if (sum.rows.length === 0 && !(isCurrent && sum.upcoming.length)) {
    return (
      <div className="blankstate ex__empty">
        <span className="blankstate__icon">
          <Wallet size={16} />
        </span>
        <p className="blankstate__title">
          {isCurrent ? "Nothing spent yet this month" : `Nothing logged in ${periodLabel(period, settings.monthStart)}`}
        </p>
        <p className="blankstate__text">
          {isCurrent
            ? "Type what you spend in the box above, like “coffee 4.50” or “uber 18 yesterday”. Add rent and subscriptions under Bills and they post themselves."
            : "Go back to this month, or add an older expense with a date (“taxi 9 on oct 3”)."}
        </p>
        {isCurrent && budget === null && (
          <button type="button" className="ex__link" onClick={ctx.openSettings}>
            Set a monthly budget
          </button>
        )}
      </div>
    );
  }

  const pace = budget && isCurrent ? sum.elapsed / period.days : null;
  const used = budget ? Math.min(1, Math.max(0, sum.spent / budget)) : 0;
  const ahead = pace !== null && budget ? sum.spent / budget - pace : 0;

  return (
    <div className="ex__month">
      <section className="ex__hero" aria-label="Spent this month">
        <span className="ex__eyebrow">{isCurrent ? "Spent so far" : "Spent"}</span>
        <div className="ex__hero-row">
          <span className={`ex__hero-amount num${over ? " is-over" : ""}`}>{money(sum.spent)}</span>
          {budget !== null && (
            <span className="ex__hero-of num">of {money(budget, { whole: true })}</span>
          )}
        </div>

        {budget !== null ? (
          <>
            <div
              className={`ex__meter${over ? " is-over" : ahead > 0.08 ? " is-ahead" : ""}`}
              role="meter"
              aria-valuemin={0}
              aria-valuemax={budget / 100}
              aria-valuenow={sum.spent / 100}
              aria-label="Budget used"
            >
              <span className="ex__meter-fill" style={{ width: `${used * 100}%` }} />
              {sum.upcomingTotal > 0 && !over && (
                <span
                  className="ex__meter-bills"
                  style={{
                    left: `${used * 100}%`,
                    width: `${Math.min(1 - used, sum.upcomingTotal / budget) * 100}%`,
                  }}
                  title={`${money(sum.upcomingTotal)} of bills still to come`}
                />
              )}
              {pace !== null && (
                <span
                  className="ex__meter-pace"
                  style={{ left: `${pace * 100}%` }}
                  title="Where you'd be spending evenly"
                />
              )}
            </div>
            <p className="ex__hero-note">
              {over ? (
                <>
                  <strong className="is-over num">{money(sum.spent - budget)} over</strong> your budget
                  {isCurrent ? ` with ${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go.` : "."}
                </>
              ) : !isCurrent ? (
                <>
                  <strong className="num">{money(budget - sum.spent)}</strong> under budget.
                </>
              ) : left !== null && left < 0 ? (
                <>
                  Bills still due put you <strong className="is-over num">{money(-left)} over</strong>.
                </>
              ) : (
                <>
                  <strong className="num">{money(left ?? 0)}</strong> left
                  {sum.upcomingTotal > 0 && <> after {money(sum.upcomingTotal, { whole: true })} of bills</>}
                  {perDay !== null && (
                    <>
                      {" "}· about <strong className="num">{money(perDay, { whole: perDay >= 1000 })}</strong> a
                      day
                    </>
                  )}
                </>
              )}
            </p>
          </>
        ) : (
          <p className="ex__hero-note">
            <button type="button" className="ex__link" onClick={ctx.openSettings}>
              Set a monthly budget
            </button>{" "}
            to see what&apos;s safe to spend each day.
          </p>
        )}
      </section>

      <div className="ex__tiles">
        {isCurrent ? (
          <Tile
            label="Heading for"
            value={money(sum.projected, { whole: true })}
            note={
              budget !== null
                ? sum.projected > budget
                  ? `${money(sum.projected - budget, { whole: true })} over budget`
                  : `${money(budget - sum.projected, { whole: true })} to spare`
                : "by month end"
            }
            tone={budget !== null && sum.projected > budget ? "over" : undefined}
          />
        ) : (
          <Tile
            label="Daily average"
            value={money(Math.round(sum.spent / Math.max(1, period.days)))}
            note={`over ${period.days} days`}
          />
        )}
        <Tile
          label={`vs ${periodLabel(prev, settings.monthStart, true)}`}
          value={delta === null ? "–" : `${delta > 0 ? "+" : ""}${delta}%`}
          icon={delta === null || delta === 0 ? null : delta > 0 ? ArrowUpRight : ArrowDownRight}
          note={
            delta === null
              ? "nothing to compare"
              : `${money(Math.abs(sum.spent - prevSameDay), { whole: true })} ${sum.spent > prevSameDay ? "more" : "less"}${isCurrent ? " at this point" : ""}`
          }
          tone={delta !== null && delta > 10 ? "over" : undefined}
        />
        {isCurrent && sum.upcoming.length > 0 ? (
          <Tile
            label="Bills to come"
            value={money(sum.upcomingTotal, { whole: true })}
            note={`${sum.upcoming.length} · next ${inDays(sum.upcoming[0]!.date, today)}`}
          />
        ) : (
          <BiggestTile ctx={ctx} />
        )}
      </div>

      <PaceChart ctx={ctx} prev={prevSum.cumulative} />

      <Categories ctx={ctx} />

      {isCurrent && sum.upcoming.length > 0 && (
        <section className="ex__section">
          <h3 className="ex__h">Still due this month</h3>
          <ul className="ex__upcoming">
            {sum.upcoming.slice(0, 6).map((u) => (
              <li key={`${u.bill.id}:${u.date}`}>
                <CategoryIcon category={ctx.catById.get(u.bill.categoryId)} size={13} />
                <span className="ex__upcoming-name">{u.bill.note}</span>
                <span className="ex__upcoming-when">{inDays(u.date, today)}</span>
                <span className="num">{money(u.bill.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon?: typeof ArrowUpRight | null;
  tone?: "over";
}) {
  return (
    <div className={`ex__tile${tone === "over" ? " is-over" : ""}`}>
      <span className="ex__tile-label">{label}</span>
      <span className="ex__tile-value num">
        {Icon && <Icon size={14} aria-hidden />}
        {value}
      </span>
      <span className="ex__tile-note">{note}</span>
    </div>
  );
}

function BiggestTile({ ctx }: { ctx: ExCtx }) {
  const top = ctx.summary.rows.reduce<(typeof ctx.summary.rows)[number] | null>(
    (best, e) => (!best || e.amount > best.amount ? e : best),
    null,
  );
  if (!top) return <Tile label="Biggest" value="–" note="nothing yet" />;
  return (
    <button type="button" className="ex__tile ex__tile--btn" onClick={() => ctx.edit(top)}>
      <span className="ex__tile-label">Biggest</span>
      <span className="ex__tile-value num">{ctx.money(top.amount, { whole: true })}</span>
      <span className="ex__tile-note">
        {top.note || ctx.catById.get(top.categoryId)?.name || "Expense"} · {shortDate(top.date)}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------- pace chart -- */

const W = 320;
const H = 96;

/** Running total through the month against last month and the budget, with
 *  a dotted line to where this month is heading. */
function PaceChart({ ctx, prev }: { ctx: ExCtx; prev: number[] }) {
  const { summary: sum, period, settings, isCurrent, money } = ctx;
  const [hover, setHover] = useState<number | null>(null);
  const days = period.days;
  const shown = isCurrent ? sum.elapsed : days;
  const budget = settings.budget;
  const max = Math.max(
    1,
    ...sum.cumulative.slice(0, shown),
    ...prev,
    isCurrent ? sum.projected : 0,
    budget ?? 0,
  ) * 1.08;
  const x = (i: number) => ((i + 1) / days) * W;
  const y = (v: number) => H - (Math.max(0, v) / max) * H;
  const line = (vals: number[], n: number) =>
    vals
      .slice(0, n)
      .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(" ");
  const nowPath = `M0,${H} ${line(sum.cumulative, shown).replace(/^M/, "L")}`;
  const areaPath = shown > 0 ? `${nowPath} L${x(shown - 1).toFixed(1)},${H} Z` : "";
  const lastNow = shown > 0 ? sum.cumulative[shown - 1]! : 0;
  const prevPath = prev.length ? `M0,${H} ${line(prev, Math.min(prev.length, days)).replace(/^M/, "L")}` : "";
  const i = hover ?? (shown > 0 ? shown - 1 : 0);
  const date = addDays(period.start, i);
  const prevLabel = periodLabel(shiftPeriod(period, -1, settings.monthStart), settings.monthStart, true);

  return (
    <section className="ex__section">
      <div className="ex__chart-head">
        <h3 className="ex__h">Pace</h3>
        <span className="ex__chart-read num">
          {shortDate(date)}: <strong>{money(sum.cumulative[i] ?? 0, { whole: true })}</strong>
          {prev.length > 0 && (
            <span className="ex__muted">
              {" "}· {prevLabel} {money(prev[Math.min(i, prev.length - 1)] ?? 0, { whole: true })}
            </span>
          )}
        </span>
      </div>
      <svg
        className="ex__pace"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Spent ${money(lastNow)} so far${budget ? ` of ${money(budget)}` : ""}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const idx = Math.floor(((e.clientX - r.left) / r.width) * days);
          setHover(Math.max(0, Math.min(days - 1, idx)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {budget !== null && (
          <line className="ex__pace-budget" x1={0} x2={W} y1={y(budget)} y2={y(budget)} />
        )}
        {prevPath && <path className="ex__pace-prev" d={prevPath} />}
        {areaPath && <path className="ex__pace-area" d={areaPath} />}
        {shown > 0 && <path className="ex__pace-now" d={nowPath} />}
        {isCurrent && shown > 0 && shown < days && (
          <line
            className="ex__pace-proj"
            x1={x(shown - 1)}
            y1={y(lastNow)}
            x2={W}
            y2={y(sum.projected)}
          />
        )}
        <line className="ex__pace-cursor" x1={x(i)} x2={x(i)} y1={0} y2={H} />
      </svg>
      <div className="ex__legend">
        <span>
          <i className="ex__key ex__key--now" /> This month
        </span>
        {prev.length > 0 && (
          <span>
            <i className="ex__key ex__key--prev" /> {prevLabel}
          </span>
        )}
        {isCurrent && (
          <span>
            <i className="ex__key ex__key--proj" /> Heading for
          </span>
        )}
        {budget !== null && (
          <span>
            <i className="ex__key ex__key--budget" /> Budget
          </span>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- categories -- */

function Categories({ ctx }: { ctx: ExCtx }) {
  const { summary: sum, money } = ctx;
  const rows = ctx.categories
    .map((c) => ({ c, spent: sum.byCategory.get(c.id) ?? 0 }))
    .filter((r) => r.spent !== 0 || r.c.budget !== null)
    .sort((a, b) => b.spent - a.spent);
  // Spending in a category that was deleted since.
  const orphan = [...sum.byCategory.entries()]
    .filter(([id]) => !ctx.catById.has(id))
    .reduce((s, [, v]) => s + v, 0);
  if (!rows.length && !orphan) return null;
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.spent, r.c.budget ?? 0)));
  const total = Math.max(1, sum.spent);

  return (
    <section className="ex__section">
      <h3 className="ex__h">Where it went</h3>
      <ul className="ex__cats">
        {rows.map(({ c, spent }) => {
          const over = c.budget !== null && spent > c.budget;
          return (
            <li key={c.id}>
              <button
                type="button"
                className="ex__cat-row"
                onClick={() => ctx.showCategory(c.id)}
                title={`See ${c.name} spending`}
              >
                <CategoryIcon category={c} size={13} />
                <span className="ex__cat-name">{c.name}</span>
                <span className="ex__cat-share num">
                  {spent > 0 ? `${Math.round((spent / total) * 100)}%` : ""}
                </span>
                <span className={`ex__cat-amount num${over ? " is-over" : ""}`}>
                  {money(spent)}
                  {c.budget !== null && (
                    <span className="ex__cat-budget"> / {money(c.budget, { whole: true })}</span>
                  )}
                </span>
                <span className="ex__cat-track" aria-hidden>
                  <span
                    className={`ex__cat-fill${over ? " is-over" : ""}`}
                    style={{ width: `${(Math.max(0, Math.min(spent, c.budget ?? spent)) / scale) * 100}%` }}
                  />
                  {over && (
                    <span
                      className="ex__cat-overflow"
                      style={{
                        left: `${(c.budget! / scale) * 100}%`,
                        width: `${((spent - c.budget!) / scale) * 100}%`,
                      }}
                    />
                  )}
                  {c.budget !== null && (
                    <span className="ex__cat-mark" style={{ left: `${(c.budget / scale) * 100}%` }} />
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {orphan !== 0 && (
          <li>
            <div className="ex__cat-row">
              <span className="ex__cat-icon">
                <Receipt size={13} />
              </span>
              <span className="ex__cat-name">Uncategorised</span>
              <span className="ex__cat-share" />
              <span className="ex__cat-amount num">{money(orphan)}</span>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}
