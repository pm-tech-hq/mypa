import { useEffect, useMemo, useState } from "react";

import {
  Bell,
  BookHeart,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCheck,
  Circle,
  FolderKanban,
  GraduationCap,
  Inbox,
  Loader2,
  Receipt,
  ShoppingCart,
  Sparkles,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  buildBriefing,
  hashFacts,
  type BriefAction,
  type BriefItem,
  type BriefKind,
} from "../../../shared/briefing";
import { atTime, clock, dayStartMs, shiftDay } from "../../../shared/planner";
import type { WidgetKind, WidgetRow } from "../../../shared/types";
import { revealWidget } from "../lib/revealWidget";
import { useReadyStore } from "../lib/store";
import { captureError } from "./CaptureComposer";
import { UndoToast } from "./UndoToast";
import "../styles/briefing.css";

const ICON: Record<BriefKind, LucideIcon> = {
  event: CalendarDays,
  allday: Sun,
  study: BookOpen,
  reminder: Bell,
  task: Circle,
  project: FolderKanban,
  exam: GraduationCap,
  bill: Receipt,
  inbox: Inbox,
  plan: CalendarClock,
  journal: BookHeart,
  shopping: ShoppingCart,
  recap: CheckCheck,
};

const OPEN_LABEL: Partial<Record<WidgetKind, string>> = {
  planner: "Plan my day",
  study: "Open",
  projects: "Open",
  expenses: "Open",
  capture: "Sort",
  journal: "Write",
  shopping: "Open",
};

type Saved = { key: number; label: string; undo: () => void };

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function BriefingWidget({ widget: _widget, onOpenSettings }: { widget: WidgetRow; onOpenSettings: () => void }) {
  const { snapshot, actions } = useReadyStore();
  const now = useNow();
  const settings = snapshot.meta.briefing.settings;
  const b = useMemo(() => buildBriefing(snapshot, now, { settings }), [snapshot, now, settings]);
  const note = snapshot.meta.briefing.note?.day === b.day ? snapshot.meta.briefing.note : null;
  const stale = note ? note.hash !== hashFacts(b.facts) : false;
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  /** Items acted on: hidden at once, before the snapshot catches up. */
  const [gone, setGone] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(null), 6000);
    return () => window.clearTimeout(t);
  }, [saved]);
  useEffect(() => setGone(new Set()), [snapshot]);

  const write = async () => {
    setWriting(true);
    setError(null);
    try {
      await actions.writeBriefing();
    } catch (e) {
      setError(captureError(e));
    } finally {
      setWriting(false);
    }
  };

  const tasksById = new Map(snapshot.tasks.map((t) => [t.id, t]));
  const remindersById = new Map(snapshot.reminders.map((r) => [r.id, r]));
  const endOfToday = dayStartMs(shiftDay(b.day, 1)) - 60_000;

  const act = async (item: BriefItem, a: BriefAction) => {
    try {
      switch (a.kind) {
        case "task-done": {
          setGone(new Set(gone).add(item.key));
          await actions.updateTask(a.id, { done: true });
          setSaved({ key: Date.now(), label: `Done: ${item.text}`, undo: () => void actions.updateTask(a.id, { done: false }) });
          break;
        }
        case "task-today": {
          const t = tasksById.get(a.id);
          if (!t) return;
          await actions.updateTask(a.id, { section: "today", due: endOfToday });
          setSaved({
            key: Date.now(),
            label: `Moved to today: ${item.text}`,
            undo: () => void actions.updateTask(a.id, { section: t.section, due: t.due }),
          });
          break;
        }
        case "reminder-done": {
          setGone(new Set(gone).add(item.key));
          await actions.completeReminder(a.id, true);
          setSaved({ key: Date.now(), label: `Done: ${item.text}`, undo: () => void actions.completeReminder(a.id, false) });
          break;
        }
        case "reminder-snooze": {
          const r = remindersById.get(a.id);
          setGone(new Set(gone).add(item.key));
          await actions.snoozeReminder(a.id, Date.now() + 3_600_000);
          setSaved({
            key: Date.now(),
            label: `Snoozed for an hour: ${item.text}`,
            undo: () => void actions.snoozeReminder(a.id, r?.snoozedUntil ?? null),
          });
          break;
        }
        case "join":
          void window.mypa.market.openExternal(a.url);
          break;
        case "open":
          await revealWidget(a.widget, snapshot, actions.setCurrentPage);
          break;
      }
    } catch (e) {
      setError(captureError(e));
    }
  };

  const label = (a: BriefAction) =>
    a.kind === "task-done" || a.kind === "reminder-done"
      ? "Done"
      : a.kind === "task-today"
        ? "Do today"
        : a.kind === "reminder-snooze"
          ? "Snooze 1h"
          : a.kind === "join"
            ? "Join"
            : (OPEN_LABEL[a.widget] ?? "Open");

  const date = new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="br">
      <div className="br__body">
        <header className="br__head">
          <div className="br__titles">
            <p className="br__date">{date}</p>
            <h3 className="br__greet">{b.greeting}</h3>
          </div>
          {!note && (
            <button
              type="button"
              className="br__btn"
              disabled={writing}
              onClick={() => void write()}
              title="Have the Assistant's model write this up from the list below"
            >
              {writing ? <Loader2 size={14} className="br__spin" /> : <Sparkles size={14} />} Write it up
            </button>
          )}
        </header>

        <p className="br__headline">{b.headline}</p>

        {note && (
          <div className={`br__note${stale ? " is-stale" : ""}`}>
            <p className="br__note-text">{note.text}</p>
            <div className="br__note-foot">
              <span>
                {stale
                  ? "Your day has changed since this was written."
                  : `Written by ${note.model} from the list below, at ${clock(note.at)}.`}
              </span>
              <span className="br__grow" />
              <button type="button" className="br__link" disabled={writing} onClick={() => void write()}>
                {writing ? "Writing…" : stale ? "Rewrite" : "Write again"}
              </button>
              <button
                type="button"
                className="br__icon"
                aria-label="Hide the written version"
                onClick={() => void actions.clearBriefing()}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}
        {writing && !note && <p className="br__muted">Writing it up from your day… this can take a minute on the built-in model.</p>}
        {error && (
          <p className="br__error" role="alert">
            {error}
          </p>
        )}

        {b.sections.length === 0 ? (
          <div className="blankstate br__empty">
            <p className="blankstate__title">A clear day</p>
            <p className="blankstate__text">
              Nothing on your calendar, no tasks due and nothing waiting. Add tasks, events or reminders and they'll show here.
            </p>
          </div>
        ) : (
          b.sections.map((s) => {
            const items = s.items.filter((i) => !gone.has(i.key));
            if (items.length === 0) return null;
            return (
              <section key={s.id} className={`br__section is-${s.id}`}>
                <h4>{s.title}</h4>
                <ul>
                  {items.map((i) => {
                    const Icon = ICON[i.kind];
                    return (
                      <li key={i.key} className={`br__item${i.tone ? ` is-${i.tone}` : ""}`}>
                        <span className="br__time">
                          {i.at !== null && (s.id === "today" || i.kind === "event") ? clock(i.at) : ""}
                        </span>
                        <Icon size={14} className="br__kind" aria-hidden />
                        <span className="br__text">
                          <span className="br__title">{i.text}</span>
                          {i.detail && <span className="br__detail">{i.detail}</span>}
                        </span>
                        {i.actions.map((a) => (
                          <button
                            key={a.kind}
                            type="button"
                            className={`br__act${a.kind === "task-done" || a.kind === "reminder-done" ? " is-done" : ""}`}
                            onClick={() => void act(i, a)}
                          >
                            {(a.kind === "task-done" || a.kind === "reminder-done") && <Check size={12} />}
                            {label(a)}
                          </button>
                        ))}
                      </li>
                    );
                  })}
                </ul>
                {s.more > 0 && <p className="br__more">and {s.more} more</p>}
              </section>
            );
          })
        )}

        <button type="button" className="br__link br__morning" onClick={onOpenSettings}>
          <Bell size={12} />
          {settings.morning
            ? `Morning briefing at ${clock(atTime(b.day, settings.morningAt))}`
            : "Morning briefing is off"}
        </button>
      </div>

      {saved && (
        <UndoToast
          key={saved.key}
          label={saved.label}
          onUndo={() => {
            saved.undo();
            setSaved(null);
          }}
          onDismiss={() => setSaved(null)}
        />
      )}
    </div>
  );
}

export function BriefingSettingsForm() {
  const { snapshot, actions } = useReadyStore();
  const s = snapshot.meta.briefing.settings;
  return (
    <>
      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={s.morning}
          onChange={(e) => void actions.setBriefingSettings({ morning: e.target.checked })}
        />
        <span>
          Morning briefing
          <small>A desktop notification with the day's summary; click it to open the briefing.</small>
        </span>
      </label>
      {s.morning && (
        <label className="wsettings__field">
          <span className="wsettings__label">Send it at</span>
          <input
            type="time"
            className="wsettings__input"
            value={s.morningAt}
            onChange={(e) => e.target.value && void actions.setBriefingSettings({ morningAt: e.target.value })}
          />
        </label>
      )}
      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={s.yesterday}
          onChange={(e) => void actions.setBriefingSettings({ yesterday: e.target.checked })}
        />
        <span>
          Show yesterday
          <small>What you finished and studied the day before.</small>
        </span>
      </label>
      <small className="wsettings__hint">
        The briefing is made from your own data only. “Write it up” uses the Assistant's model, and a write-up that mentions a
        time that isn't in your day is thrown away.
      </small>
    </>
  );
}
