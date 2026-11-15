import { useEffect, useMemo, useRef, useState } from "react";

import { Flag, MoreHorizontal, Pause, Pencil, Play, Plus, RotateCcw, Square, Timer as TimerIcon, Trash2 } from "lucide-react";

import { clock } from "../../../shared/planner";
import {
  durationLabel,
  elapsed,
  endsAt,
  formatClock,
  formatStopwatch,
  lapRows,
  parseDuration,
  parseTimerInput,
  remaining,
  sortTimers,
  statusOf,
  TIMER_PRESETS,
  type TimerAction,
  type TimerRow,
} from "../../../shared/timers";
import type { WidgetRow } from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import { useTicker } from "../lib/ticker";
import { captureError } from "./CaptureComposer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { UndoToast } from "./UndoToast";
import "../styles/timer.css";

type Saved = { key: number; label: string; undo: () => void };

function useSaved() {
  const [saved, setSaved] = useState<Saved | null>(null);
  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(null), 6000);
    return () => window.clearTimeout(t);
  }, [saved]);
  const toast = saved && (
    <UndoToast
      key={saved.key}
      label={saved.label}
      onUndo={() => {
        saved.undo();
        setSaved(null);
      }}
      onDismiss={() => setSaved(null)}
    />
  );
  return { show: (label: string, undo: () => void) => setSaved({ key: Date.now(), label, undo }), toast };
}

export function TimerWidget({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const tab = widget.settings.timerTab ?? "timers";
  const running = snapshot.timers.filter((t) => t.kind === "timer" && statusOf(t, Date.now()) === "running").length;
  return (
    <div className="tm">
      <div className="tm__tabs">
        <div className="seg" role="tablist">
          {(["timers", "stopwatch"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`seg__btn${tab === t ? " is-active" : ""}`}
              onClick={() => void actions.updateWidgetSettings(widget.id, { timerTab: t })}
            >
              {t === "timers" ? "Timers" : "Stopwatch"}
              {t === "timers" && running > 0 && <span className="tm__badge">{running}</span>}
            </button>
          ))}
        </div>
      </div>
      {tab === "timers" ? <TimersView /> : <StopwatchView widget={widget} />}
    </div>
  );
}

/* ---------------------------------------------------------------- timers -- */

function TimersView() {
  const { snapshot, actions } = useReadyStore();
  const timers = snapshot.timers.filter((t) => t.kind === "timer");
  const anyLive = timers.some((t) => t.startedAt !== null);
  const now = useTicker(anyLive ? "fast" : null);
  const list = useMemo(() => sortTimers(timers, now), [timers, now]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { show, toast } = useSaved();
  const parsed = text.trim() ? parseTimerInput(text) : null;

  const start = async (ms: number, label = "") => {
    setError(null);
    try {
      await actions.createTimer({ kind: "timer", durationMs: ms, label, start: true });
    } catch (e) {
      setError(captureError(e));
    }
  };

  const submit = async () => {
    if (!text.trim()) return;
    if (!parsed) {
      setError("Try 10m, 1h 30m, 5:00 or “25m focus”.");
      return;
    }
    setText("");
    await start(parsed.ms, parsed.label);
  };

  const act = (t: TimerRow, a: TimerAction) => void actions.timerAction(t.id, a).catch((e) => setError(captureError(e)));

  const remove = (t: TimerRow) => {
    const before = t;
    void actions.deleteTimer(t.id);
    show(`Deleted ${t.label ? `“${t.label}”` : `the ${durationLabel(t.durationMs)} timer`}`, () => void actions.putTimer(before));
  };

  return (
    <div className="tm__body">
      <form
        className="tm__add"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Plus size={15} className="tm__add-icon" aria-hidden />
        <input
          className="tm__add-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder="New timer: 10m, 1:30, “25m focus”"
          aria-label="New timer"
          spellCheck={false}
        />
        {parsed && (
          <button type="submit" className="tm__add-go">
            Start {durationLabel(parsed.ms)}
          </button>
        )}
      </form>
      {error && (
        <p className="tm__error" role="alert">
          {error}
        </p>
      )}
      <div className="tm__presets" aria-label="Quick timers">
        {TIMER_PRESETS.map((m) => (
          <button key={m} type="button" className="tm__chip" onClick={() => void start(m * 60_000)}>
            {m >= 60 ? `${m / 60}h` : `${m}m`}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="blankstate tm__empty">
          <TimerIcon size={22} className="blankstate__icon" aria-hidden />
          <p className="blankstate__title">No timers</p>
          <p className="blankstate__text">Pick a length above or type one. It rings even when this page isn't showing.</p>
        </div>
      ) : (
        <ul className="tm__list">
          {list.map((t) => (
            <TimerCard key={t.id} t={t} now={now} act={act} remove={remove} />
          ))}
        </ul>
      )}
      {toast}
    </div>
  );
}

function TimerCard({
  t,
  now,
  act,
  remove,
}: {
  t: TimerRow;
  now: number;
  act: (t: TimerRow, a: TimerAction) => void;
  remove: (t: TimerRow) => void;
}) {
  const { actions } = useReadyStore();
  const status = statusOf(t, now);
  const left = remaining(t, now);
  const progress = Math.min(1, Math.max(0, elapsed(t, now) / t.durationMs));
  const end = endsAt(t);
  const [editing, setEditing] = useState<"label" | "length" | null>(null);
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);

  const commit = () => {
    if (editing === "label") void actions.updateTimer(t.id, { label: draft });
    if (editing === "length") {
      const ms = parseDuration(draft);
      if (ms === null) {
        setBad(true);
        return;
      }
      void actions.updateTimer(t.id, { durationMs: ms });
    }
    setEditing(null);
    setBad(false);
  };

  const editor = (
    <input
      ref={field}
      className={`tm__edit${editing === "length" ? " tm__edit--time" : ""}${bad ? " is-bad" : ""}`}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        setBad(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(null);
      }}
      onBlur={commit}
      aria-label={editing === "label" ? "Timer name" : "Timer length"}
      placeholder={editing === "label" ? "Name" : "e.g. 10m"}
      autoFocus
    />
  );

  const statusText =
    status === "done"
      ? `Ended at ${clock(end ?? t.firedAt ?? now)}`
      : status === "running"
        ? `Ends at ${clock(end!)}`
        : status === "paused"
          ? `Paused · ${durationLabel(t.durationMs)}`
          : `${durationLabel(t.durationMs)} · ready`;

  return (
    <li className={`tm__card is-${status}`}>
      <div className="tm__card-main">
        <div className="tm__card-text">
          {editing === "label" ? (
            editor
          ) : (
            <button
              type="button"
              className="tm__label"
              onClick={() => {
                setDraft(t.label);
                setEditing("label");
              }}
              title="Rename"
            >
              {t.label || (status === "done" ? "Time's up" : "Timer")}
            </button>
          )}
          {editing === "length" ? (
            editor
          ) : (
            <button
              type="button"
              className="tm__time"
              disabled={status === "running" || status === "done"}
              title={status === "running" || status === "done" ? undefined : "Change the length"}
              onClick={() => {
                setDraft(formatClock(t.durationMs));
                setEditing("length");
              }}
              aria-live={status === "done" ? "assertive" : "off"}
            >
              {status === "done" ? formatClock(left) : formatClock(left, { ceil: true })}
            </button>
          )}
          <span className="tm__status">{statusText}</span>
        </div>
        <div className="tm__controls">
          {status === "done" ? (
            <>
              <button type="button" className="tm__btn" onClick={() => act(t, { kind: "add", ms: 60_000 })}>
                +1 min
              </button>
              <button type="button" className="tm__btn" onClick={() => act(t, { kind: "start" })} title="Start it again">
                <RotateCcw size={14} /> Again
              </button>
              <button type="button" className="tm__round is-stop" onClick={() => act(t, { kind: "reset" })} aria-label="Stop">
                <Square size={14} />
              </button>
            </>
          ) : (
            <>
              {status !== "idle" && (
                <button
                  type="button"
                  className="tm__icon"
                  onClick={() => act(t, { kind: "reset" })}
                  aria-label="Reset"
                  title="Reset"
                >
                  <RotateCcw size={14} />
                </button>
              )}
              <button type="button" className="tm__btn" onClick={() => act(t, { kind: "add", ms: 60_000 })} title="Add a minute">
                +1 min
              </button>
              <button
                type="button"
                className={`tm__round${status === "running" ? " is-running" : ""}`}
                onClick={() => act(t, { kind: status === "running" ? "pause" : "start" })}
                aria-label={status === "running" ? "Pause" : "Start"}
              >
                {status === "running" ? <Pause size={16} /> : <Play size={16} />}
              </button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="tm__icon" aria-label="Timer options">
                <MoreHorizontal size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setDraft(t.label);
                  setEditing("label");
                }}
              >
                <Pencil size={14} /> Rename
              </DropdownMenuItem>
              {status !== "running" && status !== "done" && (
                <DropdownMenuItem
                  onSelect={() => {
                    setDraft(formatClock(t.durationMs));
                    setEditing("length");
                  }}
                >
                  <TimerIcon size={14} /> Change length
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="tm__danger" onSelect={() => remove(t)}>
                <Trash2 size={14} /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="tm__bar" aria-hidden>
        <span style={{ transform: `scaleX(${status === "done" ? 1 : progress})` }} />
      </div>
    </li>
  );
}

/* ------------------------------------------------------------- stopwatch -- */

function StopwatchView({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const sw = snapshot.timers.find((t) => t.id === widget.settings.stopwatchId && t.kind === "stopwatch") ?? null;
  const live = sw?.startedAt != null;
  const now = useTicker(live ? "frame" : null);
  const total = sw ? elapsed(sw, now) : 0;
  const rows = useMemo(() => lapRows(sw?.laps ?? []), [sw?.laps]);
  const lastLap = sw?.laps.at(-1) ?? 0;
  const { show, toast } = useSaved();
  const busy = useRef(false);

  const act = async (a: TimerAction) => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!sw) {
        if (a.kind !== "start") return;
        const id = await actions.createTimer({ kind: "stopwatch", start: true });
        await actions.updateWidgetSettings(widget.id, { stopwatchId: id });
        return;
      }
      if (a.kind === "reset" && (total > 0 || sw.laps.length)) {
        const before = sw;
        await actions.timerAction(sw.id, a);
        show(`Reset the stopwatch (${formatStopwatch(total)})`, () => void actions.putTimer(before));
        return;
      }
      await actions.timerAction(sw.id, a);
    } finally {
      busy.current = false;
    }
  };

  const toggle = () => void act({ kind: live ? "pause" : "start" });
  const second = () => void act({ kind: live ? "lap" : "reset" });

  return (
    <div
      className="tm__body tm__sw"
      tabIndex={-1}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        if (e.key === " ") {
          e.preventDefault();
          toggle();
        } else if (e.key.toLowerCase() === "l" && live) void act({ kind: "lap" });
        else if (e.key.toLowerCase() === "r" && !live) void act({ kind: "reset" });
      }}
    >
      <div className="tm__sw-face">
        <span className={`tm__sw-time${live ? " is-live" : ""}`} aria-live="off">
          {formatStopwatch(total)}
        </span>
        <span className="tm__sw-lap">
          {sw && sw.laps.length > 0 ? `Lap ${sw.laps.length + 1} · ${formatStopwatch(total - lastLap)}` : " "}
        </span>
      </div>
      <div className="tm__sw-buttons">
        <button type="button" className="tm__sw-btn" onClick={second} disabled={!sw || (!live && total === 0)}>
          {live ? (
            <>
              <Flag size={15} /> Lap
            </>
          ) : (
            <>
              <RotateCcw size={15} /> Reset
            </>
          )}
        </button>
        <button type="button" className={`tm__sw-btn is-main${live ? " is-running" : ""}`} onClick={toggle}>
          {live ? (
            <>
              <Pause size={15} /> Pause
            </>
          ) : (
            <>
              <Play size={15} /> {total > 0 ? "Resume" : "Start"}
            </>
          )}
        </button>
      </div>
      <p className="tm__keys">Space starts and pauses · L laps · R resets</p>
      {rows.length > 0 && (
        <table className="tm__laps">
          <thead>
            <tr>
              <th>Lap</th>
              <th>Time</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n} className={r.best ? "is-best" : r.worst ? "is-worst" : ""}>
                <td>
                  {r.n}
                  {r.best && <span className="tm__tag">Fastest</span>}
                  {r.worst && <span className="tm__tag">Slowest</span>}
                </td>
                <td>{formatStopwatch(r.lap)}</td>
                <td>{formatStopwatch(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {toast}
    </div>
  );
}

export function TimerSettingsForm() {
  const { snapshot, actions } = useReadyStore();
  return (
    <>
      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={snapshot.meta.timers.sound}
          onChange={(e) => void actions.setTimerSettings({ sound: e.target.checked })}
        />
        <span>
          Play a sound when a timer ends
          <small>A soft chime in the app, as well as the desktop notification.</small>
        </span>
      </label>
      <small className="wsettings__hint">
        Timers keep time from the clock, so they stay right while the app is busy, minimised or asleep, and through a
        restart. If one ends while your computer is off, it shows as ended without a late notification.
      </small>
    </>
  );
}
