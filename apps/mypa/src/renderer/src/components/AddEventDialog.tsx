import { useEffect, useState } from "react";

import type { NewCalendarEvent } from "../../../shared/types";
import type { AgendaItem } from "../lib/calendar";
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: Date;
  /** Set to edit an existing local event instead of adding one. */
  event?: AgendaItem | null;
  onSave: (input: NewCalendarEvent) => void;
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

export function AddEventDialog({ open, onOpenChange, defaultDate, event, onSave }: Props) {
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (event) {
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
    setTitle("");
    setAllDay(false);
    setStartDate(toDateInput(defaultDate));
    setStartTime(toTimeInput(start));
    setEndDate(toDateInput(defaultDate));
    setEndTime(toTimeInput(new Date(start.getTime() + 60 * 60_000)));
    setLocation("");
    setNotes("");
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

  const submit = () => {
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

    onSave({
      title: trimmed,
      start,
      end,
      allDay,
      location: location.trim(),
      notes: notes.trim(),
    });
    onOpenChange(false);
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
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

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

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit}>
            {event ? "Save" : "Add event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
