/**
 * Desktop reminders before meetings: your own events and those of connected
 * accounts with reminders on. Each event is reminded once (remembered across
 * restarts); clicking the reminder opens the event in the Calendar widget.
 */
import { BrowserWindow } from "electron";

import { IPC } from "../../shared/api";
import * as db from "../db";
import { notify } from "../system";

const TICK_MS = 30_000;
/** A meeting that started this recently still gets its reminder (e.g. the app just opened). */
const GRACE_MS = 2 * 60_000;

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function focus(id: string): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.calendarFocus, id);
}

function check(): void {
  const lead = db.calendarReminder();
  if (lead < 0) return;
  const now = Date.now();
  const due = db.reminderCandidates(now - GRACE_MS, now + lead * 60_000);
  if (due.length === 0) return;

  const done = db.remindedKeys();
  const seen = new Set(done);
  let changed = false;
  for (const e of due) {
    const key = `${e.id}|${e.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    done.push(key);
    changed = true;
    const mins = Math.round((e.start - now) / 60_000);
    const when = mins <= 0 ? `Now · ${clock(e.start)}` : `In ${mins} min · ${clock(e.start)}`;
    const where = e.meetingUrl ? "Click to open, then Join" : e.location;
    notify({
      title: e.title,
      body: where ? `${when} · ${where}` : when,
      subtitle: e.source ?? undefined,
      onClick: () => focus(e.id),
    });
  }
  if (changed) {
    // Keep a day of history: enough to never repeat, small enough to stay cheap.
    const cutoff = now - 86_400_000;
    db.setRemindedKeys(done.filter((k) => Number(k.split("|").pop()) > cutoff));
  }
}

export function startReminders(): void {
  check();
  setInterval(check, TICK_MS);
}
