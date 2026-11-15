import { resolve } from "node:path";

import { mainWindow } from "./windows";
import { app, BrowserWindow } from "electron";

import { MARKET_IPC } from "../shared/marketApi";

/**
 * `mypa://widget/<id>` links from the marketplace website open the widget's
 * page in the in-app Marketplace. The OS hands the URL to a new process, so
 * this also makes the app single-instance and forwards the link to the
 * window that's already open.
 */
const SCHEME = "mypa";
let pending: string | null = null;

/* ---- reminder links: the buttons on a reminder notification ---- */

export type ReminderLinkAction = "open" | "done" | "snooze";
type ReminderLink = { action: ReminderLinkAction; id: string };
let onReminder: ((link: ReminderLink) => void) | null = null;
const pendingReminders: ReminderLink[] = [];

function reminderLinkFrom(argv: string[]): ReminderLink | null {
  const url = argv.find((a) => a.startsWith(`${SCHEME}://`));
  if (!url) return null;
  const m = /^mypa:\/\/reminder\/(open|done|snooze)\/([a-z0-9-]{8,64})\/?$/i.exec(url);
  return m ? { action: m[1]!.toLowerCase() as ReminderLinkAction, id: m[2]! } : null;
}

function deliverReminder(link: ReminderLink): void {
  if (onReminder) onReminder(link);
  else pendingReminders.push(link);
}

/** Handles reminder links (including one this launch was started with). */
export function handleReminderLinks(cb: (link: ReminderLink) => void): void {
  onReminder = cb;
  for (const link of pendingReminders.splice(0)) cb(link);
}

function widgetIdFrom(argv: string[]): string | null {
  const url = argv.find((a) => a.startsWith(`${SCHEME}://`));
  if (!url) return null;
  const match = /^mypa:\/\/widget\/([a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*)\/?$/i.exec(url);
  return match ? decodeURIComponent(match[1]!).toLowerCase() : null;
}

function deliver(id: string): void {
  const win = mainWindow();
  if (!win) {
    pending = id;
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  const send = () => win.webContents.send(MARKET_IPC.openWidget, id);
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
}

/** Returns false if another instance already owns the app (this one should quit). */
export function setupDeepLinks(): boolean {
  if (!app.requestSingleInstanceLock()) return false;

  if (process.defaultApp && process.argv[1]) {
    // Dev: `electron .` needs the app path so the OS can relaunch it.
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }

  pending = widgetIdFrom(process.argv);
  const launchReminder = reminderLinkFrom(process.argv);
  if (launchReminder) pendingReminders.push(launchReminder);
  app.on("second-instance", (_e, argv) => {
    const reminder = reminderLinkFrom(argv);
    if (reminder) {
      // Done and Snooze happen quietly; Open is handled by the reminder code.
      deliverReminder(reminder);
      return;
    }
    const id = widgetIdFrom(argv);
    const win = mainWindow();
    if (id) deliver(id);
    else if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  // macOS delivers links through open-url instead of argv.
  app.on("open-url", (e, url) => {
    e.preventDefault();
    const reminder = reminderLinkFrom([url]);
    if (reminder) return deliverReminder(reminder);
    const id = widgetIdFrom([url]);
    if (id) deliver(id);
  });
  return true;
}

/** Call once the first window exists. */
export function flushPendingDeepLink(): void {
  if (pending) {
    const id = pending;
    pending = null;
    deliver(id);
  }
}
