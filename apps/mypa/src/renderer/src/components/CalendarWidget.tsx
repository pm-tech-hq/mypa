import { useEffect, useMemo, useState } from "react";

import {
  AlertCircle,
  CalendarDays,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
  type WidgetRow,
} from "../../../shared/types";
import {
  dayKey,
  formatDayHeading,
  formatEventTime,
  formatEventWhen,
  formatRelative,
  groupByDay,
  isOngoing,
  mergeEvents,
  type AgendaItem,
} from "../lib/calendar";
import { useReadyStore } from "../lib/store";
import { useUndo } from "../lib/useUndo";
import "../styles/calendar.css";
import { AddEventDialog } from "./AddEventDialog";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { UndoToast } from "./UndoToast";

const TICK_MS = 30_000;

export function CalendarWidget({
  widget,
  onOpenSettings,
}: {
  widget: WidgetRow;
  onOpenSettings: () => void;
}) {
  const { snapshot, actions } = useReadyStore();
  const settings: CalendarSettings = { ...DEFAULT_CALENDAR_SETTINGS, ...widget.settings };

  const [view, setView] = useState<"agenda" | "month">(settings.view);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [dialog, setDialog] = useState<{ date: Date; event: AgendaItem | null } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const undo = useUndo(widget.id);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(
    () =>
      mergeEvents(
        snapshot.calendarEvents,
        snapshot.calendarRemoteEvents,
        snapshot.calendarAccounts,
      ).filter((i) => !undo.hidden.has(i.id)),
    [
      snapshot.calendarEvents,
      snapshot.calendarRemoteEvents,
      snapshot.calendarAccounts,
      undo.hidden,
    ],
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

  const selectedDayItems = useMemo(() => {
    const key = selectedDate.toDateString();
    return items.filter((i) => new Date(i.start).toDateString() === key);
  }, [items, selectedDate]);

  const datesWithEvents = useMemo(() => new Set(items.map((i) => dayKey(i.start))), [items]);

  const troubled = snapshot.calendarAccounts.filter((a) => a.status !== "connected");

  const changeView = (next: "agenda" | "month") => {
    setView(next);
    void actions.updateWidgetSettings(widget.id, { view: next });
  };

  const remove = (item: AgendaItem) => {
    setOpenId(null);
    undo.schedule(
      item.id,
      `Deleted “${item.title}”`,
      () => void actions.deleteCalendarEvent(item.id),
    );
  };

  const rowProps = (item: AgendaItem) => ({
    item,
    now,
    isNext: item.id === nextId,
    open: openId === item.id,
    onToggle: () => setOpenId((id) => (id === item.id ? null : item.id)),
    onEdit: () => setDialog({ date: new Date(item.start), event: item }),
    onDelete: () => remove(item),
  });

  return (
    <div className="cal">
      <div className="cal__head">
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
          size="sm"
          onClick={() =>
            setDialog({ date: view === "month" ? selectedDate : new Date(), event: null })
          }
        >
          <Plus />
          New event
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

      {view === "agenda" && (
        <div className="cal__scroll">
          {groups.length === 0 && (
            <div className="blankstate">
              <span className="blankstate__icon">
                <CalendarDays size={16} />
              </span>
              <p className="blankstate__title">Nothing in the next {settings.lookAheadDays} days</p>
              <p className="blankstate__text">
                Add an event, or bring in Google, Outlook or an ICS feed.
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
        <div className="cal__scroll cal__month-wrap">
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
        onSave={(input) => {
          const editing = dialog?.event;
          if (editing) void actions.updateCalendarEvent(editing.id, input);
          else void actions.createCalendarEvent(input);
        }}
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

interface RowProps {
  item: AgendaItem;
  now: number;
  isNext: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function AgendaRow({ item, now, isNext, open, onToggle, onEdit, onDelete }: RowProps) {
  const ongoing = isOngoing(item, now);
  const relative = ongoing || isNext ? formatRelative(item, now) : null;
  return (
    <li className={`cal__row${ongoing ? " cal__row--now" : ""}${open ? " cal__row--open" : ""}`}>
      <button type="button" className="cal__row-head" aria-expanded={open} onClick={onToggle}>
        <span className="cal__row-time num">
          <span className="cal__row-clock">
            {ongoing && <span className="cal__row-now-dot" aria-hidden />}
            {formatEventTime(item)}
          </span>
          {relative && <span className="cal__row-rel">{relative}</span>}
        </span>
        <span className="cal__row-main">
          <span className="cal__row-title">{item.title}</span>
          {(!item.local || item.location) && !open && (
            <span className="cal__row-meta">
              {!item.local && <span className="cal__row-source">{item.source}</span>}
              {item.location && (
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
          <p className="cal__details-when num">{formatEventWhen(item)}</p>
          {item.location && (
            <p className="cal__details-line">
              <MapPin size={12} aria-hidden />
              {item.location}
            </p>
          )}
          {item.notes && <p className="cal__details-notes">{item.notes}</p>}
          <div className="cal__details-actions">
            {item.local ? (
              <>
                <button type="button" onClick={onEdit}>
                  <Pencil size={12} aria-hidden />
                  Edit
                </button>
                <button type="button" className="cal__details-delete" onClick={onDelete}>
                  <Trash2 size={12} aria-hidden />
                  Delete
                </button>
              </>
            ) : (
              <>
                <span className="cal__details-source">From {item.source} · read-only</span>
                {item.htmlLink && (
                  <button
                    type="button"
                    onClick={() => void window.mypa.market.openExternal(item.htmlLink!)}
                  >
                    <ExternalLink size={12} aria-hidden />
                    Open
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
