import { useEffect, useMemo, useRef, useState } from "react";

import { Copy, Check, Delete } from "lucide-react";

import {
  CALC_HISTORY_MAX,
  decFromString,
  decToString,
  evaluate,
  formatDec,
  plainDec,
  tryEvaluate,
  type CalcHistoryEntry,
} from "../../../shared/calc";
import type { WidgetRow } from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import { UndoToast } from "./UndoToast";
import "../styles/calculator.css";

type Key = { label: string; insert?: string; act?: "clear" | "back" | "equals" | "negate"; kind?: "op" | "fn" | "eq" | "util"; title?: string };

const BASIC: Key[] = [
  { label: "C", act: "clear", kind: "util", title: "Clear (Esc)" },
  { label: "( )", insert: "()", kind: "util", title: "Brackets" },
  { label: "%", insert: "%", kind: "op", title: "Percent: 50 + 10% is 55" },
  { label: "÷", insert: "÷", kind: "op" },
  { label: "7", insert: "7" },
  { label: "8", insert: "8" },
  { label: "9", insert: "9" },
  { label: "×", insert: "×", kind: "op" },
  { label: "4", insert: "4" },
  { label: "5", insert: "5" },
  { label: "6", insert: "6" },
  { label: "−", insert: "−", kind: "op" },
  { label: "1", insert: "1" },
  { label: "2", insert: "2" },
  { label: "3", insert: "3" },
  { label: "+", insert: "+", kind: "op" },
  { label: "±", act: "negate", kind: "util", title: "Change sign" },
  { label: "0", insert: "0" },
  { label: ".", insert: "." },
  { label: "=", act: "equals", kind: "eq", title: "Equals (Enter)" },
];

const SCI: Key[] = [
  { label: "sin", insert: "sin(", kind: "fn" },
  { label: "cos", insert: "cos(", kind: "fn" },
  { label: "tan", insert: "tan(", kind: "fn" },
  { label: "xʸ", insert: "^", kind: "fn", title: "Power" },
  { label: "x²", insert: "^2", kind: "fn", title: "Squared" },
  { label: "ln", insert: "ln(", kind: "fn", title: "Natural log" },
  { label: "log", insert: "log(", kind: "fn", title: "Log base 10" },
  { label: "√", insert: "√(", kind: "fn", title: "Square root" },
  { label: "n!", insert: "!", kind: "fn", title: "Factorial" },
  { label: "π", insert: "π", kind: "fn" },
  { label: "e", insert: "e", kind: "fn" },
  { label: "ans", insert: "ans", kind: "fn", title: "The last answer" },
  { label: "1/x", insert: "^(-1)", kind: "fn", title: "One over" },
  { label: "|x|", insert: "abs(", kind: "fn", title: "Absolute value" },
];

/** Operators continue from the previous answer; anything else starts a new sum. */
const CONTINUES = /^[+\-−*×/÷^%!]/;

export function CalculatorWidget({ widget }: { widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const set = widget.settings;
  const angle = set.calcAngle ?? "deg";
  const places = typeof set.calcPlaces === "number" ? set.calcPlaces : null;
  const group = set.calcGroup ?? true;
  const keypad = set.calcKeypad ?? true;
  const scientific = set.calcScientific ?? false;
  const history = useMemo(() => set.calcHistory ?? [], [set.calcHistory]);
  const ans = history.length ? decFromString(history[history.length - 1]!.value) : null;

  const [expr, setExpr] = useState("");
  /** The input holds the last answer: typing a number replaces it. */
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recall, setRecall] = useState<number | null>(null);
  const [cleared, setCleared] = useState<{ key: number; list: CalcHistoryEntry[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const tape = useRef<HTMLDivElement>(null);

  const preview = useMemo(() => (expr.trim() ? tryEvaluate(expr, { angle, ans }) : null), [expr, angle, ans]);
  const fmt = (v: CalcHistoryEntry["value"]) => formatDec(decFromString(v)!, { places, group });
  /** A plain number needs no "= …" under it. */
  const trivial = /^\s*-?[\d,]*\.?\d*\s*$/.test(expr);

  useEffect(() => {
    tape.current?.scrollTo({ top: tape.current.scrollHeight });
  }, [history.length]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);

  const saveHistory = (list: CalcHistoryEntry[]) =>
    void actions.updateWidgetSettings(widget.id, { calcHistory: list.slice(-CALC_HISTORY_MAX) });

  const focusEnd = (value: string, select = false) => {
    window.requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      if (select) el.select();
      else el.setSelectionRange(value.length, value.length);
    });
  };

  const change = (value: string) => {
    setExpr(value);
    setFresh(false);
    setError(null);
    setRecall(null);
  };

  const equals = () => {
    if (!expr.trim()) return;
    try {
      const r = evaluate(expr, { angle, ans });
      const result = plainDec(r.value);
      // "=" again on a bare number does nothing new
      if (!(fresh || trivial)) {
        saveHistory([...history, { expr: expr.trim(), value: decToString(r.value), exact: r.exact, at: Date.now() }]);
      }
      setExpr(result);
      setFresh(true);
      setError(null);
      setRecall(null);
      focusEnd(result, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Inserts at the caret; after an answer, operators continue from it and anything else replaces it. */
  const insert = (text: string) => {
    const el = input.current;
    let start = el?.selectionStart ?? expr.length;
    let end = el?.selectionEnd ?? expr.length;
    let base = expr;
    if (fresh) {
      if (CONTINUES.test(text)) start = end = base.length;
      else {
        base = "";
        start = end = 0;
      }
    }
    let next: string;
    let caret: number;
    if (text === "()") {
      // wrap a selection, otherwise open or close whichever is needed
      const sel = base.slice(start, end);
      if (sel) {
        next = `${base.slice(0, start)}(${sel})${base.slice(end)}`;
        caret = start + sel.length + 2;
      } else {
        const before = base.slice(0, start);
        const open = (before.match(/\(/g) ?? []).length - (before.match(/\)/g) ?? []).length;
        const ch = open > 0 && /[\d.)!%πe]$/.test(before.trimEnd()) ? ")" : "(";
        next = before + ch + base.slice(end);
        caret = start + 1;
      }
    } else {
      next = base.slice(0, start) + text + base.slice(end);
      caret = start + text.length;
    }
    setExpr(next);
    setFresh(false);
    setError(null);
    window.requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  };

  const press = (k: Key) => {
    if (k.act === "clear") {
      change("");
      focusEnd("");
    } else if (k.act === "equals") equals();
    else if (k.act === "back") {
      const el = input.current;
      const s = el?.selectionStart ?? expr.length;
      const e = el?.selectionEnd ?? expr.length;
      if (fresh) return change("");
      const from = s === e ? Math.max(0, s - 1) : s;
      const next = expr.slice(0, from) + expr.slice(e);
      change(next);
      window.requestAnimationFrame(() => input.current?.setSelectionRange(from, from));
    } else if (k.act === "negate") {
      const t = expr.trim();
      const next = !t ? "-" : /^-?[\d.,]+$/.test(t) ? (t.startsWith("-") ? t.slice(1) : `-${t}`) : t.startsWith("-(") && t.endsWith(")") ? t.slice(2, -1) : `-(${t})`;
      change(next);
      focusEnd(next);
    } else if (k.insert) insert(k.insert);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || (e.key === "=" && !e.shiftKey)) {
      e.preventDefault();
      equals();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      change("");
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && history.length) {
      e.preventDefault();
      const i =
        e.key === "ArrowUp"
          ? recall === null
            ? history.length - 1
            : Math.max(0, recall - 1)
          : recall === null || recall >= history.length - 1
            ? null
            : recall + 1;
      setRecall(i);
      const v = i === null ? "" : history[i]!.expr;
      setExpr(v);
      setFresh(false);
      setError(null);
      focusEnd(v);
      return;
    }
    // after an answer: an operator continues from it, anything else starts over
    if (fresh && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      if (/^[+\-*/^%!x×÷]$/.test(e.key)) {
        e.preventDefault();
        insert(e.key === "x" || e.key === "*" ? "×" : e.key === "/" ? "÷" : e.key);
      }
    }
  };

  const copy = async () => {
    const r = preview ?? (expr.trim() ? null : ans ? { value: ans, exact: true } : null);
    if (!r) return;
    window.mypa.copyText(plainDec(r.value));
    setCopied(true);
  };

  const showPreview = preview && !trivial && !fresh;

  return (
    <div className={`calc${keypad ? "" : " calc--nokeys"}`} onMouseDown={(e) => {
      // clicks on the empty parts of the widget keep the typing focus
      if (e.target === e.currentTarget) e.preventDefault();
    }}>
      <div className="calc__tape-wrap">
      {history.length > 0 && (
        <button
          type="button"
          className="calc__clear-tape"
          onClick={() => {
            setCleared({ key: Date.now(), list: history });
            saveHistory([]);
          }}
        >
          Clear
        </button>
      )}
      <div className="calc__tape" ref={tape} aria-label="Earlier sums">
        {history.length === 0 ? (
          <p className="calc__tape-empty">
            Type a sum or use the keys. Try <code>18% of 64.50</code> or <code>1249.99 × 3</code>.
          </p>
        ) : (
          <>
            {history.map((h, i) => (
              <div key={`${h.at}-${i}`} className="calc__line">
                <button type="button" className="calc__line-expr" title="Use this sum again" onClick={() => {
                  change(h.expr);
                  focusEnd(h.expr);
                }}>
                  {h.expr}
                </button>
                <button type="button" className="calc__line-val" title="Put this answer in the sum" onClick={() => insert(plainDec(decFromString(h.value)!))}>
                  {h.exact ? "=" : "≈"} {fmt(h.value)}
                </button>
              </div>
            ))}
          </>
        )}
      </div>
      </div>

      <div className={`calc__display${error ? " has-error" : ""}`}>
        <input
          ref={input}
          className={`calc__input${fresh ? " is-answer" : ""}`}
          value={expr}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="0"
          spellCheck={false}
          autoComplete="off"
          inputMode="decimal"
          aria-label="Sum"
          aria-invalid={!!error}
          autoFocus
        />
        <div className="calc__sub">
          <span className="calc__preview" aria-live="polite">
            {error ? (
              <span className="calc__error">{error}</span>
            ) : fresh && ans ? (
              // with fixed places the tape is rounded; the sum keeps every digit
              places !== null && formatDec(ans, { group: false }) !== formatDec(ans, { places, group: false }) ? (
                `Shown as ${formatDec(ans, { places, group })}`
              ) : (
                ""
              )
            ) : showPreview ? (
              `${preview.exact ? "=" : "≈"} ${formatDec(preview.value, { places, group })}`
            ) : (
              ""
            )}
          </span>
          <span className="calc__mode">{scientific ? angle.toUpperCase() : ""}</span>
          <button type="button" className="calc__icon" aria-label="Copy the answer" title="Copy the answer" onClick={() => void copy()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button
            type="button"
            className="calc__icon"
            aria-label="Delete"
            title="Delete"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => press({ label: "⌫", act: "back" })}
          >
            <Delete size={14} />
          </button>
        </div>
      </div>

      {keypad && (
        <div className="calc__keys" onMouseDown={(e) => e.preventDefault()}>
          {scientific && (
            <div className="calc__sci">
              <button
                type="button"
                className="calc__key calc__key--util calc__angle"
                title="Angles in degrees or radians"
                onClick={() => void actions.updateWidgetSettings(widget.id, { calcAngle: angle === "deg" ? "rad" : "deg" })}
              >
                {angle === "deg" ? "Deg" : "Rad"}
              </button>
              {SCI.map((k) => (
                <button key={k.label} type="button" className={`calc__key calc__key--${k.kind}`} title={k.title} onClick={() => press(k)}>
                  {k.label}
                </button>
              ))}
            </div>
          )}
          <div className="calc__grid">
            {BASIC.map((k) => (
              <button
                key={k.label}
                type="button"
                className={`calc__key${k.kind ? ` calc__key--${k.kind}` : ""}`}
                title={k.title}
                aria-label={k.title ?? k.label}
                onClick={() => press(k)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {cleared && (
        <UndoToast
          key={cleared.key}
          label="Cleared the tape"
          onUndo={() => {
            saveHistory(cleared.list);
            setCleared(null);
          }}
          onDismiss={() => setCleared(null)}
        />
      )}
    </div>
  );
}

export function CalculatorSettingsForm({ widget }: { widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const s = widget.settings;
  const save = (patch: Partial<WidgetRow["settings"]>) => void actions.updateWidgetSettings(widget.id, patch);
  const places = typeof s.calcPlaces === "number" ? String(s.calcPlaces) : "";
  return (
    <>
      <label className="wsettings__field">
        <span className="wsettings__label">Decimal places</span>
        <select
          className="wsettings__input"
          value={places}
          onChange={(e) => save({ calcPlaces: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">Automatic</option>
          {[0, 1, 2, 3, 4, 6, 8, 10].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <small className="wsettings__hint">Only changes how answers look; sums are always worked out exactly.</small>
      </label>
      <label className="wsettings__toggle">
        <input type="checkbox" checked={s.calcGroup ?? true} onChange={(e) => save({ calcGroup: e.target.checked })} />
        <span>
          Thousands separators
          <small>1,234,567 rather than 1234567.</small>
        </span>
      </label>
      <label className="wsettings__toggle">
        <input type="checkbox" checked={s.calcKeypad ?? true} onChange={(e) => save({ calcKeypad: e.target.checked })} />
        <span>
          Show the keypad
          <small>Turn off to just type sums.</small>
        </span>
      </label>
      <label className="wsettings__toggle">
        <input type="checkbox" checked={s.calcScientific ?? false} onChange={(e) => save({ calcScientific: e.target.checked })} />
        <span>
          Scientific keys
          <small>sin, cos, tan, powers, roots, logs, π and n!.</small>
        </span>
      </label>
      <div className="wsettings__field">
        <span className="wsettings__label">Angles</span>
        <div className="seg">
          {(["deg", "rad"] as const).map((a) => (
            <button
              key={a}
              type="button"
              className={`seg__btn${(s.calcAngle ?? "deg") === a ? " is-active" : ""}`}
              onClick={() => save({ calcAngle: a })}
            >
              {a === "deg" ? "Degrees" : "Radians"}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
