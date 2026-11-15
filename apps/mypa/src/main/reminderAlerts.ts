/**
 * Fires the Reminders widget's desktop alerts. Each alert time notifies once
 * (remembered in the row, so restarts don't repeat it). The next check is
 * timed to the soonest alert, with a one-minute safety tick and a check on
 * wake from sleep. Alerts missed while myPA was closed are gathered into one
 * "you missed" notification instead of a burst.
 *
 * On Windows the notification has Snooze and Done buttons; they come back as
 * mypa://reminder/… links (see deeplink.ts).
 */
import { BrowserWindow, powerMonitor, type Notification } from "electron";

import { IPC } from "../shared/api";
import { alertAt, clockLabel, whenLabel, type ReminderRow } from "../shared/reminders";
import { pushSnapshot } from "./broadcast";
import * as db from "./db";
import { handleReminderLinks, type ReminderLinkAction } from "./deeplink";
import { notify, removeToasts, showMainWindow } from "./system";

/** An alert this late is "missed" (the app was closed or asleep), not "now". */
const MISSED_MS = 5 * 60_000;
const SAFETY_TICK_MS = 60_000;

let timer: NodeJS.Timeout | undefined;

/**
 * Reminder toasts stay on screen until dismissed, so each one is kept with the
 * alert time it announced and closed once that no longer holds (ticked off,
 * snoozed, moved or deleted — from the widget, a toast button or the assistant).
 */
const shown = new Map<string, { at: number; n: Notification }>();

function ringing(r: ReminderRow | null | undefined): boolean {
  return !!r && r.doneAt === null && r.firedAt !== null && alertAt(r) === r.firedAt;
}

function closeStaleToasts(): void {
  const stale: string[] = [];
  for (const [id, t] of shown) {
    const r = db.getReminder(id);
    if (ringing(r) && r!.firedAt === t.at) continue;
    t.n.close();
    shown.delete(id);
    stale.push(link("open", id));
  }
  removeToasts(stale);
}

/** Toasts left from before a restart, for reminders handled since (or while closed). */
function closeLeftoverToasts(): void {
  const stale = db
    .listReminders()
    .filter((r) => r.firedAt !== null && r.firedAt > Date.now() - 7 * 86_400_000 && !ringing(r))
    .slice(0, 200)
    .map((r) => link("open", r.id));
  removeToasts(stale);
}

function focus(id: string): void {
  showMainWindow();
  const send = (win: BrowserWindow) => win.webContents.send(IPC.reminderFocus, id);
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", () => send(win));
    else send(win);
  }
}

function snoozeLabel(min: number): string {
  return min % 60 === 0 ? `${min / 60} h` : `${min} min`;
}

function link(action: ReminderLinkAction, id: string): string {
  return `mypa://reminder/${action}/${id}`;
}

function alertOne(r: ReminderRow, now: number): void {
  const at = alertAt(r)!;
  const note = r.notes.split("\n").find((l) => l.trim())?.trim();
  const late = now - at > MISSED_MS;
  const when = late ? `Was due ${whenLabel(at, now)}` : `Due ${clockLabel(at)}`;
  notify({
    title: r.important ? `❗ ${r.title}` : r.title,
    body: note ? `${note}\n${when}` : when,
    subtitle: "Reminder",
    onClick: () => focus(r.id),
    launchUrl: link("open", r.id),
    actions: [
      { label: `Snooze ${snoozeLabel(db.reminderSnoozeMinutes())}`, url: link("snooze", r.id) },
      { label: "Done", url: link("done", r.id) },
    ],
    persistent: true,
    onShown: (n) => {
      shown.get(r.id)?.n.close();
      shown.set(r.id, { at, n });
    },
  });
}

function check(): void {
  clearTimeout(timer);
  try {
    closeStaleToasts();
  } catch {
    /* database not ready yet */
  }
  const now = Date.now();
  let due: ReminderRow[] = [];
  try {
    due = db.dueReminderAlerts(now);
  } catch {
    /* database not ready yet */
  }

  if (due.length) {
    const fresh = due.filter((r) => now - alertAt(r)! <= MISSED_MS);
    const missed = due.filter((r) => now - alertAt(r)! > MISSED_MS);
    for (const r of fresh) alertOne(r, now);
    if (missed.length === 1) alertOne(missed[0]!, now);
    else if (missed.length > 1) {
      const names = missed
        .slice(0, 4)
        .map((r) => `• ${r.title}`)
        .join("\n");
      notify({
        title: `You missed ${missed.length} reminders`,
        body: missed.length > 4 ? `${names}\n…and ${missed.length - 4} more` : names,
        subtitle: "Reminders",
        onClick: () => focus(missed[0]!.id),
      });
    }
    for (const r of due) db.markReminderFired(r.id, alertAt(r)!);
    db.flush();
    pushSnapshot();
  }

  const next = db.nextReminderAlert(Date.now());
  const wait = next === null ? SAFETY_TICK_MS : Math.min(SAFETY_TICK_MS, next - Date.now() + 250);
  timer = setTimeout(check, Math.max(1000, wait));
}

/** Call after any change to reminders so a new or moved alert is timed right. */
export function rescheduleReminders(): void {
  clearTimeout(timer);
  timer = setTimeout(check, 300);
}

function onLink({ action, id }: { action: ReminderLinkAction; id: string }): void {
  const r = db.getReminder(id);
  if (!r) return;
  if (action === "done") {
    db.completeReminder(id, true);
  } else if (action === "snooze") {
    db.snoozeReminder(id, Date.now() + db.reminderSnoozeMinutes() * 60_000);
  } else {
    focus(id);
    return;
  }
  db.flush();
  pushSnapshot();
  rescheduleReminders();
}

export function startReminderAlerts(): void {
  handleReminderLinks(onLink);
  powerMonitor.on("resume", rescheduleReminders);
  powerMonitor.on("unlock-screen", rescheduleReminders);
  try {
    closeLeftoverToasts();
  } catch {
    /* database not ready yet */
  }
  check();
}
