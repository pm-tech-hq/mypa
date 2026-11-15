import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Bell, CalendarDays, CircleAlert, CornerDownLeft, ListTodo, StickyNote, Wallet } from "lucide-react";

import {
  CAPTURE_KINDS,
  describePlan,
  detectKind,
  KIND_LABEL,
  planCapture,
  type CaptureKind,
} from "../../../shared/capture";
import { moneyFor } from "../lib/expensesUi";
import { useReadyStore } from "../lib/store";

export const KIND_ICON: Record<CaptureKind, typeof ListTodo> = {
  task: ListTodo,
  reminder: Bell,
  event: CalendarDays,
  expense: Wallet,
  note: StickyNote,
};

export function captureError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "");
}

function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Shared text → plan helpers (for the composer and the inbox). */
export function useCaptureTools() {
  const { snapshot } = useReadyStore();
  const expense = useMemo(
    () => ({ categories: snapshot.expenseCategories, history: snapshot.expenses.slice(0, 500) }),
    [snapshot.expenseCategories, snapshot.expenses],
  );
  const money = useMemo(() => moneyFor(snapshot.meta.expenses.currency), [snapshot.meta.expenses.currency]);
  const describeOpts = useMemo(
    () => ({
      taskSection: snapshot.meta.capture.taskSection,
      money: (c: number) => money(c),
      category: (id: string) => snapshot.expenseCategories.find((c) => c.id === id)?.name ?? "Other",
    }),
    [snapshot.meta.capture.taskSection, money, snapshot.expenseCategories],
  );
  return { expense, money, describeOpts };
}

export interface Saved {
  id: string | null;
  kind: CaptureKind;
  text: string;
  summary: string;
}

/**
 * One box for anything: Enter saves (Shift+Enter for a new line), the chips
 * show what it will become and let you change it (Alt+1…5, Alt+0 for auto).
 */
export function CaptureComposer({
  onSaved,
  onEscape,
  focusKey,
  footer,
  placeholder = "Capture a task, reminder, expense or idea…",
}: {
  onSaved: (s: Saved) => void;
  /** Esc on an empty box. */
  onEscape?: () => void;
  /** Changing it focuses the box (the pop-up bumps it each time it opens). */
  focusKey?: number;
  footer?: ReactNode;
  placeholder?: string;
}) {
  const { actions } = useReadyStore();
  const { expense, describeOpts } = useCaptureTools();
  const [text, setText] = useState("");
  const [forced, setForced] = useState<CaptureKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusKey === undefined) return;
    ref.current?.focus();
    ref.current?.select();
  }, [focusKey]);

  // grow with the text, up to a point
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
    el.style.overflowY = el.scrollHeight > 168 ? "auto" : "hidden";
  }, [text]);

  const detected = useMemo(() => (text.trim() ? detectKind(text, expense) : null), [text, expense]);
  const kind = forced ?? detected?.kind ?? null;
  const plan = useMemo(() => {
    if (!kind || !text.trim()) return null;
    const now = Date.now();
    return planCapture(text, kind, { now, expense: { ...expense, today: ymd(now) } });
  }, [text, kind, expense]);

  const save = async () => {
    if (busy || !kind || !plan) return;
    if ("error" in plan) {
      setError(plan.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const summary = describePlan(plan, Date.now(), describeOpts);
      const id = await actions.saveCapture(text, kind);
      onSaved({ id, kind, text: text.trim(), summary });
      setText("");
      setForced(null);
    } catch (e) {
      setError(captureError(e));
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };

  const pick = (k: CaptureKind | null) => {
    setForced(k);
    setError(null);
    ref.current?.focus();
  };

  const planErr = plan && "error" in plan ? plan.error : null;
  const shownError = error ?? (forced && planErr ? planErr : null);

  return (
    <div className="capc">
      <div className={`capc__box${shownError ? " is-error" : ""}`}>
        <textarea
          ref={ref}
          className="capc__input"
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label="Capture"
          spellCheck
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
            if (!e.target.value.trim()) setForced(null);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (text) {
                setText("");
                setForced(null);
                setError(null);
              } else onEscape?.();
            } else if (e.altKey && /^[0-5]$/.test(e.key)) {
              e.preventDefault();
              const n = Number(e.key);
              pick(n === 0 ? null : CAPTURE_KINDS[n - 1]!);
            }
          }}
        />
        <button
          type="button"
          className="capc__save"
          disabled={!text.trim() || busy}
          onClick={() => void save()}
          aria-label="Save"
          title="Save (Enter)"
        >
          <CornerDownLeft size={15} />
        </button>
      </div>

      <div className="capc__kinds" role="radiogroup" aria-label="Save as">
        {CAPTURE_KINDS.map((k, i) => {
          const Icon = KIND_ICON[k];
          const on = kind === k;
          const auto = on && !forced;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              className={`capc__kind${on ? " is-on" : ""}${auto ? " is-auto" : ""}`}
              title={`${KIND_LABEL[k]} (Alt+${i + 1})${forced === k ? " · click again for auto" : ""}`}
              onClick={() => pick(forced === k ? null : k)}
            >
              <Icon size={13} />
              <span>{KIND_LABEL[k]}</span>
            </button>
          );
        })}
      </div>

      <div className={`capc__preview${shownError ? " is-error" : ""}`} aria-live="polite">
        {shownError ? (
          <>
            <CircleAlert size={13} />
            <span>{shownError}</span>
          </>
        ) : plan && !("error" in plan) ? (
          <span>
            {describePlan(plan, Date.now(), describeOpts)}
            {!forced && detected && <span className="capc__why"> · {detected.why}</span>}
          </span>
        ) : planErr ? (
          <span className="capc__why">{KIND_LABEL[kind!]}: {planErr}</span>
        ) : (
          footer ?? <span className="capc__why">Enter saves · Shift+Enter for a new line</span>
        )}
      </div>
    </div>
  );
}
