import { useEffect, useState } from "react";

import type { NewCalendarEvent } from "../../../shared/types";
import type { AgendaItem } from "../lib/calendar";
import { errorText } from "../lib/tutor";
import { DatePicker } from "./DatePicker";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

/** A calendar a new event can go in. */
export interface EventTarget {
  /** "local", or the account id and calendar id joined by a newline. */
  value: string;
  label: string;
  /** Google calendars can add a Meet link. */
  google: boolean;
}

export interface EventDraft extends Required<NewCalendarEvent> {
  target: string;
  guests: string[];
  addMeet: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: Date;
  /** Set to edit an existing event instead of adding one. */
  event?: AgendaItem | null;
  /** Where a new event can go; the first is the default. */
  targets: EventTarget[];
  defaultTarget?: string;
  /** Rejects with the reason when the calendar refuses; the dialog stays open and shows it. */
  onSave: (input: EventDraft) => Promise<void> | void;
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toTimeInput(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Rounds up to the next half hour, for a sensible default start time. */
function nextHalfHour(d: Date): Date {
  const next = new Date(d);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() % 30 === 0 ? next.getMinutes() : next.getMinutes() + (30 - (next.getMinutes() % 30)));
  return next;
}

/** Minutes between two date+time strings, or null if either is invalid. */
function minutesBetween(d1: string, t1: string, d2: string, t2: string): number | null {
  const a = new Date(`${d1}T${t1}:00`).getTime();
  const b = new Date(`${d2}T${t2}:00`).getTime();
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 60_000);
}

export function AddEventDialog({
  open,
  onOpenChange,
  defaultDate,
  event,
  targets,
  defaultTarget,
  onSave,
}: Props) {
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(() => toDateInput(defaultDate));
  const [startTime, setStartTime] = useState(() => toTimeInput(nextHalfHour(new Date())));
  const [endDate, setEndDate] = useState(() => toDateInput(defaultDate));
  const [endTime, setEndTime] = useState(() =>
    toTimeInput(new Date(nextHalfHour(new Date()).getTime() + 60 * 60_000)),
  );
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [target, setTarget] = useState("local");
  const [guests, setGuests] = useState("");
  const [addMeet, setAddMeet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remote = event ? !event.local : target !== "local";
  const google = !event && Boolean(targets.find((t) => t.value === target)?.google);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setAddMeet(false);
    if (event) {
      setGuests(
        event.attendees
          .filter((a) => !a.self)
          .map((a) => a.email)
          .join(", "),
      );
      const start = new Date(event.start);
      // All-day ends are exclusive midnights; show the last day instead.
      const end = new Date(event.allDay ? event.end - 1 : event.end);
      setTitle(event.title);
      setAllDay(event.allDay);
      setStartDate(toDateInput(start));
      setStartTime(toTimeInput(start));
      setEndDate(toDateInput(end));
      setEndTime(toTimeInput(end));
      setLocation(event.location);
      setNotes(event.notes);
      return;
    }
    const start = nextHalfHour(new Date());
    setGuests("");
    setTarget(
      defaultTarget && targets.some((t) => t.value === defaultTarget)
        ? defaultTarget
        : (targets[0]?.value ?? "local"),
    );
    setTitle("");
    setAllDay(false);
    setStartDate(toDateInput(defaultDate));
    setStartTime(toTimeInput(start));
    setEndDate(toDateInput(defaultDate));
    setEndTime(toTimeInput(new Date(start.getTime() + 60 * 60_000)));
    setLocation("");
    setNotes("");
    // Targets are rebuilt with every snapshot; only opening the dialog should reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, event]);

  /** Moving the start moves the end with it, keeping the duration. */
  const moveStart = (date: string, time: string) => {
    const duration = minutesBetween(startDate, startTime, endDate, endTime);
    setStartDate(date);
    setStartTime(time);
    const start = new Date(`${date}T${time}:00`);
    if (duration === null || Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + Math.max(duration, 15) * 60_000);
    setEndDate(toDateInput(end));
    setEndTime(toTimeInput(end));
  };

  const submit = async () => {
    if (saving) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Give it a title.");
      return;
    }

    let start: number;
    let end: number;
    if (allDay) {
      const day = new Date(`${startDate}T00:00:00`);
      start = day.getTime();
      day.setDate(day.getDate() + 1);
      end = day.getTime();
    } else {
      start = new Date(`${startDate}T${startTime}:00`).getTime();
      end = new Date(`${endDate}T${endTime}:00`).getTime();
    }

    if (Number.isNaN(start) || Number.isNaN(end)) {
      setError("That date/time doesn't look right.");
      return;
    }
    if (end <= start) {
      setError("End has to be after start.");
      return;
    }

    const invited = guests
      .split(/[\s,;]+/)
      .map((g) => g.trim())
      .filter(Boolean);
    const bad = invited.find((g) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g));
    if (remote && bad) {
      setError(`“${bad}” isn't an email address.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: trimmed,
        start,
        end,
        allDay,
        location: location.trim(),
        notes: notes.trim(),
        target,
        guests: remote ? invited : [],
        addMeet: google && addMeet,
      });
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "Add event"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          </div>

          {event ? (
            !event.local && <p className="text-xs text-muted-foreground">In {event.source}</p>
          ) : (
            targets.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-calendar">Calendar</Label>
                <select
                  id="event-calendar"
                  className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  {targets.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            )
          )}

          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
            <Label htmlFor="event-allday" className="cursor-pointer">
              All day
            </Label>
            <Switch id="event-allday" checked={allDay} onCheckedChange={setAllDay} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Starts</Label>
            <div className="flex gap-2">
              <DatePicker value={startDate} onChange={(d) => moveStart(d, startTime)} />
              {!allDay && (
                <Input
                  type="time"
                  aria-label="Start time"
                  className="w-[112px] shrink-0"
                  value={startTime}
                  onChange={(e) => moveStart(startDate, e.target.value)}
                />
              )}
            </div>
          </div>

          {!allDay && (
            <div className="flex flex-col gap-1.5">
              <Label>Ends</Label>
              <div className="flex gap-2">
                <DatePicker value={endDate} onChange={setEndDate} />
                <Input
                  type="time"
                  aria-label="End time"
                  className="w-[112px] shrink-0"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-location">Location</Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-notes">Notes</Label>
            <Textarea
              id="event-notes"
              rows={2}
              className="resize-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {remote && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-guests">Guests</Label>
              <Input
                id="event-guests"
                placeholder="Email addresses, separated by commas"
                value={guests}
                onChange={(e) => setGuests(e.target.value)}
              />
              {guests.trim() && (
                <p className="text-xs text-muted-foreground">
                  {event ? "Guests get an email about changes." : "Guests get an invitation email."}
                </p>
              )}
            </div>
          )}

          {google && (
            <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
              <Label htmlFor="event-meet" className="cursor-pointer">
                Add a Google Meet link
              </Label>
              <Switch id="event-meet" checked={addMeet} onCheckedChange={setAddMeet} />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void submit()}>
            {saving ? "Saving…" : event ? "Save" : "Add event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
