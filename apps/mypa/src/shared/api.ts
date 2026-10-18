/** Contract shared between the main process, the preload bridge and the renderer. */

import type { MypaMarket } from "./marketApi";
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
  Snapshot,
  StepRow,
  TaskRow,
  WhisperModelSize,
  WidgetRow,
  WidgetSettings,
} from "./types";
import type { MypaAssistant } from "./assistant";
import type { MypaTutor } from "./tutor";
import type { MypaSystem } from "./system";

export const IPC = {
  getVersion: "app:getVersion",

  winMinimize: "win:minimize",
  winMaximizeToggle: "win:maximizeToggle",
  winClose: "win:close",
  winIsMaximized: "win:isMaximized",
  winMaximizeChanged: "win:maximizeChanged",

  snapshot: "db:snapshot",

  pageCreate: "db:page:create",
  pageUpdate: "db:page:update",
  pageDelete: "db:page:delete",
  pageSetCurrent: "db:page:setCurrent",

  widgetCreate: "db:widget:create",
  widgetUpdate: "db:widget:update",
  widgetSettings: "db:widget:settings",
  widgetDelete: "db:widget:delete",

  goalCreate: "db:goal:create",
  goalUpdate: "db:goal:update",
  goalDelete: "db:goal:delete",

  taskCreate: "db:task:create",
  taskUpdate: "db:task:update",
  taskDelete: "db:task:delete",

  stepCreate: "db:step:create",
  stepUpdate: "db:step:update",
  stepDelete: "db:step:delete",

  calendarEventCreate: "db:calendar:event:create",
  calendarEventUpdate: "db:calendar:event:update",
  calendarEventDelete: "db:calendar:event:delete",

  calendarAccountAddGoogle: "db:calendar:account:addGoogle",
  calendarAccountAddOutlook: "db:calendar:account:addOutlook",
  calendarAccountAddIcs: "db:calendar:account:addIcs",
  calendarAccountReconnect: "db:calendar:account:reconnect",
  calendarAccountSync: "db:calendar:account:sync",
  calendarAccountRemove: "db:calendar:account:remove",

  transcribePickFile: "transcribe:pickFile",
  transcribeUrlMedia: "transcribe:urlMedia",
  transcribePage: "transcribe:page",
  transcriptDelete: "transcribe:delete",
  transcriptRetry: "transcribe:retry",
  transcribeFiles: "transcribe:files",
  transcriptRename: "transcribe:rename",
  transcriptExport: "transcribe:export",

  setMeta: "db:meta:set",

  /** Pushed by main after a background calendar sync or transcription progress
   *  update — not a request/response call. */
  snapshotChanged: "db:snapshot:changed",
} as const;

/** Every mutation resolves to the fresh full snapshot — cheap for a local DB. */
export interface MypaDb {
  snapshot: () => Promise<Snapshot>;

  createPage: (input: NewPage) => Promise<Snapshot>;
  updatePage: (
    id: string,
    patch: Partial<Pick<PageRow, "title" | "icon" | "color">>,
  ) => Promise<Snapshot>;
  /** Refuses (no-op) to delete the last remaining page. */
  deletePage: (id: string) => Promise<Snapshot>;
  setCurrentPage: (id: string) => Promise<Snapshot>;

  createWidget: (input: NewWidget) => Promise<Snapshot>;
  updateWidget: (
    id: string,
    patch: Partial<Pick<WidgetRow, "title" | "x" | "y" | "w" | "h">>,
  ) => Promise<Snapshot>;
  updateWidgetSettings: (id: string, settings: WidgetSettings) => Promise<Snapshot>;
  deleteWidget: (id: string) => Promise<Snapshot>;

  createGoal: (input: NewGoal) => Promise<Snapshot>;
  updateGoal: (id: string, patch: Partial<GoalRow>) => Promise<Snapshot>;
  deleteGoal: (id: string) => Promise<Snapshot>;

  createTask: (input: NewTask) => Promise<Snapshot>;
  updateTask: (id: string, patch: Partial<TaskRow>) => Promise<Snapshot>;
  deleteTask: (id: string) => Promise<Snapshot>;

  createStep: (input: NewStep) => Promise<Snapshot>;
  updateStep: (id: string, patch: Partial<StepRow>) => Promise<Snapshot>;
  deleteStep: (id: string) => Promise<Snapshot>;

  createCalendarEvent: (input: NewCalendarEvent) => Promise<Snapshot>;
  updateCalendarEvent: (id: string, patch: Partial<CalendarEventRow>) => Promise<Snapshot>;
  deleteCalendarEvent: (id: string) => Promise<Snapshot>;

  /** Each resolves once the sign-in / fetch attempt finishes — success or failure is
   *  reported on the account's `status`/`errorMessage` in the returned snapshot,
   *  the promise itself does not reject. */
  addGoogleCalendar: (input: NewGoogleAccount) => Promise<Snapshot>;
  addOutlookCalendar: (input: NewOutlookAccount) => Promise<Snapshot>;
  addIcsCalendar: (input: NewIcsAccount) => Promise<Snapshot>;
  reconnectCalendarAccount: (id: string) => Promise<Snapshot>;
  syncCalendarAccount: (id: string) => Promise<Snapshot>;
  removeCalendarAccount: (id: string) => Promise<Snapshot>;

  /** Opens a native file picker; resolves immediately with a "pending" record
   *  once a file's chosen (or the unchanged snapshot if cancelled) — the
   *  transcription itself runs in the background and streams progress via
   *  `onSnapshotChanged`, it is not awaited here. */
  pickAndTranscribeFile: (modelSize: WhisperModelSize) => Promise<Snapshot>;
  transcribeUrlMedia: (input: NewUrlMediaTranscript) => Promise<Snapshot>;
  transcribePage: (input: NewPageTranscript) => Promise<Snapshot>;
  deleteTranscript: (id: string) => Promise<Snapshot>;
  retryTranscript: (input: RetryTranscript) => Promise<Snapshot>;
  /** Transcribe files dropped on the widget (absolute paths from `pathForFile`). */
  transcribeFiles: (paths: string[], modelSize: WhisperModelSize) => Promise<Snapshot>;
  renameTranscript: (id: string, title: string) => Promise<Snapshot>;
  /** Asks where to save, then writes the text. Resolves false if cancelled. */
  exportTranscript: (id: string) => Promise<boolean>;
  /** The on-disk path of a dropped File (Electron's webUtils). */
  pathForFile: (file: File) => string;

  setMeta: (key: "carryOver", value: boolean) => Promise<Snapshot>;

  /** Subscribe to background syncs / transcription progress; returns an
   *  unsubscribe fn. */
  onSnapshotChanged: (cb: (snapshot: Snapshot) => void) => () => void;
}

export interface MypaWin {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  /** Subscribe to maximize/unmaximize; returns an unsubscribe fn. */
  onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
}

export interface MypaApi {
  getVersion: () => Promise<string>;
  /** Copies text with Electron's clipboard (no web permission involved). */
  copyText: (text: string) => void;
  win: MypaWin;
  db: MypaDb;
  tutor: MypaTutor;
  assistant: MypaAssistant;
  market: MypaMarket;
  system: MypaSystem;
}
