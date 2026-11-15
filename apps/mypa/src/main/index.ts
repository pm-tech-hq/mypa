import { writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";

import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell } from "electron";

import icon from "../../resources/icon.png?asset";
import { IPC } from "../shared/api";
import type {
  CalendarAccountPatch,
  CalendarEventRow,
  CalendarRsvp,
  NewCaldavCalendar,
  NewRemoteEvent,
  NewZohoCalendar,
  RemoteEventPatch,
  GoalRow,
  NewCalendarEvent,
  NewGoal,
  NewGoogleAccount,
  NewIcsAccount,
  NewOutlookAccount,
  NewPage,
  NewPageTranscript,
  NewStep,
  NewTask,
  NewUrlMediaTranscript,
  NewWidget,
  PageRow,
  RetryTranscript,
  StepRow,
  TaskRow,
  WhisperModelSize,
  WidgetRow,
  WidgetSettings,
} from "../shared/types";
import {
  currencyForCountry,
  type ExpenseCategoryPatch,
  type ExpensePatch,
  type ExpenseRecurringPatch,
  type ExpenseSettings,
  type NewExpense,
  type NewExpenseCategory,
  type NewExpenseRecurring,
} from "../shared/expenses";
import { pushSnapshot } from "./broadcast";
import {
  createRemoteEvent,
  deleteRemoteEvent,
  respondToEvent,
  updateAccount,
  updateRemoteEvent,
} from "./calendar/actions";
import { readIcsFiles } from "./calendar/importIcs";
import { startReminders } from "./calendar/reminders";
import { destroyCapturePopup, registerCaptureHandlers, startCapture } from "./capture";
import { registerShoppingHandlers } from "./shopping";
import { registerJournalHandlers } from "./journal";
import { registerProjectHandlers } from "./projects";
import { registerStudyHandlers, startStudyAlerts } from "./study";
import { registerBriefingHandlers, startMorningBriefing } from "./briefing";
import { registerTimerHandlers, startTimers } from "./timers";
import { registerMemoryHandlers } from "./memory";
import { registerOnboardingHandlers } from "./onboarding";
import { reschedulePlanAlerts, startPlanAlerts } from "./planAlerts";
import { mainWindow } from "./windows";
import type { PlanBlockInput, PlannerSettings, PlanStatus } from "../shared/planner";
import { rescheduleReminders, startReminderAlerts } from "./reminderAlerts";
import type { NewReminder, ReminderPatch } from "../shared/reminders";
import {
  addCaldavAccount,
  addGoogleAccount,
  addIcsAccount,
  addOutlookAccount,
  addZohoAccount,
  reconnectAccount,
  syncAccount,
  syncAllAccounts,
} from "./calendar/sync";
import * as db from "./db";
import { registerAssistantHandlers } from "./assistant/ipc";
import { registerTutorHandlers } from "./tutor/ipc";
import { registerEmailHandlers, startEmailSync } from "./email/ipc";
import { finishRecording, registerMeetingHandlers } from "./meetings/ipc";
import { deleteMeeting, isRecording, processMeeting, resumeMeetings } from "./meetings/process";
import { startMeetingWatch } from "./meetings/watch";
import { flushPendingDeepLink, setupDeepLinks } from "./deeplink";
import { attachWindow, initSystem, keepRunningInTray, startHidden } from "./system";
import { registerMarketHandlers } from "./widgets/ipc";
import { handleWidgetProtocol, registerWidgetScheme } from "./widgets/protocol";
import { runFileTranscription, runPageExtraction, runUrlMediaTranscription } from "./transcribe/run";

/** Audio and video formats the Transcribe widget accepts (picker and drop). */
const MEDIA_EXTENSIONS = [
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus",
  "mp4", "mov", "mkv", "webm", "avi", "m4v",
];

/** Often enough that a moved meeting is known before its reminder. */
const SYNC_INTERVAL_MS = 5 * 60_000;

const isDev = !app.isPackaged;

// Custom widgets are served from their own scheme; must be declared pre-ready.
registerWidgetScheme();

// Windows ties notifications (and taskbar grouping) to this ID. It must match
// the installer's appId; in dev Electron's own shortcut uses the exe path.
if (process.platform === "win32") {
  app.setAppUserModelId(app.isPackaged ? "com.mypa.desktop" : process.execPath);
}

// A second launch (e.g. from a mypa:// link) hands off to the running app.
if (!setupDeepLinks()) app.quit();

/** Only the microphone (Tutor voice input, the Meeting recorder) and the
 *  computer's sound (the Meeting recorder) are ever requested — deny the
 *  rest, and never grant anything to a custom widget's frame. Copying goes
 *  through Electron's clipboard in the preload (`mypa.copyText`), which needs
 *  no web permission: Electron would ask for clipboard *read* to allow a web
 *  write. */
function applyPermissions(): void {
  const fromWidget = (url: string | undefined) => (url ?? "").startsWith("mypa-widget:");
  const allowed = new Set(["media", "display-capture"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(allowed.has(permission) && !fromWidget(details.requestingUrl)),
  );
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission, requestingOrigin) =>
      allowed.has(permission) && !fromWidget(requestingOrigin),
  );
  // The Meeting recorder asks for the screen only because the web API needs
  // one to give the system's sound ("loopback"); it drops the picture at once.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (fromWidget(request.frame?.url) || !request.audioRequested) {
      callback({});
      return;
    }
    void desktopCapturer
      .getSources({ types: ["screen"] })
      .then((sources) =>
        sources[0] ? callback({ video: sources[0], audio: "loopback" }) : callback({}),
      )
      .catch(() => callback({}));
  });
}

/** Lock the renderer down to local content only (looser in dev so Vite HMR works). */
function applyContentSecurityPolicy(): void {
  const policy = isDev
    ? "default-src 'self' 'unsafe-inline' data: blob:; connect-src 'self' ws: http: https:; img-src 'self' data: blob:; font-src 'self' data:; frame-src mypa-widget:"
    : "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src mypa-widget:";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Widget responses carry their own, stricter policy (see widgets/protocol).
    if (details.url.startsWith("mypa-widget:")) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    });
  });
}

/** Every DB handler runs its mutation, then returns the fresh full snapshot. */
function registerDbHandlers(): void {
  const snap = () => db.getSnapshot();

  ipcMain.handle(IPC.snapshot, () => snap());

  ipcMain.handle(IPC.pageCreate, (_e, input: NewPage) => {
    db.createPage(input);
    return snap();
  });
  ipcMain.handle(
    IPC.pageUpdate,
    (_e, id: string, patch: Partial<Pick<PageRow, "title" | "icon" | "color">>) => {
      db.updatePage(id, patch);
      return snap();
    },
  );
  ipcMain.handle(IPC.pageDelete, (_e, id: string) => {
    db.deletePage(id);
    return snap();
  });
  ipcMain.handle(IPC.pageSetCurrent, (_e, id: string) => {
    db.setCurrentPage(id);
    return snap();
  });

  ipcMain.handle(IPC.widgetCreate, (_e, input: NewWidget) => {
    db.createWidget(input);
    return snap();
  });
  ipcMain.handle(
    IPC.widgetUpdate,
    (_e, id: string, patch: Partial<Pick<WidgetRow, "title" | "x" | "y" | "w" | "h">>) => {
      db.updateWidget(id, patch);
      return snap();
    },
  );
  ipcMain.handle(IPC.widgetSettings, (_e, id: string, settings: WidgetSettings) => {
    db.updateWidgetSettings(id, settings);
    return snap();
  });
  ipcMain.handle(IPC.widgetDelete, (_e, id: string) => {
    db.deleteWidget(id);
    return snap();
  });
  ipcMain.handle(IPC.noteHistory, (_e, widgetId: string) => db.listNoteVersions(widgetId));
  ipcMain.handle(IPC.notesClosed, () => db.listClosedNotes());
  ipcMain.handle(IPC.noteRestore, (_e, widgetId: string, versionId: string) => {
    db.restoreNoteVersion(widgetId, versionId);
    return snap();
  });

  ipcMain.handle(IPC.goalCreate, (_e, input: NewGoal) => {
    db.createGoal(input);
    return snap();
  });
  ipcMain.handle(IPC.goalUpdate, (_e, id: string, patch: Partial<GoalRow>) => {
    db.updateGoal(id, patch);
    return snap();
  });
  ipcMain.handle(IPC.goalDelete, (_e, id: string) => {
    db.deleteGoal(id);
    return snap();
  });

  ipcMain.handle(IPC.taskCreate, (_e, input: NewTask) => {
    db.createTask(input);
    return snap();
  });
  ipcMain.handle(IPC.taskUpdate, (_e, id: string, patch: Partial<TaskRow>) => {
    db.updateTask(id, patch);
    return snap();
  });
  ipcMain.handle(IPC.taskDelete, (_e, id: string) => {
    db.deleteTask(id);
    return snap();
  });

  ipcMain.handle(IPC.stepCreate, (_e, input: NewStep) => {
    db.createStep(input);
    return snap();
  });
  ipcMain.handle(IPC.stepUpdate, (_e, id: string, patch: Partial<StepRow>) => {
    db.updateStep(id, patch);
    return snap();
  });
  ipcMain.handle(IPC.stepDelete, (_e, id: string) => {
    db.deleteStep(id);
    return snap();
  });

  ipcMain.handle(IPC.calendarEventCreate, (_e, input: NewCalendarEvent) => {
    db.createCalendarEvent(input);
    return snap();
  });
  ipcMain.handle(
    IPC.calendarEventUpdate,
    (_e, id: string, patch: Partial<CalendarEventRow>) => {
      db.updateCalendarEvent(id, patch);
      return snap();
    },
  );
  ipcMain.handle(IPC.calendarEventDelete, (_e, id: string) => {
    db.deleteCalendarEvent(id);
    return snap();
  });
  ipcMain.handle(IPC.calendarImportIcs, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Import calendar file",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Calendar (.ics)", extensions: ["ics", "ical", "ifb", "icalendar"] }],
    };
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return { snapshot: snap(), result: null };
    const events = await readIcsFiles(picked.filePaths);
    return { snapshot: snap(), result: db.importCalendarEvents(events) };
  });

  ipcMain.handle(IPC.calendarAccountAddGoogle, async (_e, input: NewGoogleAccount) => {
    await addGoogleAccount(input.label, input.clientId, input.clientSecret);
    return snap();
  });
  ipcMain.handle(IPC.calendarAccountAddOutlook, async (_e, input: NewOutlookAccount) => {
    await addOutlookAccount(input.label, input.clientId);
    return snap();
  });
  ipcMain.handle(IPC.calendarAccountAddIcs, async (_e, input: NewIcsAccount) => {
    await addIcsAccount(input.label, input.feedUrl);
    return snap();
  });
  ipcMain.handle(IPC.calendarAccountReconnect, async (_e, id: string) => {
    await reconnectAccount(id);
    return snap();
  });
  ipcMain.handle(IPC.calendarAccountSync, async (_e, id: string) => {
    await syncAccount(id);
    return snap();
  });
  ipcMain.handle(IPC.calendarAccountRemove, (_e, id: string) => {
    db.deleteCalendarAccount(id);
    return snap();
  });
  ipcMain.handle(IPC.calendarAccountAddZoho, async (_e, input: NewZohoCalendar) => {
    await addZohoAccount(input);
    return snap();
  });
  ipcMain.handle(IPC.calendarAccountAddCaldav, async (_e, input: NewCaldavCalendar) => {
    await addCaldavAccount(input);
    return snap();
  });
  ipcMain.handle(
    IPC.calendarAccountUpdate,
    async (_e, id: string, patch: CalendarAccountPatch) => {
      await updateAccount(id, patch);
      return snap();
    },
  );
  ipcMain.handle(IPC.calendarRemoteCreate, async (_e, input: NewRemoteEvent) => {
    await createRemoteEvent(input);
    return snap();
  });
  ipcMain.handle(IPC.calendarRemoteUpdate, async (_e, id: string, patch: RemoteEventPatch) => {
    await updateRemoteEvent(id, patch);
    return snap();
  });
  ipcMain.handle(IPC.calendarRemoteDelete, async (_e, id: string) => {
    await deleteRemoteEvent(id);
    return snap();
  });
  ipcMain.handle(IPC.calendarRemoteRespond, async (_e, id: string, answer: CalendarRsvp) => {
    await respondToEvent(id, answer);
    return snap();
  });
  ipcMain.handle(IPC.calendarSetReminder, (_e, minutes: number) => {
    db.setCalendarReminder(Number.isFinite(minutes) ? Math.max(-1, Math.round(minutes)) : 10);
    return snap();
  });
  ipcMain.handle(
    IPC.calendarSetGoogleClient,
    (_e, client: { clientId: string; clientSecret: string } | null) => {
      db.setGoogleAppClient(
        client && client.clientId.trim() && client.clientSecret.trim()
          ? { clientId: client.clientId.trim(), clientSecret: client.clientSecret.trim() }
          : null,
      );
      return snap();
    },
  );

  ipcMain.handle(IPC.transcribeFiles, (_e, paths: string[], modelSize: WhisperModelSize) => {
    for (const filePath of paths) {
      if (typeof filePath !== "string" || !isAbsolute(filePath)) continue;
      if (!MEDIA_EXTENSIONS.includes(extname(filePath).slice(1).toLowerCase())) continue;
      const id = db.createTranscriptJob("file", basename(filePath), filePath);
      void runFileTranscription(id, filePath, modelSize);
    }
    return snap();
  });

  ipcMain.handle(IPC.transcriptRename, (_e, id: string, title: string) => {
    const clean = String(title).trim().slice(0, 300);
    if (clean) db.renameTranscript(id, clean);
    return snap();
  });

  ipcMain.handle(IPC.transcriptExport, async (e, id: string) => {
    const row = db.getTranscriptById(id);
    if (!row || row.status !== "done") return false;
    const win = BrowserWindow.fromWebContents(e.sender);
    const safe = row.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120) || "Transcript";
    const options: Electron.SaveDialogOptions = {
      title: "Save transcript",
      defaultPath: `${safe}.txt`,
      filters: [
        { name: "Text", extensions: ["txt"] },
        { name: "Markdown", extensions: ["md"] },
      ],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    const source = row.source ? `Source: ${row.source}\n\n` : "";
    const body = result.filePath.toLowerCase().endsWith(".md")
      ? `# ${row.title}\n\n${source}${row.text}\n`
      : `${row.text}\n`;
    await writeFile(result.filePath, body, "utf8");
    return true;
  });

  ipcMain.handle(IPC.transcribePickFile, async (e, modelSize: WhisperModelSize) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Choose an audio or video file",
      properties: ["openFile"],
      filters: [
        {
          name: "Audio or video",
          extensions: MEDIA_EXTENSIONS,
        },
      ],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return snap();
    const id = db.createTranscriptJob("file", basename(filePath), filePath);
    void runFileTranscription(id, filePath, modelSize);
    return snap();
  });

  ipcMain.handle(IPC.transcribeUrlMedia, (_e, input: NewUrlMediaTranscript) => {
    const id = db.createTranscriptJob("url_media", input.url, input.url);
    void runUrlMediaTranscription(id, input.url, input.modelSize, input.ytdlpPath);
    return snap();
  });

  ipcMain.handle(IPC.transcribePage, (_e, input: NewPageTranscript) => {
    const id = db.createTranscriptJob("page", input.url, input.url);
    void runPageExtraction(id, input.url);
    return snap();
  });

  ipcMain.handle(IPC.transcriptDelete, async (_e, id: string) => {
    // a meeting's audio goes with it
    if (db.getTranscriptById(id)?.kind === "meeting") await deleteMeeting(id);
    else db.deleteTranscript(id);
    return snap();
  });

  ipcMain.handle(IPC.transcriptRetry, (_e, input: RetryTranscript) => {
    const row = db.getTranscriptById(input.id);
    if (!row || row.status === "recording") return snap();
    db.resetTranscriptForRetry(input.id);
    if (row.kind === "meeting") {
      void processMeeting(input.id);
    } else if (row.kind === "file") {
      void runFileTranscription(input.id, row.source, input.modelSize);
    } else if (row.kind === "url_media") {
      void runUrlMediaTranscription(input.id, row.source, input.modelSize, input.ytdlpPath);
    } else {
      void runPageExtraction(input.id, row.source);
    }
    return snap();
  });

  ipcMain.handle(IPC.setMeta, (_e, key: "carryOver", value: boolean) => {
    db.setMeta(key, value);
    return snap();
  });

  // Reminders: every write re-times the next alert.
  const reminderWrite = <T>(fn: () => T) => {
    fn();
    rescheduleReminders();
    return snap();
  };
  ipcMain.handle(IPC.reminderCreate, (_e, input: NewReminder) =>
    reminderWrite(() => db.createReminder(input)),
  );
  ipcMain.handle(IPC.reminderUpdate, (_e, id: string, patch: ReminderPatch) =>
    reminderWrite(() => db.updateReminder(String(id), patch ?? {})),
  );
  ipcMain.handle(IPC.reminderComplete, (_e, id: string, done: boolean) =>
    reminderWrite(() => db.completeReminder(String(id), done === true)),
  );
  ipcMain.handle(IPC.reminderSnooze, (_e, id: string, until: number | null) =>
    reminderWrite(() => db.snoozeReminder(String(id), until)),
  );
  ipcMain.handle(IPC.reminderDelete, (_e, ids: string[]) =>
    reminderWrite(() => db.deleteReminders(Array.isArray(ids) ? ids.map(String) : [])),
  );

  const planWrite = (fn: () => void) => {
    fn();
    reschedulePlanAlerts();
    return snap();
  };
  ipcMain.handle(IPC.planSave, (_e, day: string, blocks: PlanBlockInput[]) =>
    planWrite(() => db.savePlanBlocks(String(day), blocks)),
  );
  ipcMain.handle(IPC.planDay, (_e, day: string, patch: { status?: PlanStatus; intention?: string }) =>
    planWrite(() => db.setPlanDay(String(day), patch ?? {})),
  );
  ipcMain.handle(IPC.plannerSettings, (_e, patch: Partial<PlannerSettings>) =>
    planWrite(() => db.setPlannerSettings(patch ?? {})),
  );

  ipcMain.handle(IPC.expenseCreate, (_e, input: NewExpense) => {
    db.createExpense(input);
    return snap();
  });
  ipcMain.handle(IPC.expenseUpdate, (_e, id: string, patch: ExpensePatch) => {
    db.updateExpense(id, patch);
    return snap();
  });
  ipcMain.handle(IPC.expenseDelete, (_e, ids: string[]) => {
    db.deleteExpenses(Array.isArray(ids) ? ids.map(String) : []);
    return snap();
  });
  ipcMain.handle(IPC.expenseCategoryCreate, (_e, input: NewExpenseCategory) => {
    db.createExpenseCategory(input);
    return snap();
  });
  ipcMain.handle(IPC.expenseCategoryUpdate, (_e, id: string, patch: ExpenseCategoryPatch) => {
    db.updateExpenseCategory(id, patch);
    return snap();
  });
  ipcMain.handle(IPC.expenseCategoryDelete, (_e, id: string, moveTo?: string) => {
    db.deleteExpenseCategory(id, moveTo);
    return snap();
  });
  ipcMain.handle(IPC.expenseBillCreate, (_e, input: NewExpenseRecurring) => {
    db.createExpenseRecurring(input);
    return snap();
  });
  ipcMain.handle(IPC.expenseBillUpdate, (_e, id: string, patch: ExpenseRecurringPatch) => {
    db.updateExpenseRecurring(id, patch);
    return snap();
  });
  ipcMain.handle(IPC.expenseBillDelete, (_e, id: string) => {
    db.deleteExpenseRecurring(id);
    return snap();
  });
  ipcMain.handle(IPC.expenseSettings, (_e, patch: Partial<ExpenseSettings>) => {
    db.setExpenseSettings(patch);
    return snap();
  });
  ipcMain.handle(IPC.expenseExport, async (e, csv: string, name: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const safe = String(name).replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120) || "Expenses";
    const options: Electron.SaveDialogOptions = {
      title: "Export expenses",
      defaultPath: `${safe}.csv`,
      filters: [{ name: "Spreadsheet (CSV)", extensions: ["csv"] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    // A byte-order mark so Excel reads currency symbols and accents correctly.
    await writeFile(result.filePath, `﻿${String(csv)}`, "utf8");
    return true;
  });
}

/** Bills fall due at midnight; check every half hour so an always-open app
 *  posts them without a restart. */
function startBillPosting(): void {
  setInterval(() => {
    if (db.postDueBills() > 0) pushSnapshot();
  }, 30 * 60_000);
}

function startCalendarSync(): void {
  void syncAllAccounts().then(pushSnapshot);
  setInterval(() => void syncAllAccounts().then(pushSnapshot), SYNC_INTERVAL_MS);
}

function registerWindowHandlers(): void {
  ipcMain.on(IPC.winMinimize, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.on(IPC.winMaximizeToggle, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(IPC.winClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle(
    IPC.winIsMaximized,
    (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false,
  );
}

/** `hidden` keeps the window in the tray (started at sign-in) until opened. */
function createWindow(hidden = false): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 820,
    minHeight: 540,
    title: "myPA",
    icon,
    frame: false,
    backgroundColor: "#f2f2f2",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (!hidden) window.once("ready-to-show", () => window.show());
  // the capture box is a hidden window; it mustn't keep the app alive on its own
  window.on("closed", () => {
    if (!mainWindow()) destroyCapturePopup();
  });
  attachWindow(window);
  // Closing for good mid-meeting: save the recording first.
  window.on("close", (e) => {
    if (!isRecording() || keepRunningInTray()) return;
    e.preventDefault();
    void finishRecording().then(() => {
      if (!window.isDestroyed()) window.destroy();
    });
  });

  const emitMaximize = () =>
    window.webContents.send(IPC.winMaximizeChanged, window.isMaximized());
  window.on("maximize", emitMaximize);
  window.on("unmaximize", emitMaximize);

  window.webContents.setWindowOpenHandler(({ url }) => {
    // links from emails and widgets: only web pages and mail addresses leave the app
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return window;
}

app.whenReady().then(async () => {
  await db.initDb(join(app.getPath("userData"), "mypa.db"));
  // Start Expenses in the currency of the computer's region.
  if (!db.hasExpenseCurrency()) {
    db.setExpenseSettings({ currency: currencyForCountry(app.getLocaleCountryCode()) });
  }
  applyPermissions();
  applyContentSecurityPolicy();
  registerWindowHandlers();
  registerDbHandlers();
  registerCaptureHandlers(() => db.getSnapshot());
  registerShoppingHandlers(() => db.getSnapshot());
  registerJournalHandlers(() => db.getSnapshot());
  registerProjectHandlers(() => db.getSnapshot());
  registerStudyHandlers(() => db.getSnapshot());
  registerBriefingHandlers(() => db.getSnapshot());
  registerTimerHandlers(() => db.getSnapshot());
  registerMemoryHandlers(() => db.getSnapshot());
  registerOnboardingHandlers(() => db.getSnapshot());
  registerTutorHandlers();
  registerAssistantHandlers();
  registerEmailHandlers();
  registerMeetingHandlers();
  handleWidgetProtocol();
  registerMarketHandlers();
  ipcMain.handle(IPC.getVersion, () => app.getVersion());

  initSystem({ createWindow: () => createWindow(), icon });

  createWindow(startHidden());
  flushPendingDeepLink();
  startCalendarSync();
  startBillPosting();
  startReminders();
  startReminderAlerts();
  startPlanAlerts();
  startStudyAlerts();
  startMorningBriefing();
  startTimers();
  startCapture();
  startEmailSync();
  resumeMeetings();
  startMeetingWatch();

  app.on("activate", () => {
    if (!mainWindow()) createWindow();
  });
});

app.on("before-quit", (e) => {
  if (isRecording()) {
    // quitting from the tray mid-meeting: save the recording, then quit
    e.preventDefault();
    void finishRecording().then(() => app.quit());
    return;
  }
  db.flush();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !keepRunningInTray()) app.quit();
});
