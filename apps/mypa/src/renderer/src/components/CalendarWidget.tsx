import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronDown,
  FileUp,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";

import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarAccountRow,
  type CalendarRsvp,
  type CalendarSettings,
  type WidgetRow,
} from "../../../shared/types";
import {
  accountColor,
  dayKey,
  formatDayHeading,
  formatEventTime,
  formatEventWhen,
  formatRelative,
  groupByDay,
  isOngoing,
  LOCAL_COLOR,
  meetingName,
  mergeEvents,
  type AgendaItem,
} from "../lib/calendar";
import { useReadyStore } from "../lib/store";
import { errorText } from "../lib/tutor";
import { useUndo } from "../lib/useUndo";
import "../styles/calendar.css";
import { AddEventDialog, type EventDraft, type EventTarget } from "./AddEventDialog";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { UndoToast } from "./UndoToast";

const TICK_MS = 30_000;
/** How soon a meeting with a link gets the "Up next" card with Join. */
const SOON_MS = 15 * 60_000;

const ANSWERS: [CalendarRsvp, string][] = [
  ["accepted", "Yes"],
  ["tentative", "Maybe"],
  ["declined", "No"],
];

const openLink = (url: string) => void window.mypa.market.openExternal(url);

export function CalendarWidget({
  widget,
  onOpenSettings,
}: {
  widget: WidgetRow;
  onOpenSettings: () => void;
}) {
  const { snapshot, actions } = useReadyStore();
  const settings: CalendarSettings = { ...DEFAULT_CALENDAR_SETTINGS, ...widget.settings };
  const accounts = snapshot.calendarAccounts;

  const [view, setView] = useState<"agenda" | "month">(settings.view);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [dialog, setDialog] = useState<{ date: Date; event: AgendaItem | null } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const undo = useUndo(widget.id);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // A reminder was clicked: show that event.
  useEffect(
    () =>
      window.mypa.db.onCalendarFocus((id) => {
        setView("agenda");
        setOpenId(id);
        requestAnimationFrame(() =>
          scrollRef.current
            ?.querySelector(`[data-event="${CSS.escape(id)}"]`)
            ?.scrollIntoView({ block: "nearest" }),
        );
      }),
    [],
  );

  const show =
    settings.show === "all" ||
    settings.show === "local" ||
    accounts.some((a) => a.id === settings.show)
      ? settings.show
      : "all";

  const items = useMemo(
    () =>
      mergeEvents(snapshot.calendarEvents, snapshot.calendarRemoteEvents, accounts).filter(
        (i) =>
          !undo.hidden.has(i.id) &&
          (show === "all" || (show === "local" ? i.local : i.accountId === show)),
      ),
    [snapshot.calendarEvents, snapshot.calendarRemoteEvents, accounts, undo.hidden, show],
  );

  const upcoming = useMemo(() => {
    const horizon = now + settings.lookAheadDays * 86_400_000;
    return items.filter((i) => i.end >= now && i.start <= horizon);
  }, [items, now, settings.lookAheadDays]);

  const groups = useMemo(() => groupByDay(upcoming), [upcoming]);

  /** The first timed event that hasn't started yet gets the "in 25m" hint. */
  const nextId = useMemo(
    () => upcoming.find((i) => !i.allDay && i.start > now)?.id ?? null,
    [upcoming, now],
  );

  /** A meeting with a link that's on now or starts soon, for the Join card. */
  const upNext = useMemo(
    () =>
      upcoming.find(
        (i) =>
          !i.allDay &&
          i.meetingUrl &&
          i.myStatus !== "declined" &&
          i.start - now <= SOON_MS &&
          i.end > now,
      ) ?? null,
    [upcoming, now],
  );

  const selectedDayItems = useMemo(() => {
    const key = selectedDate.toDateString();
    return items.filter((i) => new Date(i.start).toDateString() === key);
  }, [items, selectedDate]);

  const datesWithEvents = useMemo(() => new Set(items.map((i) => dayKey(i.start))), [items]);

  const troubled = accounts.filter((a) => a.status !== "connected");

  /** Where new events can go: this computer, then every writable connected calendar. */
  const targets = useMemo<EventTarget[]>(() => {
    const out: EventTarget[] = [{ value: "local", label: "This computer only", google: false }];
    for (const a of accounts) {
      if (a.status !== "connected" || !a.canWrite) continue;
      const cals = a.calendars
        .filter((c) => c.writable)
        .sort((x, y) => Number(y.primary) - Number(x.primary));
      for (const c of cals)
        out.push({
          value: `${a.id}\n${c.id}`,
          label: cals.length > 1 ? `${a.label} · ${c.name}` : a.label,
          google: a.provider === "google",
        });
    }
    return out;
  }, [accounts]);

  /** New events go to the account being shown, else the first connected one. */
  const defaultTarget =
    show === "local"
      ? "local"
      : (targets.find((t) => show !== "all" && t.value.startsWith(`${show}\n`)) ?? targets[1])
          ?.value;

  const changeView = (next: "agenda" | "month") => {
    setView(next);
    void actions.updateWidgetSettings(widget.id, { view: next });
  };

  const changeShow = (next: string) =>
    void actions.updateWidgetSettings(widget.id, { show: next });

  /** Runs a change on a connected calendar, showing what went wrong if it fails. */
  const attempt = async (key: string, fn: () => Promise<void>) => {
    setPending(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  };

  const importFile = () =>
    void attempt("import", async () => {
      setImportNote(null);
      const result = await actions.importIcsFile();
      if (!result) return;
      const { added, skipped } = result;
      const events = (n: number) => `${n} event${n === 1 ? "" : "s"}`;
      setImportNote(
        added === 0 && skipped === 0
          ? "No events found in that file."
          : `Imported ${events(added)}` +
              (skipped ? ` · ${skipped} already on your calendar` : "") +
              ".",
      );
    });

  const remove = (item: AgendaItem) => {
    if (!item.local) {
      void attempt(`delete:${item.id}`, async () => {
        await actions.deleteRemoteEvent(item.id);
        setOpenId(null);
      });
      return;
    }
    setOpenId(null);
    undo.schedule(
      item.id,
      `Deleted “${item.title}”`,
      () => void actions.deleteCalendarEvent(item.id),
    );
  };

  const save = async (input: EventDraft) => {
    const { target, guests, addMeet, ...fields } = input;
    const editing = dialog?.event;
    if (editing && !editing.local) {
      await actions.updateRemoteEvent(editing.id, { ...fields, guests });
    } else if (editing) {
      await actions.updateCalendarEvent(editing.id, fields);
    } else if (target === "local") {
      await actions.createCalendarEvent(fields);
    } else {
      const [accountId, calendarId] = target.split("\n") as [string, string];
      await actions.createRemoteEvent({ ...fields, accountId, calendarId, guests, addMeet });
    }
  };

  const rowProps = (item: AgendaItem) => ({
    item,
    now,
    isNext: item.id === nextId,
    open: openId === item.id,
    pending,
    onToggle: () => setOpenId((id) => (id === item.id ? null : item.id)),
    onEdit: () => setDialog({ date: new Date(item.start), event: item }),
    onDelete: () => remove(item),
    onAnswer: (answer: CalendarRsvp) =>
      void attempt(`answer:${item.id}`, () => actions.respondToEvent(item.id, answer)),
  });

  return (
    <div className="cal">
      <div className="cal__head">
        {accounts.length > 0 && (
          <CalendarPicker accounts={accounts} value={show} onChange={changeShow} />
        )}
        <div className="seg" role="tablist" aria-label="View">
          <button
            type="button"
            role="tab"
            aria-selected={view === "agenda"}
            className={`seg__btn${view === "agenda" ? " is-active" : ""}`}
            onClick={() => changeView("agenda")}
          >
            Agenda
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "month"}
            className={`seg__btn${view === "month" ? " is-active" : ""}`}
            onClick={() => changeView("month")}
          >
            Month
          </button>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="cal__import"
          title="Import a calendar file (.ics)"
          aria-label="Import a calendar file (.ics)"
          disabled={pending === "import"}
          onClick={importFile}
        >
          {pending === "import" ? <Loader2 className="cal__spin" /> : <FileUp />}
        </Button>
        <Button
          type="button"
          size="sm"
          className="cal__new"
          onClick={() =>
            setDialog({ date: view === "month" ? selectedDate : new Date(), event: null })
          }
        >
          <Plus />
          <span className="cal__new-label">New event</span>
        </Button>
      </div>

      {troubled.length > 0 && (
        <div className="cal__notice" role="status">
          {troubled.some((a) => a.status === "error") ? (
            <AlertCircle size={14} aria-hidden />
          ) : (
            <Loader2 size={14} className="cal__spin" aria-hidden />
          )}
          <span className="cal__notice-text">
            {troubled.length === 1
              ? troubled[0]!.status === "error"
                ? `${troubled[0]!.label} couldn't sync.`
                : `Connecting ${troubled[0]!.label}…`
              : `${troubled.length} calendars need attention.`}
          </span>
          <button type="button" className="cal__notice-action" onClick={onOpenSettings}>
            {troubled.some((a) => a.status === "error") ? "Fix" : "Details"}
          </button>
        </div>
      )}

      {error && (
        <div className="cal__notice" role="alert">
          <AlertCircle size={14} aria-hidden />
          <span className="cal__notice-text cal__notice-text--wrap">{error}</span>
          <button
            type="button"
            className="cal__notice-action"
            aria-label="Dismiss"
            onClick={() => setError(null)}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {importNote && (
        <div className="cal__notice cal__notice--ok" role="status">
          <Check size={14} aria-hidden />
          <span className="cal__notice-text cal__notice-text--wrap">{importNote}</span>
          <button
            type="button"
            className="cal__notice-action"
            aria-label="Dismiss"
            onClick={() => setImportNote(null)}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {upNext && view === "agenda" && (
        <div className="cal__next" style={{ "--cal-color": upNext.color } as CSSProperties}>
          <div className="cal__next-text">
            <span className="cal__next-when">
              {isOngoing(upNext, now) ? "Happening now" : formatRelative(upNext, now)}
            </span>
            <span className="cal__next-title">{upNext.title}</span>
          </div>
          <Button type="button" size="sm" onClick={() => openLink(upNext.meetingUrl!)}>
            <Video />
            Join
          </Button>
        </div>
      )}

      {view === "agenda" && (
        <div className="cal__scroll" ref={scrollRef}>
          {groups.length === 0 && (
            <div className="blankstate">
              <span className="blankstate__icon">
                <CalendarDays size={16} />
              </span>
              <p className="blankstate__title">Nothing in the next {settings.lookAheadDays} days</p>
              <p className="blankstate__text">
                {accounts.length
                  ? "Add an event, or connect another calendar."
                  : "Add an event, or connect Google or Zoho to see your meetings here."}
              </p>
              <button type="button" className="cal__link" onClick={onOpenSettings}>
                Connect a calendar
              </button>
            </div>
          )}
          {groups.map((g) => (
            <section key={g.key} className="cal__day-group">
              <h3 className="cal__day-heading">
                <span>{formatDayHeading(g.day, now)}</span>
                <span className="cal__day-count">{g.items.length}</span>
              </h3>
              <ul className="cal__list">
                {g.items.map((item) => (
                  <AgendaRow key={item.id} {...rowProps(item)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {view === "month" && (
        <div className="cal__scroll cal__month-wrap" ref={scrollRef}>
          <div className="cal__month">
            <div className="cal__month-calendar">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => d && setSelectedDate(d)}
                modifiers={{ hasEvents: (d) => datesWithEvents.has(dayKey(d.getTime())) }}
                modifiersClassNames={{ hasEvents: "cal-day-dot" }}
                className="cal__grid"
              />
            </div>
            <div className="cal__month-detail cal__day-group">
              <h3 className="cal__day-heading">
                <span>{formatDayHeading(selectedDate.getTime(), now)}</span>
                <button
                  type="button"
                  className="cal__day-add"
                  aria-label={`Add an event on ${selectedDate.toLocaleDateString()}`}
                  title="Add an event on this day"
                  onClick={() => setDialog({ date: selectedDate, event: null })}
                >
                  <Plus size={13} />
                </button>
              </h3>
              <ul className="cal__list">
                {selectedDayItems.length === 0 && <li className="cal__empty">Nothing planned.</li>}
                {selectedDayItems.map((item) => (
                  <AgendaRow key={item.id} {...rowProps(item)} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <AddEventDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        defaultDate={dialog?.date ?? new Date()}
        event={dialog?.event ?? null}
        targets={targets}
        defaultTarget={defaultTarget}
        onSave={save}
      />

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

function CalendarPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: CalendarAccountRow[];
  value: string;
  onChange: (v: string) => void;
}) {
  const color =
    value === "all" ? null : value === "local" ? LOCAL_COLOR : accountColor(accounts, value);
  return (
    <label className="cal__pick">
      <span className="cal__pick-dots" aria-hidden>
        {color ? (
          <span className="cal__pick-dot" style={{ background: color }} />
        ) : (
          accounts
            .slice(0, 3)
            .map((a) => (
              <span
                key={a.id}
                className="cal__pick-dot"
                style={{ background: accountColor(accounts, a.id) }}
              />
            ))
        )}
      </span>
      <select aria-label="Calendars" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="all">All calendars</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
        <option value="local">This computer</option>
      </select>
      <ChevronDown size={13} className="cal__pick-chevron" aria-hidden />
    </label>
  );
}

interface RowProps {
  item: AgendaItem;
  now: number;
  isNext: boolean;
  open: boolean;
  pending: string | null;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAnswer: (answer: CalendarRsvp) => void;
}

const STATUS_LABEL: Record<CalendarRsvp, string> = {
  accepted: "Going",
  tentative: "Maybe",
  declined: "Declined",
  needsAction: "Invited",
};

function AgendaRow({
  item,
  now,
  isNext,
  open,
  pending,
  onToggle,
  onEdit,
  onDelete,
  onAnswer,
}: RowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ongoing = isOngoing(item, now);
  const relative = ongoing || isNext ? formatRelative(item, now) : null;
  const guests = item.attendees.filter((a) => !a.self);
  const invited = item.myStatus === "needsAction";
  const declined = item.myStatus === "declined";
  const deleting = pending === `delete:${item.id}`;
  const answering = pending === `answer:${item.id}`;

  return (
    <li
      data-event={item.id}
      className={`cal__row${ongoing ? " cal__row--now" : ""}${open ? " cal__row--open" : ""}${declined ? " cal__row--declined" : ""}`}
      style={{ "--cal-color": item.color } as CSSProperties}
    >
      <button type="button" className="cal__row-head" aria-expanded={open} onClick={onToggle}>
        <span className="cal__row-time num">
          <span className="cal__row-clock">
            {ongoing && <span className="cal__row-now-dot" aria-hidden />}
            {formatEventTime(item)}
          </span>
          {relative && <span className="cal__row-rel">{relative}</span>}
        </span>
        <span className="cal__row-bar" aria-hidden />
        <span className="cal__row-main">
          <span className="cal__row-title">{item.title}</span>
          {(!item.local || item.location || item.myStatus) && !open && (
            <span className="cal__row-meta">
              {item.myStatus && item.myStatus !== "accepted" && (
                <span className={`cal__tag cal__tag--${item.myStatus}`}>
                  {STATUS_LABEL[item.myStatus]}
                </span>
              )}
              {!item.local && <span className="cal__row-source">{item.source}</span>}
              {item.meetingUrl && (
                <span className="cal__row-location">
                  <Video size={10} aria-hidden />
                  {meetingName(item.meetingUrl)}
                </span>
              )}
              {item.location && !item.meetingUrl && (
                <span className="cal__row-location">
                  <MapPin size={10} aria-hidden />
                  {item.location}
                </span>
              )}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="cal__details">
          <p className="cal__details-when num">
            {formatEventWhen(item)}
            {item.recurring && (
              <span className="cal__details-repeat" title="Repeats">
                <Repeat size={11} aria-label="Repeats" />
              </span>
            )}
          </p>
          {!item.local && <p className="cal__details-source">{item.source}</p>}
          {item.meetingUrl && (
            <p className="cal__details-line">
              <button
                type="button"
                className="cal__join"
                onClick={() => openLink(item.meetingUrl!)}
              >
                <Video size={13} aria-hidden />
                Join {meetingName(item.meetingUrl)}
              </button>
            </p>
          )}
          {item.location && item.location !== item.meetingUrl && (
            <p className="cal__details-line">
              <MapPin size={12} aria-hidden />
              {item.location}
            </p>
          )}
          {item.organizer && <p className="cal__details-line">Organised by {item.organizer}</p>}
          {guests.length > 0 && <Guests guests={guests} />}
          {item.notes && <p className="cal__details-notes">{item.notes}</p>}

          {item.myStatus && (
            <div className="cal__rsvp" role="group" aria-label="Going?">
              <span className="cal__rsvp-label">{invited ? "Going?" : "Your answer"}</span>
              {ANSWERS.map(([answer, label]) => (
                <button
                  key={answer}
                  type="button"
                  aria-pressed={item.myStatus === answer}
                  className={`cal__rsvp-btn${item.myStatus === answer ? " is-on" : ""}`}
                  disabled={answering}
                  onClick={() => item.myStatus !== answer && onAnswer(answer)}
                >
                  {label}
                </button>
              ))}
              {answering && <Loader2 size={12} className="cal__spin" aria-hidden />}
            </div>
          )}

          <div className="cal__details-actions">
            {item.canEdit && (
              <>
                <button type="button" onClick={onEdit}>
                  <Pencil size={12} aria-hidden />
                  Edit
                </button>
                {confirmDelete ? (
                  <>
                    <span className="cal__details-source">
                      {guests.length
                        ? `Delete it? ${guests.length} guest${guests.length > 1 ? "s are" : " is"} told.`
                        : item.recurring
                          ? "Delete this occurrence?"
                          : "Delete it?"}
                    </span>
                    <button
                      type="button"
                      className="cal__details-delete cal__details-delete--confirm"
                      disabled={deleting}
                      onClick={onDelete}
                    >
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="cal__details-delete"
                    onClick={() => (item.local ? onDelete() : setConfirmDelete(true))}
                  >
                    <Trash2 size={12} aria-hidden />
                    Delete
                  </button>
                )}
              </>
            )}
            {!item.canEdit && !item.myStatus && !item.local && (
              <span className="cal__details-source">Read-only</span>
            )}
            {item.htmlLink && (
              <button type="button" onClick={() => openLink(item.htmlLink!)}>
                <ExternalLink size={12} aria-hidden />
                Open
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

const GUESTS_SHOWN = 6;

function Guests({ guests }: { guests: AgendaItem["attendees"] }) {
  const [all, setAll] = useState(false);
  const going = guests.filter((g) => g.status === "accepted").length;
  const shown = all ? guests : guests.slice(0, GUESTS_SHOWN);
  return (
    <div className="cal__guests">
      <p className="cal__details-line">
        <Users size={12} aria-hidden />
        {guests.length} guest{guests.length > 1 ? "s" : ""}
        {going ? ` · ${going} going` : ""}
      </p>
      <ul className="cal__guest-list">
        {shown.map((g) => (
          <li key={g.email} className={`cal__guest cal__guest--${g.status}`} title={g.email}>
            <span className="cal__guest-dot" aria-hidden />
            {g.name || g.email}
            {g.organizer && <small>organiser</small>}
            <span className="sr-only">{STATUS_LABEL[g.status]}</span>
          </li>
        ))}
      </ul>
      {guests.length > GUESTS_SHOWN && (
        <button type="button" className="cal__link cal__link--inline" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${guests.length}`}
        </button>
      )}
    </div>
  );
}
