import { useEffect, useMemo, useRef, useState } from "react";

import { AlarmClockOff, Star, Trash2, X } from "lucide-react";

import {
  atTime,
  relativeLabel,
  repeatLabel,
  WEEKDAY_SHORT,
  whenLabel,
  ymdOf,
  type ReminderRepeat,
  type ReminderRow,
  type RepeatUnit,
} from "../../../shared/reminders";
import { useReadyStore } from "../lib/store";

export interface SheetDraft {
  /** Editing this one; otherwise a new reminder from the fields below. */
  reminder?: ReminderRow;
  title?: string;
  dueAt?: number | null;
  repeat?: ReminderRepeat | null;
  /** Called after a new reminder is saved (e.g. to clear the quick-add box). */
  onCreated?: () => void;
}

type Preset = "never" | "hour" | "day" | "weekday" | "week" | "2week" | "month" | "year" | "custom";

const PRESETS: [Preset, string][] = [
  ["never", "Never"],
  ["hour", "Every hour"],
  ["day", "Every day"],
  ["weekday", "Every weekday (Mon–Fri)"],
  ["week", "Every week"],
  ["2week", "Every 2 weeks"],
  ["month", "Every month"],
  ["year", "Every year"],
  ["custom", "Custom…"],
];

const UNITS: [RepeatUnit, string][] = [
  ["hour", "hours"],
  ["day", "days"],
  ["week", "weeks"],
  ["month", "months"],
  ["year", "years"],
];

function presetOf(r: ReminderRepeat | null): Preset {
  if (!r) return "never";
  const days = (r.days ?? []).join(",");
  if (r.unit === "hour" && r.every === 1) return "hour";
  if (r.unit === "day" && r.every === 1) return "day";
  if (r.unit === "week" && r.every === 1 && days === "1,2,3,4,5") return "weekday";
  if (r.unit === "week" && r.every === 1) return "week";
  if (r.unit === "week" && r.every === 2) return "2week";
  if (r.unit === "month" && r.every === 1) return "month";
  if (r.unit === "year" && r.every === 1) return "year";
  return "custom";
}

const pad = (n: number) => String(n).padStart(2, "0");
const hmOf = (ms: number) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

/** The next round hour, for a new reminder with no time yet. */
function nextHour(now: number): number {
  const d = new Date(now);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d.getTime();
}

export function ReminderSheet({
  draft,
  now,
  defaultTime,
  onClose,
  onDelete,
  onSaved,
  onOpenSettings,
}: {
  draft: SheetDraft;
  now: number;
  defaultTime: string;
  onClose: () => void;
  onDelete?: () => void;
  onSaved: (message: string) => void;
  onOpenSettings: () => void;
}) {
  const { actions } = useReadyStore();
  const existing = draft.reminder ?? null;
  const startDue = existing ? existing.dueAt : (draft.dueAt ?? null);
  const startRepeat = existing ? existing.repeat : (draft.repeat ?? null);
  const seed = startDue ?? nextHour(now);

  const [title, setTitle] = useState(existing?.title ?? draft.title ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [hasDate, setHasDate] = useState(startDue !== null || !existing);
  const [date, setDate] = useState(ymdOf(seed));
  const [time, setTime] = useState(hmOf(seed));
  const [preset, setPreset] = useState<Preset>(presetOf(startRepeat));
  const [every, setEvery] = useState(startRepeat?.every ?? 1);
  const [unit, setUnit] = useState<RepeatUnit>(startRepeat?.unit ?? "day");
  const [days, setDays] = useState<number[]>(startRepeat?.days ?? []);
  const [until, setUntil] = useState<string>(startRepeat?.until ?? "");
  const [important, setImportant] = useState(existing?.important ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const dueAt = hasDate && /^\d{4}-\d{2}-\d{2}$/.test(date) ? atTime(date, time || defaultTime) : null;
  const weekday = dueAt !== null ? new Date(dueAt).getDay() : new Date(now).getDay();
  const weekly = preset === "week" || preset === "2week" || (preset === "custom" && unit === "week");

  const repeat: ReminderRepeat | null = useMemo(() => {
    if (!hasDate || preset === "never") return null;
    const base: Record<Exclude<Preset, "never" | "custom">, ReminderRepeat> = {
      hour: { unit: "hour", every: 1 },
      day: { unit: "day", every: 1 },
      weekday: { unit: "week", every: 1, days: [1, 2, 3, 4, 5] },
      week: { unit: "week", every: 1 },
      "2week": { unit: "week", every: 2 },
      month: { unit: "month", every: 1 },
      year: { unit: "year", every: 1 },
    };
    const r: ReminderRepeat =
      preset === "custom" ? { unit, every: Math.max(1, Math.min(999, every || 1)) } : { ...base[preset] };
    if (r.unit === "week" && preset !== "weekday") r.days = days.length ? [...days].sort() : [weekday];
    if (until) r.until = until;
    return r;
  }, [hasDate, preset, unit, every, days, weekday, until]);

  const setQuick = (ms: number) => {
    setHasDate(true);
    setDate(ymdOf(ms));
    setTime(hmOf(ms));
  };
  const at = (addDays: number, hm = defaultTime) => {
    const d = new Date(now);
    d.setDate(d.getDate() + addDays);
    return atTime(ymdOf(d.getTime()), hm);
  };
  const wd = new Date(now).getDay();
  const quick: [string, number][] = [
    ["In 1 hour", nextHour(now)],
    ["This evening", at(0, "18:00")],
    ["Tomorrow", at(1)],
    ["Next week", at(((8 - wd) % 7) || 7)],
  ];

  const save = async () => {
    const t = title.trim();
    if (!t) {
      setError("Give the reminder a name.");
      titleRef.current?.focus();
      return;
    }
    if (repeat?.until && dueAt !== null && atTime(repeat.until, "23:59") < dueAt) {
      setError("The repeat ends before the first reminder.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        const timingChanged =
          dueAt !== existing.dueAt || JSON.stringify(repeat) !== JSON.stringify(existing.repeat);
        await actions.updateReminder(existing.id, {
          title: t,
          notes,
          important,
          ...(timingChanged ? { dueAt, repeat } : {}),
        });
        onSaved("Saved");
      } else {
        await actions.createReminder({ title: t, notes, dueAt, repeat, important });
        draft.onCreated?.();
        onSaved(dueAt !== null ? `Reminder set for ${whenLabel(dueAt, Date.now())}` : "Reminder added");
      }
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e),
      );
      setBusy(false);
    }
  };

  const past = dueAt !== null && dueAt <= Date.now() && !repeat;

  return (
    <div
      className="rem__sheet-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="rem__sheet"
        aria-label={existing ? "Edit reminder" : "New reminder"}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="rem__sheet-head">
          <span>{existing ? "Edit reminder" : "New reminder"}</span>
          <button type="button" className="rem__icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <label className="rem__field">
          <span>Remind me to</span>
          <input
            ref={titleRef}
            className="field"
            value={title}
            maxLength={300}
            placeholder="Call the dentist"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="rem__field">
          <span>Notes</span>
          <textarea
            className="field rem__notes"
            value={notes}
            rows={2}
            maxLength={4000}
            placeholder="Anything that helps when it pops up"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <div className="rem__field">
          <label className="rem__switch">
            <input type="checkbox" checked={hasDate} onChange={(e) => setHasDate(e.target.checked)} />
            <span>Remind me at a time</span>
          </label>
          {hasDate ? (
            <>
              <div className="rem__quick">
                {quick.map(([label, ms]) => (
                  <button
                    key={label}
                    type="button"
                    className={dueAt === ms ? "is-on" : ""}
                    onClick={() => setQuick(ms)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="rem__row">
                <input
                  type="date"
                  className="field"
                  aria-label="Date"
                  value={date}
                  required
                  onChange={(e) => setDate(e.target.value)}
                />
                <input
                  type="time"
                  className="field"
                  aria-label="Time"
                  value={time}
                  required
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              {dueAt !== null && (
                <p className={`rem__sheet-note${past ? " is-warn" : ""}`}>
                  {past
                    ? "That time has passed, so it will alert right away."
                    : `${whenLabel(dueAt, now)} · ${relativeLabel(dueAt, now)}`}
                </p>
              )}
            </>
          ) : (
            <p className="rem__sheet-note">
              Without a time it stays on your list under “No date” and never pops up.
            </p>
          )}
        </div>

        {hasDate && (
          <div className="rem__field">
            <span>Repeat</span>
            <select className="field" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              {PRESETS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {preset === "custom" && (
              <div className="rem__row rem__every">
                <span>Every</span>
                <input
                  type="number"
                  className="field num"
                  min={1}
                  max={999}
                  aria-label="Repeat every"
                  value={every}
                  onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))}
                />
                <select
                  className="field"
                  aria-label="Repeat unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as RepeatUnit)}
                >
                  {UNITS.map(([u, label]) => (
                    <option key={u} value={u}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {weekly && (
              <div className="rem__days" role="group" aria-label="On these days">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const on = (days.length ? days : [weekday]).includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      className={on ? "is-on" : ""}
                      onClick={() => {
                        const cur = days.length ? days : [weekday];
                        const next = on ? cur.filter((x) => x !== d) : [...cur, d];
                        setDays(next.length ? next : cur);
                      }}
                    >
                      {WEEKDAY_SHORT[d]!.slice(0, 2)}
                    </button>
                  );
                })}
              </div>
            )}
            {preset !== "never" && (
              <div className="rem__row rem__until">
                <span>Ends</span>
                <select
                  className="field"
                  aria-label="Ends"
                  value={until ? "date" : "never"}
                  onChange={(e) => setUntil(e.target.value === "date" ? ymdOf(at(30)) : "")}
                >
                  <option value="never">Never</option>
                  <option value="date">On a date</option>
                </select>
                {until && (
                  <input
                    type="date"
                    className="field"
                    aria-label="Last day"
                    value={until}
                    min={date}
                    onChange={(e) => setUntil(e.target.value)}
                  />
                )}
              </div>
            )}
            {repeat && (preset === "custom" || weekly || repeat.until) && (
              <p className="rem__sheet-note">{repeatLabel(repeat)}</p>
            )}
          </div>
        )}

        <label className="rem__switch">
          <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} />
          <span>
            <Star size={12} aria-hidden /> Important
          </span>
        </label>

        {existing?.snoozedUntil != null && existing.doneAt === null && (
          <div className="rem__snoozed">
            <span>Snoozed until {whenLabel(existing.snoozedUntil, now)}</span>
            <button
              type="button"
              onClick={() => {
                void actions.snoozeReminder(existing.id, null);
                onSaved("Snooze cancelled");
                onClose();
              }}
            >
              <AlarmClockOff size={12} aria-hidden />
              Cancel snooze
            </button>
          </div>
        )}

        {error && (
          <p className="rem__hint is-error" role="alert">
            {error}
          </p>
        )}

        <div className="rem__sheet-foot">
          {onDelete ? (
            <button type="button" className="rem__text-btn is-danger" onClick={onDelete}>
              <Trash2 size={13} aria-hidden />
              Delete
            </button>
          ) : (
            <button type="button" className="rem__text-btn" onClick={onOpenSettings}>
              Settings
            </button>
          )}
          <span className="rem__grow" />
          <button type="button" className="rem__btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="rem__btn is-primary" disabled={busy}>
            {existing ? "Save" : "Add reminder"}
          </button>
        </div>
      </form>
    </div>
  );
}
