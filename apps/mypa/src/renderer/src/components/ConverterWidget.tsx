import { useEffect, useMemo, useRef, useState } from "react";

import { ArrowUpDown, Check, Copy } from "lucide-react";

import { CalcError, evaluate, formatDec, type Dec } from "../../../shared/calc";
import type { WidgetRow } from "../../../shared/types";
import {
  CATEGORIES,
  convert,
  formatAmount,
  parseQuery,
  rateLine,
  unitById,
  unitsIn,
  type ConverterPair,
  type UnitCategory,
  type UnitDef,
} from "../../../shared/units";
import { useReadyStore } from "../lib/store";
import "../styles/converter.css";

const RECENT_MAX = 6;

/** A number or a sum ("3/4", "2*12"); null when it isn't one yet. */
function readNumber(text: string): Dec | null {
  const t = text.trim().replace(/−/g, "-");
  if (!t) return null;
  try {
    return evaluate(t).value;
  } catch {
    return null;
  }
}

function pickUnits(cat: UnitCategory, from?: string, to?: string): [UnitDef, UnitDef] {
  const c = CATEGORIES.find((x) => x.id === cat) ?? CATEGORIES[0]!;
  const ok = (id?: string) => {
    const unit = id ? unitById(id) : null;
    return unit && unit.category === c.id ? unit : null;
  };
  return [ok(from) ?? unitById(c.common[0])!, ok(to) ?? unitById(c.common[1])!];
}

export function ConverterWidget({ widget }: { widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const set = widget.settings;
  const cat: UnitCategory = CATEGORIES.some((c) => c.id === set.convCategory) ? set.convCategory! : "length";
  const [from, to] = pickUnits(cat, set.convFrom, set.convTo);
  const places = typeof set.convPlaces === "number" ? set.convPlaces : null;
  const recent = set.convRecent ?? [];

  const [top, setTop] = useState(set.convAmount ?? "1");
  /** The bottom box while it's being typed in; null = it shows the answer. */
  const [bottom, setBottom] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef(0);

  const save = (patch: Partial<WidgetRow["settings"]>) => void actions.updateWidgetSettings(widget.id, patch);

  // keep what's typed, without a write per keystroke
  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (top !== (set.convAmount ?? "1")) save({ convAmount: top });
    }, 600);
    return () => window.clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);

  const fmt = (d: Dec) => formatAmount(d, { places });

  /** Typed text with units in it ("72°F to C"): what it would do, before it's applied. */
  const phrase = /[a-zµ°'"′″]/i.test(top) ? parseQuery(top) : null;
  /** The phrase asks for different units than the widget is on (Enter switches). */
  const pending = !!phrase && (phrase.from.id !== from.id || (phrase.to !== null && phrase.to.id !== to.id));

  const amount = phrase ? phrase.value : readNumber(top);
  let answer: { value: Dec; exact: boolean } | null = null;
  let error: string | null = null;
  if (bottom === null && amount) {
    try {
      answer = phrase ? convert(phrase.value, phrase.from, phrase.to ?? (phrase.from.category === to.category ? to : phrase.from)) : convert(amount, from, to);
    } catch (e) {
      error = e instanceof CalcError ? e.message : String(e);
    }
  } else if (top.trim() && !amount && bottom === null) {
    error = /[a-z]/i.test(top) ? "Try “72°F to C”, “5 ft 11 in to cm” or “3/4 cup in ml”." : "Type a number.";
  }

  // the bottom box being typed in converts the other way
  let reverse: { value: Dec; exact: boolean } | null = null;
  if (bottom !== null) {
    const b = readNumber(bottom);
    if (b) {
      try {
        reverse = convert(b, to, from);
      } catch (e) {
        error = e instanceof CalcError ? e.message : String(e);
      }
    } else if (bottom.trim()) error = "Type a number.";
  }

  const pushRecent = (pair: ConverterPair) => {
    const list = [pair, ...recent.filter((r) => !(r.from === pair.from && r.to === pair.to))].slice(0, RECENT_MAX);
    return list;
  };

  const setUnits = (nextCat: UnitCategory, f: string, t: string, amountText?: string) => {
    const [uf, ut] = pickUnits(nextCat, f, t);
    const pair = { category: nextCat, from: uf.id, to: ut.id };
    save({
      convCategory: nextCat,
      convFrom: uf.id,
      convTo: ut.id,
      convRecent: uf.id === ut.id ? recent : pushRecent(pair),
      ...(amountText !== undefined ? { convAmount: amountText } : {}),
    });
    if (amountText !== undefined) setTop(amountText);
    setBottom(null);
  };

  /** "72°F to C" + Enter: switch to those units and keep just the number. */
  const applyPhrase = () => {
    if (!phrase || !pending) return;
    const target = phrase.to ?? (phrase.from.category === to.category && phrase.from.id !== to.id ? to : null);
    const [, fallback] = pickUnits(phrase.from.category);
    const t = target ?? (fallback.id === phrase.from.id ? pickUnits(phrase.from.category)[0] : fallback);
    // "5 ft 11 in" stays as typed (it's worked out as 71 in); a plain amount keeps just the number
    const keep = /[a-z'"′″]/i.test(phrase.amount) ? phrase.amount : formatDec(phrase.value, { group: false, sig: 15 });
    setUnits(phrase.from.category, phrase.from.id, t.id, keep);
  };

  const commitBottom = () => {
    if (bottom === null) return;
    if (reverse) setTop(formatDec(reverse.value, { group: false, sig: 15 }));
    setBottom(null);
  };

  const shownFrom = phrase?.from ?? from;
  const shownTo = phrase ? (phrase.to ?? (phrase.from.category === to.category ? to : phrase.from)) : to;
  const value = bottom === null ? answer : reverse;

  const others = useMemo(() => {
    if (!amount || pending || bottom !== null) return [];
    return unitsIn(cat)
      .filter((u) => u.id !== from.id)
      .map((u) => {
        try {
          return { u, r: convert(amount, from, u) };
        } catch {
          return null;
        }
      })
      .filter((x): x is { u: UnitDef; r: { value: Dec; exact: boolean } } => x !== null);
  }, [amount, pending, bottom, cat, from]);

  const copy = () => {
    if (!answer) return;
    window.mypa.copyText(formatDec(answer.value, { group: false, sig: 12, places }));
    setCopied(true);
  };

  const rate = rateLine(shownFrom, shownTo);

  return (
    <div className="cv">
      <div className="cv__body">
        <div className="cv__top">
          <select
            className="cv__cat"
            value={cat}
            aria-label="What to convert"
            onChange={(e) => {
              const c = e.target.value as UnitCategory;
              setUnits(c, "", "");
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {recent.length > 0 && (
            <div className="cv__recent" aria-label="Recent conversions">
              {recent.map((r) => {
                const a = unitById(r.from);
                const b = unitById(r.to);
                if (!a || !b) return null;
                const on = r.from === from.id && r.to === to.id;
                return (
                  <button
                    key={`${r.from}>${r.to}`}
                    type="button"
                    className={`cv__chip${on ? " is-on" : ""}`}
                    onClick={() => setUnits(r.category, r.from, r.to)}
                  >
                    {a.symbol} → {b.symbol}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className={`cv__pair${error ? " has-error" : ""}`}>
          <div className="cv__row">
            <input
              className="cv__input"
              value={bottom !== null && reverse ? formatDec(reverse.value, { group: false, sig: 12 }) : top}
              onChange={(e) => {
                setTop(e.target.value);
                setBottom(null);
              }}
              onFocus={() => commitBottom()}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyPhrase();
              }}
              onBlur={() => applyPhrase()}
              placeholder="Amount, or “72°F to C”"
              aria-label={`Amount in ${from.name.toLowerCase()}`}
              spellCheck={false}
              autoComplete="off"
            />
            <UnitSelect cat={cat} value={from.id} onChange={(id) => setUnits(cat, id, id === to.id ? from.id : to.id)} label="From" />
          </div>

          <div className="cv__mid">
            <button
              type="button"
              className="cv__swap"
              onClick={() => setUnits(cat, to.id, from.id)}
              aria-label="Swap the units"
              title="Swap"
            >
              <ArrowUpDown size={15} />
            </button>
            <span className="cv__rate">{pending && phrase ? `${phrase.amount} ${phrase.from.symbol} → ${shownTo.symbol} · press Enter to switch` : rate}</span>
          </div>

          <div className="cv__row">
            <input
              className="cv__input cv__input--answer"
              value={bottom ?? (value ? fmt(value.value) : "")}
              onChange={(e) => setBottom(e.target.value)}
              onBlur={commitBottom}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitBottom();
              }}
              placeholder="—"
              aria-label={`Amount in ${to.name.toLowerCase()}`}
              spellCheck={false}
              autoComplete="off"
            />
            <UnitSelect cat={cat} value={to.id} onChange={(id) => setUnits(cat, id === from.id ? to.id : from.id, id)} label="To" />
          </div>

          <div className="cv__foot">
            {error ? (
              <span className="cv__error" role="alert">
                {error}
              </span>
            ) : value ? (
              <span className="cv__exact">{value.exact ? "Exact" : "Rounded to 12 significant digits"}</span>
            ) : (
              <span />
            )}
            <button type="button" className="cv__icon" onClick={copy} disabled={!answer} aria-label="Copy the answer" title="Copy the answer">
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        </div>

        {others.length > 0 && (
          <section className="cv__all">
            <h4>{/[a-z'"′″]/i.test(top) ? top.trim() : `${top.trim()} ${from.symbol}`} in other units</h4>
            <ul>
              {others.map(({ u, r }) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={`cv__other${u.id === to.id ? " is-on" : ""}`}
                    onClick={() => setUnits(cat, from.id, u.id)}
                  >
                    <span className="cv__other-name">{u.name}</span>
                    <span className="cv__other-val">
                      {r.exact ? "" : "≈ "}
                      {fmt(r.value)} <span className="cv__sym">{u.symbol}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function UnitSelect({ cat, value, onChange, label }: { cat: UnitCategory; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <select className="cv__unit" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {unitsIn(cat).map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} ({u.symbol})
        </option>
      ))}
    </select>
  );
}

export function ConverterSettingsForm({ widget }: { widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const s = widget.settings;
  const places = typeof s.convPlaces === "number" ? String(s.convPlaces) : "";
  return (
    <>
      <label className="wsettings__field">
        <span className="wsettings__label">Decimal places</span>
        <select
          className="wsettings__input"
          value={places}
          onChange={(e) =>
            void actions.updateWidgetSettings(widget.id, { convPlaces: e.target.value === "" ? null : Number(e.target.value) })
          }
        >
          <option value="">Automatic</option>
          {[0, 1, 2, 3, 4, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <small className="wsettings__hint">Conversions are always worked out exactly; this only changes how answers look.</small>
      </label>
      {(s.convRecent?.length ?? 0) > 0 && (
        <button type="button" className="wsettings__link" onClick={() => void actions.updateWidgetSettings(widget.id, { convRecent: [] })}>
          Clear recent conversions
        </button>
      )}
      <small className="wsettings__hint">
        Units use their official definitions (1 in = 2.54 cm, 1 lb = 453.59237 g, 1 US gallon = 231 in³). Cups, pints and
        gallons are US measures unless you pick the imperial ones. Currencies aren't included: they change daily and need the
        internet.
      </small>
    </>
  );
}
