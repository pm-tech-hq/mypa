import { useMemo, useState } from "react";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import {
  addDays,
  noSpendDays,
  parseYmd,
  periodLabel,
  shiftPeriod,
  summarize,
  topPlaces,
} from "../../../shared/expenses";
import { CategoryIcon, dayLabel, shortDate, type ExCtx } from "../lib/expensesUi";

const MONTHS_SHOWN = 6;

/** Months side by side, what changed, which days the money went out, and the
 *  places it went to. */
export function ExpensesTrends({ ctx }: { ctx: ExCtx }) {
  const { period, settings, today } = ctx;

  const months = useMemo(() => {
    const out = [];
    for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
      const p = shiftPeriod(period, -i, settings.monthStart);
      out.push(summarize(ctx.expenses, ctx.bills, p, today));
    }
    return out;
  }, [ctx.expenses, ctx.bills, period, settings.monthStart, today]);

  const cur = months[months.length - 1]!;
  const prev = months[months.length - 2]!;
  const logged = months.filter((m) => m.rows.length > 0);
  const avg = logged.length > 1
    ? Math.round(logged.slice(0, -1).reduce((s, m) => s + m.spent, 0) / Math.max(1, logged.length - 1))
    : null;

  if (!ctx.expenses.length) {
    return (
      <div className="blankstate ex__empty">
        <p className="blankstate__title">Trends need a little history</p>
        <p className="blankstate__text">
          Log what you spend for a few weeks and this fills in: months side by side, what changed,
          your no-spend days and where the money goes.
        </p>
      </div>
    );
  }

  return (
    <div className="ex__trends">
      <MonthBars ctx={ctx} months={months} avg={avg} />
      <Changes ctx={ctx} cur={cur} prev={prev} />
      <Heatmap ctx={ctx} />
      <Facts ctx={ctx} />
      <Places ctx={ctx} />
      <p className="ex__hint">
        Showing {periodLabel(period, settings.monthStart)}
        {ctx.isCurrent ? " so far" : ""}. Use the arrows above to look at other months.
      </p>
    </div>
  );
}

function MonthBars({
  ctx,
  months,
  avg,
}: {
  ctx: ExCtx;
  months: ReturnType<typeof summarize>[];
  avg: number | null;
}) {
  const { money, settings } = ctx;
  const budget = settings.budget;
  const max = Math.max(1, ...months.map((m) => Math.max(m.spent, m.projected)), budget ?? 0) * 1.05;
  return (
    <section className="ex__section">
      <div className="ex__chart-head">
        <h3 className="ex__h">Last {months.length} months</h3>
        {avg !== null && (
          <span className="ex__chart-read num">
            Average <strong>{money(avg, { whole: true })}</strong>
          </span>
        )}
      </div>
      <div className="ex__bars" role="list">
        <span className="ex__bars-guides" aria-hidden>
          {budget !== null && (
            <span className="ex__bars-budget" style={{ bottom: `${(budget / max) * 100}%` }} />
          )}
          {avg !== null && <span className="ex__bars-avg" style={{ bottom: `${(avg / max) * 100}%` }} />}
        </span>
        {months.map((m, i) => {
          const last = i === months.length - 1;
          const showProj = last && ctx.isCurrent && m.projected > m.spent;
          return (
            <div
              key={m.period.start}
              role="listitem"
              className={`ex__bar-col${last ? " is-current" : ""}`}
              title={`${periodLabel(m.period, settings.monthStart)}: ${money(m.spent)}${showProj ? `, heading for ${money(m.projected)}` : ""}`}
            >
              <span className="ex__bar-value num">{m.spent ? money(m.spent, { compact: true }) : ""}</span>
              <span className="ex__bar-track">
                {showProj && (
                  <span className="ex__bar-proj" style={{ height: `${(m.projected / max) * 100}%` }} />
                )}
                <span
                  className={`ex__bar-fill${budget !== null && m.spent > budget ? " is-over" : ""}`}
                  style={{ height: `${(Math.max(0, m.spent) / max) * 100}%` }}
                />
              </span>
              <span className="ex__bar-label">{periodLabel(m.period, settings.monthStart, true)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Changes({
  ctx,
  cur,
  prev,
}: {
  ctx: ExCtx;
  cur: ReturnType<typeof summarize>;
  prev: ReturnType<typeof summarize>;
}) {
  const { money } = ctx;
  const ids = new Set([...cur.byCategory.keys(), ...prev.byCategory.keys()]);
  const moves = [...ids]
    .map((id) => {
      const now = cur.byCategory.get(id) ?? 0;
      // A month in progress is compared with the same days of the last one.
      const before = ctx.isCurrent
        ? prev.rows
            .filter((e) => e.categoryId === id && e.date < addDays(prev.period.start, cur.elapsed))
            .reduce((s, e) => s + e.amount, 0)
        : (prev.byCategory.get(id) ?? 0);
      return { id, now, before, diff: now - before };
    })
    .filter((m) => Math.abs(m.diff) >= 100)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 4);
  if (!moves.length) return null;
  return (
    <section className="ex__section">
      <h3 className="ex__h">
        What changed vs {periodLabel(prev.period, ctx.settings.monthStart, true)}
        {ctx.isCurrent ? " at this point" : ""}
      </h3>
      <ul className="ex__changes">
        {moves.map((m) => {
          const c = ctx.catById.get(m.id);
          const up = m.diff > 0;
          return (
            <li key={m.id}>
              <button type="button" onClick={() => ctx.showCategory(m.id)}>
                <CategoryIcon category={c} size={13} />
                <span className="ex__change-name">{c?.name ?? "Uncategorised"}</span>
                <span className={`ex__change-diff num${up ? " is-up" : " is-down"}`}>
                  {up ? <ArrowUpRight size={13} aria-hidden /> : <ArrowDownRight size={13} aria-hidden />}
                  {money(Math.abs(m.diff), { whole: true })}
                </span>
                <span className="ex__muted num">
                  {money(m.before, { whole: true })} → {money(m.now, { whole: true })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** One square per day, darker the more went out (bills left out). */
function Heatmap({ ctx }: { ctx: ExCtx }) {
  const { period, today, money } = ctx;
  const [hover, setHover] = useState<string | null>(null);
  const daily = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of ctx.summary.rows) {
      if (e.recurringId || e.amount <= 0) continue;
      m.set(e.date, (m.get(e.date) ?? 0) + e.amount);
    }
    return m;
  }, [ctx.summary.rows]);
  const values = [...daily.values()].sort((a, b) => a - b);
  // Quartiles, so one huge day doesn't wash out the rest.
  const q = (f: number) => values[Math.min(values.length - 1, Math.floor(values.length * f))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const level = (v: number) => (v <= 0 ? 0 : v <= cuts[0]! ? 1 : v <= cuts[1]! ? 2 : v <= cuts[2]! ? 3 : 4);
  const lead = (parseYmd(period.start).getDay() + 6) % 7; // Monday first
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let i = 0; i < period.days; i++) cells.push(addDays(period.start, i));
  const shown = hover ?? (ctx.isCurrent ? today : null);

  return (
    <section className="ex__section">
      <div className="ex__chart-head">
        <h3 className="ex__h">Day by day</h3>
        <span className="ex__chart-read num">
          {shown ? (
            <>
              {dayLabel(shown, today)}: <strong>{money(daily.get(shown) ?? 0)}</strong>
            </>
          ) : (
            <span className="ex__muted">Bills not included</span>
          )}
        </span>
      </div>
      <div className="ex__heat" onPointerLeave={() => setHover(null)}>
        {WEEKDAY_LETTERS.map((l, i) => (
          <span key={`h${i}`} className="ex__heat-head" aria-hidden>
            {l}
          </span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <span
              key={d}
              className={`ex__heat-cell l${d > today ? "x" : level(daily.get(d) ?? 0)}${d === today ? " is-today" : ""}`}
              title={`${shortDate(d)}: ${money(daily.get(d) ?? 0)}`}
              onPointerEnter={() => setHover(d)}
            >
              {parseYmd(d).getDate()}
            </span>
          ) : (
            <span key={`b${i}`} aria-hidden />
          ),
        )}
      </div>
      <div className="ex__legend ex__legend--heat" aria-hidden>
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`ex__heat-key l${l}`} />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}

function Facts({ ctx }: { ctx: ExCtx }) {
  const { summary: sum, money, period, today } = ctx;
  const days = Math.max(1, ctx.isCurrent ? sum.elapsed : period.days);
  // Facts are about day-to-day spending; bills would drown them out.
  const daily = sum.rows.filter((e) => !e.recurringId);
  const dailySpent = daily.reduce((s, e) => s + e.amount, 0);
  const ns = noSpendDays(sum.rows, period, ctx.isCurrent ? today : addDays(period.end, -1));
  const streak = ctx.isCurrent ? noSpendDays(ctx.expenses, period, today).streak : 0;
  const top = daily.reduce<(typeof sum.rows)[number] | null>(
    (b, e) => (!b || e.amount > b.amount ? e : b),
    null,
  );
  const byWeekday = new Array<number>(7).fill(0);
  for (const e of daily) if (e.amount > 0) byWeekday[(parseYmd(e.date).getDay() + 6) % 7]! += e.amount;
  const peak = byWeekday.indexOf(Math.max(...byWeekday));
  const weekdayNames = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

  return (
    <section className="ex__section">
      <h3 className="ex__h">
        Facts <span className="ex__muted">· bills left out</span>
      </h3>
      <dl className="ex__facts">
        <div>
          <dt>A day, on average</dt>
          <dd className="num">{money(Math.round(dailySpent / days))}</dd>
        </div>
        <div>
          <dt>No-spend days</dt>
          <dd className="num">
            {ns.count}
            {streak > 1 && <small> · {streak} in a row</small>}
          </dd>
        </div>
        {top && (
          <div>
            <dt>Biggest</dt>
            <dd className="num">
              <button type="button" className="ex__link" onClick={() => ctx.edit(top)}>
                {money(top.amount, { whole: true })} {top.note && `· ${top.note}`}
              </button>
            </dd>
          </div>
        )}
        {Math.max(...byWeekday) > 0 && (
          <div>
            <dt>Spend most on</dt>
            <dd>{weekdayNames[peak]}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function Places({ ctx }: { ctx: ExCtx }) {
  const places = topPlaces(
    ctx.summary.rows.filter((e) => !e.recurringId),
    5,
  );
  if (!places.length) return null;
  const max = places[0]!.total;
  return (
    <section className="ex__section">
      <h3 className="ex__h">Top places</h3>
      <ul className="ex__places">
        {places.map((p) => (
          <li key={p.name}>
            <CategoryIcon category={ctx.catById.get(p.categoryId)} size={13} />
            <span className="ex__place-name">
              {p.name}
              {p.count > 1 && <span className="ex__muted"> ×{p.count}</span>}
            </span>
            <span className="ex__place-bar" aria-hidden>
              <span style={{ width: `${(p.total / max) * 100}%` }} />
            </span>
            <span className="num">{ctx.money(p.total, { whole: p.total >= 100000 })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
