import { writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";

import icon from "../../resources/icon.png?asset";
import { IPC } from "../shared/api";
import type {
  CalendarEventRow,
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
import { pushSnapshot } from "./broadcast";
import {
  addGoogleAccount,
  addIcsAccount,
  addOutlookAccount,
  reconnectAccount,
  syncAccount,
  syncAllAccounts,
} from "./calendar/sync";
import * as db from "./db";
import { registerTutorHandlers } from "./tutor/ipc";
import { flushPendingDeepLink, setupDeepLinks } from "./deeplink";
import { registerMarketHandlers } from "./widgets/ipc";
import { handleWidgetProtocol, registerWidgetScheme } from "./widgets/protocol";
import { runFileTranscription, runPageExtraction, runUrlMediaTranscription } from "./transcribe/run";

/** Audio and video formats the Transcribe widget accepts (picker and drop). */
const MEDIA_EXTENSIONS = [
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus",
  "mp4", "mov", "mkv", "webm", "avi", "m4v",
];

const SYNC_INTERVAL_MS = 20 * 60_000;

const isDev = !app.isPackaged;

// Custom widgets are served from their own scheme; must be declared pre-ready.
registerWidgetScheme();

// A second launch (e.g. from a mypa:// link) hands off to the running app.
if (!setupDeepLinks()) app.quit();

/** Only the microphone (Tutor voice input) is ever requested — deny the rest,
 *  and never grant anything to a custom widget's frame. Copying goes through
 *  Electron's clipboard in the preload (`mypa.copyText`), which needs no web
 *  permission: Electron would ask for clipboard *read* to allow a web write. */
function applyPermissions(): void {
  const fromWidget = (url: string | undefined) => (url ?? "").startsWith("mypa-widget:");
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(permission === "media" && !fromWidget(details.requestingUrl)),
  );
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission, requestingOrigin) =>
      permission === "media" && !fromWidget(requestingOrigin),
  );
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

  ipcMain.handle(IPC.transcriptDelete, (_e, id: string) => {
    db.deleteTranscript(id);
    return snap();
  });

  ipcMain.handle(IPC.transcriptRetry, (_e, input: RetryTranscript) => {
    const row = db.getTranscriptById(input.id);
    if (!row) return snap();
    db.resetTranscriptForRetry(input.id);
    if (row.kind === "file") {
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

function createWindow(): void {
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

  window.once("ready-to-show", () => window.show());

  const emitMaximize = () =>
    window.webContents.send(IPC.winMaximizeChanged, window.isMaximized());
  window.on("maximize", emitMaximize);
  window.on("unmaximize", emitMaximize);

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  await db.initDb(join(app.getPath("userData"), "mypa.db"));
  applyPermissions();
  applyContentSecurityPolicy();
  registerWindowHandlers();
  registerDbHandlers();
  registerTutorHandlers();
  handleWidgetProtocol();
  registerMarketHandlers();
  ipcMain.handle(IPC.getVersion, () => app.getVersion());

  createWindow();
  flushPendingDeepLink();
  startCalendarSync();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => db.flush());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
