/**
 * Quick Capture in the main process: saving a capture creates the real record
 * (task, reminder, event or expense) and logs where it went; the pop-up box
 * opens from a global shortcut anywhere in the system, even with myPA in the
 * tray.
 */
import { join } from "node:path";

import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";

import {
  detectKind,
  hotkeyLabel,
  planCapture,
  type CaptureKind,
  type CapturePlan,
  type CaptureSettings,
} from "../shared/capture";
import { IPC } from "../shared/api";
import { pushSnapshot } from "./broadcast";
import * as db from "./db";
import { rescheduleReminders } from "./reminderAlerts";
import { showMainWindow } from "./system";
import { markHelperWindow } from "./windows";

/* ------------------------------------------------------------- routing -- */

function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function context() {
  const now = Date.now();
  return {
    now,
    expense: { categories: db.listExpenseCategories(), history: db.listExpenses().slice(0, 500), today: ymd(now) },
  };
}

function create(plan: CapturePlan): string | null {
  switch (plan.kind) {
    case "task":
      return db.createTask({
        title: plan.title,
        importance: plan.importance,
        section: db.captureSettings().taskSection,
        due: plan.due,
      });
    case "reminder": {
      const id = db.createReminder({ title: plan.title, notes: "", dueAt: plan.dueAt, repeat: plan.repeat, important: false });
      rescheduleReminders();
      return id;
    }
    case "event":
      return db.createCalendarEvent({ title: plan.title, start: plan.start, end: plan.end });
    case "expense":
      return db.createExpense({ amount: plan.amount, categoryId: plan.categoryId, note: plan.note, date: plan.date });
    case "note":
      return null;
  }
}

/** Removes the record a capture became (if it's still there). */
function removeTarget(kind: CaptureKind, targetId: string | null): void {
  if (!targetId) return;
  if (kind === "task") db.deleteTask(targetId);
  else if (kind === "reminder") {
    db.deleteReminders([targetId]);
    rescheduleReminders();
  } else if (kind === "event") db.deleteCalendarEvent(targetId);
  else if (kind === "expense") db.deleteExpenses([targetId]);
}

/** Saves `text` as `kind` (or whatever it looks like). Throws a readable error. */
export function saveCapture(text: string, kind?: CaptureKind): { id: string; kind: CaptureKind } {
  const ctx = context();
  const k = kind ?? detectKind(text, ctx.expense).kind;
  const plan = planCapture(text, k, ctx);
  if ("error" in plan) throw new Error(plan.error);
  const targetId = create(plan);
  // a note keeps what was said, minus a typed "idea:" / "n:"
  const keep = plan.kind === "note" ? plan.text : text.trim();
  const id = db.insertCapture({ text: keep.slice(0, 4000), kind: k, targetId });
  return { id, kind: k };
}

/** Files an existing capture as another kind: the old record goes, a new one is made. */
export function convertCapture(id: string, kind: CaptureKind): void {
  const c = db.getCapture(id);
  if (!c) throw new Error("That capture is gone.");
  if (c.kind === kind) return;
  const plan = planCapture(c.text, kind, context());
  if ("error" in plan) throw new Error(plan.error);
  const targetId = create(plan);
  removeTarget(c.kind, c.targetId);
  db.updateCapture(id, { kind, targetId, done: false });
}

/** Deletes captures; with `targets`, also what they became (an immediate undo). */
export function removeCaptures(ids: string[], targets: boolean): void {
  for (const id of ids) {
    const c = db.getCapture(id);
    if (!c) continue;
    if (targets) removeTarget(c.kind, c.targetId);
  }
  db.deleteCaptures(ids);
}

/* --------------------------------------------------------- pop-up box -- */

let popup: BrowserWindow | null = null;
let registered: string | null = null;
let hotkeyError: string | null = null;
const POPUP_W = 600;

function createPopup(): BrowserWindow {
  const win = new BrowserWindow({
    width: POPUP_W,
    height: 180,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    transparent: true,
    hasShadow: false,
    title: "Quick Capture",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  markHelperWindow(win);
  win.setAlwaysOnTop(true, "pop-up-menu");
  win.on("blur", () => {
    if (!win.webContents.isDevToolsOpened()) win.hide();
  });
  win.on("closed", () => {
    popup = null;
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#capture`);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"), { hash: "capture" });
  }
  return win;
}

/** Opens the box on the screen the pointer is on (or hides it if it's open). */
export function toggleCapture(): void {
  if (popup && !popup.isDestroyed() && popup.isVisible()) {
    popup.hide();
    return;
  }
  popup ??= createPopup();
  const win = popup;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  win.setPosition(
    Math.round(area.x + (area.width - POPUP_W) / 2),
    Math.round(area.y + area.height * 0.2),
  );
  const show = () => {
    win.show();
    win.focus();
    win.webContents.send(IPC.captureShown);
  };
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", show);
  else show();
}

/** Closes the box for good (so the app can quit when the main window goes). */
export function destroyCapturePopup(): void {
  if (popup && !popup.isDestroyed()) popup.destroy();
  popup = null;
}

/** (Re)binds the global shortcut from settings; remembers why it failed. */
export function applyCaptureHotkey(s: CaptureSettings = db.captureSettings()): void {
  if (registered) {
    globalShortcut.unregister(registered);
    registered = null;
  }
  hotkeyError = null;
  if (!s.hotkeyOn) return;
  let ok = false;
  try {
    ok = globalShortcut.register(s.hotkey, toggleCapture);
  } catch {
    ok = false;
  }
  if (ok) registered = s.hotkey;
  else hotkeyError = `${hotkeyLabel(s.hotkey, process.platform === "darwin")} is taken by another app. Pick another shortcut.`;
}

export function captureHotkeyStatus(): { active: boolean; error: string | null } {
  return { active: registered !== null, error: hotkeyError };
}

/* ----------------------------------------------------------------- IPC -- */

export function registerCaptureHandlers(snap: () => unknown): void {
  const write = (fn: () => void) => {
    fn();
    db.flush();
    pushSnapshot(); // the pop-up and the main window both see it
    return snap();
  };
  ipcMain.handle(IPC.captureSave, (_e, text: string, kind?: CaptureKind) =>
    write(() => void saveCapture(String(text ?? ""), kind)),
  );
  ipcMain.handle(IPC.captureConvert, (_e, id: string, kind: CaptureKind) =>
    write(() => convertCapture(String(id), kind)),
  );
  ipcMain.handle(IPC.captureDelete, (_e, ids: string[], targets: boolean) =>
    write(() => removeCaptures(Array.isArray(ids) ? ids.map(String) : [], targets === true)),
  );
  ipcMain.handle(IPC.captureDone, (_e, id: string, done: boolean) =>
    write(() => db.updateCapture(String(id), { done: done === true })),
  );
  ipcMain.handle(IPC.captureToNote, (_e, id: string, widgetId: string) =>
    write(() => {
      const c = db.getCapture(String(id));
      if (!c) throw new Error("That capture is gone.");
      db.appendToNote(String(widgetId), c.text);
      db.updateCapture(c.id, { done: true });
    }),
  );
  ipcMain.handle(IPC.captureSettings, (_e, patch: Partial<CaptureSettings>) =>
    write(() => {
      db.setCaptureSettings(patch ?? {});
      applyCaptureHotkey();
    }),
  );
  ipcMain.handle(IPC.captureHotkeyStatus, () => captureHotkeyStatus());
  ipcMain.on(IPC.captureHide, () => popup?.hide());
  ipcMain.on(IPC.captureOpenMain, () => {
    popup?.hide();
    showMainWindow();
  });
  ipcMain.on(IPC.captureResize, (_e, height: number) => {
    if (!popup || popup.isDestroyed()) return;
    const h = Math.max(120, Math.min(560, Math.round(Number(height) || 0)));
    popup.setSize(POPUP_W, h);
  });
}

export function startCapture(): void {
  applyCaptureHotkey();
  app.on("will-quit", () => globalShortcut.unregisterAll());
}
