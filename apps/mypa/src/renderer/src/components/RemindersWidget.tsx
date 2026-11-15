import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AlarmClock,
  AlarmClockOff,
  BellOff,
  BellRing,
  Check,
  CircleAlert,
  CornerDownLeft,
  MoreHorizontal,
  Pencil,
  Repeat,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";

import type { WidgetRow } from "../../../shared/types";
import {
  advance,
  alertAt,
  clockLabel,
  DEFAULT_REMINDERS_SETTINGS,
  GROUP_LABEL,
  groupOf,
  parseReminder,
  relativeLabel,
  repeatLabel,
  sortOpen,
  whenLabel,
  type ParsedReminder,
  type ReminderGroup,
  type ReminderRow,
} from "../../../shared/reminders";
import type { SystemState } from "../../../shared/system";
import { useReminderFocus } from "../lib/reminderFocus";
import { useReadyStore } from "../lib/store";
import { useUndo } from "../lib/useUndo";
import { ReminderSheet, type SheetDraft } from "./ReminderSheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { UndoToast } from "./UndoToast";
import "../styles/reminders.css";

const GROUPS: ReminderGroup[] = ["overdue", "today", "tomorrow", "week", "later", "nodate"];
const EXAMPLES = [
  "Call mom tomorrow at 5pm",
  "Check the oven in 20 min",
  "Pay rent every month on the 1st",
  "Standup every weekday at 9am",
  "Water the plants every 3 days",
  "Dentist on Dec 12 at 3:30pm",
];

/** The clock, ticking often enough for "in 5 min" and due alerts to stay right. */
function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** Snooze choices relative to now. */
function snoozeOptions(now: number, defaultTime: string): { label: string; at: number }[] {
  const at = (days: number, h: number, m = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const [dh, dm] = defaultTime.split(":").map(Number) as [number, number];
  const out = [
    { label: "10 minutes", at: now + 10 * 60_000 },
    { label: "30 minutes", at: now + 30 * 60_000 },
    { label: "1 hour", at: now + 60 * 60_000 },
    { label: "3 hours", at: now + 3 * 60 * 60_000 },
  ];
  if (new Date(now).getHours() < 17) out.push({ label: "This evening", at: at(0, 18) });
  out.push({ label: "Tomorrow morning", at: at(1, dh || 9, dm || 0) });
  const wd = new Date(now).getDay();
  out.push({ label: "Next week", at: at(((8 - wd) % 7) || 7, dh || 9, dm || 0) });
  return out;
}

export function RemindersWidget({
  widget,
  onOpenSettings,
}: {
  widget: WidgetRow;
  onOpenSettings: () => void;
}) {
  const { snapshot, actions } = useReadyStore();
  const now = useNow();
  const undo = useUndo(widget.id);
  const tab = widget.settings.remTab ?? DEFAULT_REMINDERS_SETTINGS.remTab;
  const defaultTime = widget.settings.remDefaultTime ?? DEFAULT_REMINDERS_SETTINGS.remDefaultTime;
  const quickSnooze = widget.settings.remSnooze ?? DEFAULT_REMINDERS_SETTINGS.remSnooze;
  const setTab = (t: "upcoming" | "done") => void actions.updateWidgetSettings(widget.id, { remTab: t });

  const [editing, setEditing] = useState<SheetDraft | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [system, setSystem] = useState<SystemState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.mypa.system.getState().then(setSystem);
    return window.mypa.system.onStateChanged(setSystem);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const all = useMemo(
    () => snapshot.reminders.filter((r) => !undo.hidden.has(r.id)),
    [snapshot.reminders, undo.hidden],
  );
  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (r: ReminderRow) => !q || r.title.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q),
    [q],
  );
  const open = useMemo(() => sortOpen(all.filter((r) => r.doneAt === null && matches(r))), [all, matches]);
  const done = useMemo(
    () => all.filter((r) => r.doneAt !== null && matches(r)).sort((a, b) => b.doneAt! - a.doneAt!),
    [all, matches],
  );
  const grouped = useMemo(() => {
    const m = new Map<ReminderGroup, ReminderRow[]>();
    for (const r of open) {
      const at = alertAt(r);
      const g = at !== null && r.firedAt === at ? "overdue" : groupOf(r, now);
      m.set(g, [...(m.get(g) ?? []), r]);
    }
    return m;
  }, [open, now]);
  const overdueCount = grouped.get("overdue")?.length ?? 0;

  // A clicked notification: show that reminder.
  const reveal = useCallback(
    (id: string) => {
      const r = snapshot.reminders.find((x) => x.id === id);
      if (!r) return;
      if (r.doneAt !== null) void actions.updateWidgetSettings(widget.id, { remTab: "done" });
      else if (tab !== "upcoming") void actions.updateWidgetSettings(widget.id, { remTab: "upcoming" });
      setQuery("");
      setSearching(false);
      setFocusId(id);
      window.setTimeout(() => {
        listRef.current
          ?.querySelector(`[data-reminder="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 60);
      window.setTimeout(() => setFocusId((f) => (f === id ? null : f)), 2600);
    },
    [snapshot.reminders, actions, widget.id, tab],
  );
  useReminderFocus(reveal);

  const tick = (r: ReminderRow) => {
    const finishing = r.doneAt === null;
    void actions.completeReminder(r.id, finishing);
    if (!finishing) return setFlash(`Back on your list: ${r.title}`);
    const next = r.repeat ? advance(r, Date.now()) : null;
    setFlash(next !== null ? `Done. Next “${r.title}”: ${whenLabel(next, Date.now())}` : `Done: ${r.title}`);
  };

  const remove = (r: ReminderRow) => {
    setEditing(null);
    undo.schedule(r.id, `Deleted “${r.title}”`, () => void actions.deleteReminders([r.id]));
  };

  // "Clear all" hides every done reminder under one Undo.
  const [cleared, setCleared] = useState<Map<string, string[]>>(() => new Map());
  const clearDone = () => {
    const ids = all.filter((r) => r.doneAt !== null).map((r) => r.id);
    if (!ids.length) return;
    const key = `rem-clear-${Date.now()}`;
    setCleared((m) => new Map(m).set(key, ids));
    undo.schedule(key, `Cleared ${ids.length} done reminder${ids.length === 1 ? "" : "s"}`, () =>
      void actions.deleteReminders(ids),
    );
  };
  const hiddenByClear = useMemo(() => {
    const out = new Set<string>();
    for (const [key, ids] of cleared) if (undo.hidden.has(key)) ids.forEach((i) => out.add(i));
    return out;
  }, [cleared, undo.hidden]);

  const doneVisible = done.filter((r) => !hiddenByClear.has(r.id));
  const notificationsOff = system && (!system.notificationsSupported || !system.prefs.notifications);
  const trayOff = system && !system.prefs.closeToTray;
  const hasTimed = open.some((r) => r.dueAt !== null);

  return (
    <div className="rem">
      <QuickAdd
        now={now}
        defaultTime={defaultTime}
        onMore={(draft) => setEditing(draft)}
        onAdded={(p) => {
          setFlash(p.dueAt !== null ? `Reminder set for ${whenLabel(p.dueAt, Date.now())}` : `Added “${p.title}” with no date`);
          if (tab !== "upcoming") setTab("upcoming");
        }}
      />

      {hasTimed && notificationsOff && (
        <div className="rem__notice" role="status">
          <BellOff size={14} aria-hidden />
          <span>Desktop alerts are off, so reminders won't pop up.</span>
          {system?.notificationsSupported && (
            <button type="button" onClick={() => void window.mypa.system.setPrefs({ notifications: true })}>
              Turn on
            </button>
          )}
        </div>
      )}
      {hasTimed && !notificationsOff && trayOff && (
        <div className="rem__notice" role="status">
          <CircleAlert size={14} aria-hidden />
          <span>Reminders only alert while myPA is open. Keep it running in the tray when you close it?</span>
          <button type="button" onClick={() => void window.mypa.system.setPrefs({ closeToTray: true })}>
            Keep running
          </button>
        </div>
      )}

      <div className="rem__bar">
        <div className="seg" role="tablist" aria-label="Reminders">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "upcoming"}
            className={`seg__btn${tab === "upcoming" ? " is-active" : ""}`}
            onClick={() => setTab("upcoming")}
          >
            Upcoming
            {open.length > 0 && <span className={`rem__count${overdueCount ? " is-late" : ""}`}>{open.length}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "done"}
            className={`seg__btn${tab === "done" ? " is-active" : ""}`}
            onClick={() => setTab("done")}
          >
            Done
          </button>
        </div>
        <div className="rem__bar-actions">
          {searching ? (
            <label className="rem__search">
              <Search size={13} aria-hidden />
              <input
                autoFocus
                value={query}
                placeholder="Search"
                aria-label="Search reminders"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQuery("");
                    setSearching(false);
                  }
                }}
              />
              <button
                type="button"
                className="rem__icon-btn"
                aria-label="Close search"
                onClick={() => {
                  setQuery("");
                  setSearching(false);
                }}
              >
                <X size={13} />
              </button>
            </label>
          ) : (
            <button
              type="button"
              className="rem__icon-btn"
              aria-label="Search reminders"
              title="Search"
              onClick={() => setSearching(true)}
            >
              <Search size={14} />
            </button>
          )}
          {tab === "done" && doneVisible.length > 0 && !searching && (
            <button type="button" className="rem__text-btn" onClick={clearDone}>
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className="rem__body" ref={listRef}>
        {tab === "upcoming" ? (
          open.length === 0 ? (
            q ? (
              <p className="rem__none">No reminders match “{query.trim()}”.</p>
            ) : (
              <div className="blankstate">
                <span className="blankstate__icon">
                  <BellRing size={17} />
                </span>
                <p className="blankstate__title">Nothing to remind you of</p>
                <p className="blankstate__text">
                  Type above in plain words, like “{EXAMPLES[0]}” or “{EXAMPLES[2]}”.
                </p>
              </div>
            )
          ) : (
            GROUPS.filter((g) => grouped.get(g)?.length).map((g) => (
              <section key={g} className={`rem__group rem__group--${g}`} aria-label={GROUP_LABEL[g]}>
                <h3 className="rem__group-head">
                  {g === "overdue" &&
                  grouped.get(g)!.every((r) => Date.now() - (alertAt(r) ?? 0) < 10 * 60_000)
                    ? "Due now"
                    : GROUP_LABEL[g]}
                  <span className="num">{grouped.get(g)!.length}</span>
                </h3>
                <ul className="rem__list">
                  {grouped.get(g)!.map((r) => (
                    <ReminderItem
                      key={r.id}
                      r={r}
                      now={now}
                      focused={focusId === r.id}
                      defaultTime={defaultTime}
                      quickSnooze={quickSnooze}
                      onTick={() => tick(r)}
                      onEdit={() => setEditing({ reminder: r })}
                      onDelete={() => remove(r)}
                      onSnooze={(at) => {
                        void actions.snoozeReminder(r.id, at);
                        setFlash(at === null ? "Snooze cancelled" : `Snoozed until ${whenLabel(at, Date.now())}`);
                      }}
                      onImportant={() => void actions.updateReminder(r.id, { important: !r.important })}
                    />
                  ))}
                </ul>
              </section>
            ))
          )
        ) : doneVisible.length === 0 ? (
          q ? (
            <p className="rem__none">No done reminders match “{query.trim()}”.</p>
          ) : (
            <div className="blankstate">
              <span className="blankstate__icon">
                <Check size={17} />
              </span>
              <p className="blankstate__title">Nothing done yet</p>
              <p className="blankstate__text">Reminders you tick off land here, in case you need one back.</p>
            </div>
          )
        ) : (
          <ul className="rem__list rem__list--done">
            {doneVisible.map((r) => (
              <ReminderItem
                key={r.id}
                r={r}
                now={now}
                focused={focusId === r.id}
                defaultTime={defaultTime}
                quickSnooze={quickSnooze}
                onTick={() => tick(r)}
                onEdit={() => setEditing({ reminder: r })}
                onDelete={() => remove(r)}
                onSnooze={() => undefined}
                onImportant={() => void actions.updateReminder(r.id, { important: !r.important })}
              />
            ))}
          </ul>
        )}
      </div>

      {flash && !undo.latest && (
        <div className="rem__flash" role="status">
          {flash}
        </div>
      )}

      {editing && (
        <ReminderSheet
          draft={editing}
          now={now}
          defaultTime={defaultTime}
          onClose={() => setEditing(null)}
          onDelete={editing.reminder ? () => remove(editing.reminder!) : undefined}
          onSaved={(msg) => setFlash(msg)}
          onOpenSettings={onOpenSettings}
        />
      )}

      {undo.latest && (
        <UndoToast
          key={undo.latest.id}
          label={undo.latest.label}
          onUndo={() => undo.undo(undo.latest!.id)}
          onDismiss={() => undo.finish(undo.latest!.id)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- quick add -- */

function QuickAdd({
  now,
  defaultTime,
  onMore,
  onAdded,
}: {
  now: number;
  defaultTime: string;
  onMore: (draft: SheetDraft) => void;
  onAdded: (p: ParsedReminder) => void;
}) {
  const { actions } = useReadyStore();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [example, setExample] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (text) return;
    const t = window.setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 5000);
    return () => window.clearInterval(t);
  }, [text]);

  const parsed = useMemo(() => (text.trim() ? parseReminder(text, now, defaultTime) : null), [text, now, defaultTime]);
  const ready = !!parsed?.title;

  const submit = async () => {
    if (!parsed) return;
    if (!parsed.title) {
      setError("What should I remind you about?");
      return;
    }
    setError(null);
    try {
      await actions.createReminder({ title: parsed.title, dueAt: parsed.dueAt, repeat: parsed.repeat });
      setText("");
      onAdded(parsed);
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
    }
  };

  return (
    <div className="rem__add">
      <div className="addrow">
        <label className="addrow__field">
          <BellRing size={14} className="addrow__plus" aria-hidden />
          <input
            ref={inputRef}
            value={text}
            placeholder={`Remind me… e.g. “${EXAMPLES[example]}”`}
            aria-label="New reminder"
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              } else if (e.key === "Escape") setText("");
            }}
          />
          {ready && (
            <button
              type="button"
              className="addrow__submit"
              aria-label="Add reminder"
              title="Add (Enter)"
              onClick={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <CornerDownLeft size={11} aria-hidden />
            </button>
          )}
        </label>
        <button
          type="button"
          className="rem__icon-btn rem__more"
          aria-label="Add with all options"
          title="More options"
          onClick={() =>
            onMore({
              title: parsed?.title ?? text.trim(),
              dueAt: parsed?.dueAt ?? null,
              repeat: parsed?.repeat ?? null,
              onCreated: () => setText(""),
            })
          }
        >
          <SlidersHorizontal size={14} />
        </button>
      </div>
      {error ? (
        <p className="rem__hint is-error" role="alert">
          {error}
        </p>
      ) : parsed ? (
        <p className="rem__hint" aria-live="polite">
          {parsed.dueAt !== null ? (
            <>
              <span className="rem__chip">
                <AlarmClock size={12} aria-hidden />
                {whenLabel(parsed.dueAt, now)}
              </span>
              {parsed.repeat && (
                <span className="rem__chip">
                  <Repeat size={12} aria-hidden />
                  {repeatLabel(parsed.repeat)}
                </span>
              )}
              <span className="rem__hint-rel">{relativeLabel(parsed.dueAt, now)}</span>
            </>
          ) : (
            <span className="rem__hint-none">No time yet. Add one like “at 5pm”, “tomorrow” or “in 1 hour”, or keep it undated.</span>
          )}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- item -- */

function ReminderItem({
  r,
  now,
  focused,
  defaultTime,
  quickSnooze,
  onTick,
  onEdit,
  onDelete,
  onSnooze,
  onImportant,
}: {
  r: ReminderRow;
  now: number;
  focused: boolean;
  defaultTime: string;
  quickSnooze: number;
  onTick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSnooze: (at: number | null) => void;
  onImportant: () => void;
}) {
  const done = r.doneAt !== null;
  const at = alertAt(r);
  // "Ringing" comes from the alert itself (main fired it), so it shows at once.
  const ringing = !done && at !== null && r.firedAt === at;
  const due = ringing || (!done && at !== null && at <= now);
  const note = r.notes.split("\n").find((l) => l.trim())?.trim();

  return (
    <li
      data-reminder={r.id}
      className={`rem-item${done ? " is-done" : ""}${due ? " is-due" : ""}${ringing ? " is-ringing" : ""}${focused ? " is-focused" : ""}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark “${r.title}” not done` : `Mark “${r.title}” done`}
        className="rem-item__check"
        onClick={onTick}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>

      <button type="button" className="rem-item__main" onClick={onEdit} aria-label={`Edit “${r.title}”`}>
        <span className="rem-item__title">
          {r.important && <Star size={12} className="rem-item__star" aria-label="Important" />}
          {r.title}
        </span>
        <span className="rem-item__meta">
          {done ? (
            <span>Done {whenLabel(r.doneAt!, now)}</span>
          ) : at !== null ? (
            <>
              <span className={`rem-item__when${due ? " is-late" : ""}`}>
                {ringing ? <BellRing size={11} aria-hidden /> : <AlarmClock size={11} aria-hidden />}
                {r.snoozedUntil !== null
                  ? `${due ? "Snooze ended" : "Snoozed until"} ${clockLabelOrWhen(r.snoozedUntil, now)}`
                  : whenLabel(at, now)}
              </span>
              <span className="rem-item__rel">{due ? lateLabel(at, now) : relativeLabel(at, now)}</span>
            </>
          ) : (
            <span className="rem-item__when">No date</span>
          )}
          {r.repeat && (
            <span className="rem-item__repeat" title={repeatLabel(r.repeat)}>
              <Repeat size={11} aria-hidden />
              {repeatLabel(r.repeat)}
            </span>
          )}
        </span>
        {note && <span className="rem-item__note">{note}</span>}
      </button>

      {due && (
        <span className="rem-item__now">
          <button type="button" onClick={() => onSnooze(Date.now() + quickSnooze * 60_000)} title={`Remind me again in ${quickSnooze} minutes`}>
            <AlarmClock size={12} aria-hidden />
            {quickSnooze} min
          </button>
          <button type="button" className="is-primary" onClick={onTick}>
            <Check size={12} aria-hidden />
            Done
          </button>
        </span>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="rem__icon-btn rem-item__more" aria-label={`More for “${r.title}”`}>
            <MoreHorizontal size={15} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="task-menu">
          {!done && (due || r.snoozedUntil !== null) && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <AlarmClock />
                Snooze
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {snoozeOptions(Date.now(), defaultTime).map((o) => (
                  <DropdownMenuItem key={o.label} onSelect={() => onSnooze(o.at)}>
                    {o.label}
                    <span className="rem-menu__hint">{whenLabel(o.at, Date.now())}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {!done && r.snoozedUntil !== null && (
            <DropdownMenuItem onSelect={() => onSnooze(null)}>
              <AlarmClockOff />
              Cancel snooze
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onImportant}>
            <Star />
            {r.important ? "Not important" : "Mark important"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            Edit…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete} variant="destructive">
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function lateLabel(at: number, now: number): string {
  const rel = relativeLabel(at, Math.max(now, Date.now()));
  return rel === "just now" || rel === "now" ? "due just now" : `${rel.replace(" ago", "")} overdue`;
}

function clockLabelOrWhen(ms: number, now: number): string {
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  return sameDay ? clockLabel(ms) : whenLabel(ms, now);
}
