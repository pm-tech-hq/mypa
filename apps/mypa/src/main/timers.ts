/**
 * Timer & Stopwatch in the main process: every change is worked out here
 * with one clock, and one scheduler announces each timer's end (desktop
 * notification, plus a chime in the app) whichever page is showing.
 */
import { BrowserWindow, ipcMain, powerMonitor } from "electron";

import { IPC } from "../shared/api";
import { durationLabel, endsAt, type TimerAction, type TimerKind, type TimerSettings } from "../shared/timers";
import { pushSnapshot } from "./broadcast";
import * as db from "./db";
import { notify } from "./system";

const ACTIONS = new Set(["start", "pause", "reset", "lap", "add"]);

function cleanAction(a: unknown): TimerAction {
  const kind = String((a as { kind?: unknown })?.kind ?? "");
  if (!ACTIONS.has(kind)) throw new Error("Unknown timer action.");
  if (kind === "add") {
    const ms = Number((a as { ms?: unknown }).ms);
    return { kind: "add", ms: Number.isFinite(ms) ? ms : 60_000 };
  }
  return { kind } as TimerAction;
}

export function registerTimerHandlers(snap: () => unknown): void {
  const write = (fn: () => void) => {
    fn();
    db.flush();
    rescheduleTimers();
    return snap();
  };
  ipcMain.handle(IPC.timerCreate, (_e, input: { kind?: TimerKind; label?: string; durationMs?: number; start?: boolean }) => {
    let id = "";
    write(() => {
      id = db.createTimer(input ?? {}).id;
    });
    return { id, snapshot: snap() };
  });
  ipcMain.handle(IPC.timerAction, (_e, id: string, action: unknown) =>
    write(() => void db.timerActionDb(String(id), cleanAction(action))),
  );
  ipcMain.handle(IPC.timerUpdate, (_e, id: string, patch: { label?: string; durationMs?: number }) =>
    write(() => db.updateTimer(String(id), patch ?? {})),
  );
  ipcMain.handle(IPC.timerDelete, (_e, id: string) => write(() => db.deleteTimer(String(id))));
  ipcMain.handle(IPC.timerPut, (_e, row: Parameters<typeof db.putTimer>[0]) => write(() => db.putTimer(row)));
  ipcMain.handle(IPC.timerSettings, (_e, patch: Partial<TimerSettings>) => write(() => db.setTimerSettings(patch ?? {})));
}

/* ------------------------------------------------------------- scheduler -- */

/** An end more than this late (the PC was asleep or off) is marked done quietly. */
const LATE_MS = 2 * 60_000;
let timer: NodeJS.Timeout | undefined;

function send(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, ...args);
}

function check(): void {
  clearTimeout(timer);
  let next: number | null = null;
  try {
    const now = Date.now();
    let changed = false;
    for (const t of db.listTimers()) {
      const end = endsAt(t);
      if (end === null || t.firedAt !== null) continue;
      if (end > now) {
        next = next === null ? end : Math.min(next, end);
        continue;
      }
      db.markTimerFired(t.id, now);
      changed = true;
      if (now - end > LATE_MS) continue;
      const name = t.label || `${durationLabel(t.durationMs)} timer`;
      notify({
        title: t.label ? `${t.label}: time's up` : "Time's up",
        body: t.label ? `Your ${durationLabel(t.durationMs)} timer has ended.` : `Your ${name} has ended.`,
        subtitle: "Timer",
        onClick: () => send(IPC.timerFired, t.id, true),
      });
      send(IPC.timerFired, t.id, false);
    }
    if (changed) {
      db.flush();
      pushSnapshot();
    }
  } catch {
    /* database not ready yet */
  }
  // the timeout is only a wake-up; times always come from the clock
  const wait = next === null ? 60_000 : Math.min(60_000, next - Date.now() + 15);
  timer = setTimeout(check, Math.max(20, wait));
}

export function rescheduleTimers(): void {
  clearTimeout(timer);
  timer = setTimeout(check, 30);
}

export function startTimers(): void {
  powerMonitor.on("resume", rescheduleTimers);
  check();
}
