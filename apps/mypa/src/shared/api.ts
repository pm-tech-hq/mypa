import type { ShoppingItem, ShoppingSettings } from "./shopping";
import type { MemoryKind, MemoryRecord } from "./memory";
import type { JournalEntry, JournalSettings, Mood } from "./journal";
import type { StarterPlan, StarterResult } from "./onboarding";
import type { BoardColumn, ProjectPatch } from "./projects";
import type { BriefingSettings } from "./briefing";
import type { TimerAction, TimerKind, TimerRow, TimerSettings } from "./timers";
import type { ExamPatch, SessionInput, SessionPatch, StudySession, StudySettings, SubjectPatch } from "./study";
import type { CaptureKind, CaptureSettings } from "./capture";
import type { PlanBlockInput, PlannerSettings, PlanStatus } from "./planner";
/** Contract shared between the main process, the preload bridge and the renderer. */

import type {
  ExpenseCategoryPatch,
  ExpensePatch,
  ExpenseRecurringPatch,
  ExpenseSettings,
  NewExpense,
  NewExpenseCategory,
  NewExpenseRecurring,
} from "./expenses";
import type { MypaMarket } from "./marketApi";
import type { NewReminder, ReminderPatch } from "./reminders";
import type {
  CalendarAccountPatch,
  CalendarEventRow,
  CalendarRsvp,
  GoalRow,
  NewCaldavCalendar,
  NewRemoteEvent,
  NewZohoCalendar,
  RemoteEventPatch,
  NewCalendarEvent,
  IcsImportResult,
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
  NoteVersion,
  ClosedNote,
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
import type { MypaEmail } from "./email";
import type { MypaMeetings } from "./meetings";
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
  noteHistory: "db:note:history",
  noteRestore: "db:note:restore",
  notesClosed: "db:note:closed",

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
  calendarImportIcs: "db:calendar:importIcs",

  calendarAccountAddGoogle: "db:calendar:account:addGoogle",
  calendarAccountAddOutlook: "db:calendar:account:addOutlook",
  calendarAccountAddIcs: "db:calendar:account:addIcs",
  calendarAccountReconnect: "db:calendar:account:reconnect",
  calendarAccountSync: "db:calendar:account:sync",
  calendarAccountRemove: "db:calendar:account:remove",
  calendarAccountAddZoho: "db:calendar:account:addZoho",
  calendarAccountAddCaldav: "db:calendar:account:addCaldav",
  calendarAccountUpdate: "db:calendar:account:update",
  calendarRemoteCreate: "db:calendar:remote:create",
  calendarRemoteUpdate: "db:calendar:remote:update",
  calendarRemoteDelete: "db:calendar:remote:delete",
  calendarRemoteRespond: "db:calendar:remote:respond",
  calendarSetReminder: "db:calendar:reminder",
  calendarSetGoogleClient: "db:calendar:googleClient",
  /** Pushed by main when a reminder is clicked: show this event. */
  calendarFocus: "calendar:focus",

  transcribePickFile: "transcribe:pickFile",
  transcribeUrlMedia: "transcribe:urlMedia",
  transcribePage: "transcribe:page",
  transcriptDelete: "transcribe:delete",
  transcriptRetry: "transcribe:retry",
  transcribeFiles: "transcribe:files",
  transcriptRename: "transcribe:rename",
  transcriptExport: "transcribe:export",

  setMeta: "db:meta:set",

  expenseCreate: "db:expense:create",
  expenseUpdate: "db:expense:update",
  expenseDelete: "db:expense:delete",
  expenseCategoryCreate: "db:expense:category:create",
  expenseCategoryUpdate: "db:expense:category:update",
  expenseCategoryDelete: "db:expense:category:delete",
  expenseBillCreate: "db:expense:bill:create",
  expenseBillUpdate: "db:expense:bill:update",
  expenseBillDelete: "db:expense:bill:delete",
  expenseSettings: "db:expense:settings",
  expenseExport: "db:expense:export",

  reminderCreate: "db:reminder:create",
  reminderUpdate: "db:reminder:update",
  reminderComplete: "db:reminder:complete",
  reminderSnooze: "db:reminder:snooze",
  reminderDelete: "db:reminder:delete",
  shopListCreate: "db:shop:list-create",
  shopListRename: "db:shop:list-rename",
  shopListDelete: "db:shop:list-delete",
  shopAdd: "db:shop:add",
  shopUpdate: "db:shop:update",
  shopPut: "db:shop:put",
  shopDelete: "db:shop:delete",
  shopCheckAll: "db:shop:check-all",
  shopFinish: "db:shop:finish",
  shopForget: "db:shop:forget",
  shopSettings: "db:shop:settings",

  journalSave: "db:journal:save",
  journalDelete: "db:journal:delete",
  journalPut: "db:journal:put",
  journalUnlock: "db:journal:unlock",
  journalLock: "db:journal:lock",
  journalPasscode: "db:journal:passcode",
  journalErase: "db:journal:erase",
  journalVerifyMethod: "db:journal:verify-method",
  onboardingApply: "db:onboarding:apply",
  onboardingSet: "db:onboarding:set",
  userNameSet: "db:profile:name",
  journalResetWithOs: "db:journal:reset-with-os",
  journalSettings: "db:journal:settings",
  journalExport: "db:journal:export",
  journalTouch: "journal:touch",

  projCreate: "db:proj:create",
  projUpdate: "db:proj:update",
  projDelete: "db:proj:delete",
  projMoveTask: "db:proj:move-task",

  studySubject: "db:study:subject",
  studySubjectDelete: "db:study:subject-delete",
  studyExam: "db:study:exam",
  studyExamDelete: "db:study:exam-delete",
  studyAdd: "db:study:add",
  studyUpdate: "db:study:update",
  studyDelete: "db:study:delete",
  studyPut: "db:study:put",
  studySettings: "db:study:settings",

  briefingWrite: "db:briefing:write",
  briefingClear: "db:briefing:clear",
  briefingSettings: "db:briefing:settings",
  briefingFocus: "briefing:focus",

  memoryAdd: "db:memory:add",
  memoryUpdate: "db:memory:update",
  memoryDelete: "db:memory:delete",
  memoryPut: "db:memory:put",
  timerCreate: "db:timer:create",
  timerAction: "db:timer:action",
  timerUpdate: "db:timer:update",
  timerDelete: "db:timer:delete",
  timerPut: "db:timer:put",
  timerSettings: "db:timer:settings",
  /** A timer ended (id, and whether its notification was clicked). */
  timerFired: "timer:fired",

  captureSave: "db:capture:save",
  captureConvert: "db:capture:convert",
  captureDelete: "db:capture:delete",
  captureDone: "db:capture:done",
  captureToNote: "db:capture:to-note",
  captureSettings: "db:capture:settings",
  captureHotkeyStatus: "capture:hotkey-status",
  /** Pop-up box: hide it / bring the main window up / fit its height. */
  captureHide: "capture:hide",
  captureOpenMain: "capture:open-main",
  captureResize: "capture:resize",
  /** Pushed to the pop-up box each time it opens. */
  captureShown: "capture:shown",

  planSave: "db:plan:save",
  planDay: "db:plan:day",
  plannerSettings: "db:plan:settings",

  /** Pushed by main when a reminder notification is clicked: show this reminder. */
  reminderFocus: "reminder:focus",

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
  /** A note widget's saved versions, newest (the current text) first. */
  noteHistory: (widgetId: string) => Promise<NoteVersion[]>;
  /** Accepts a closed note's version too (see `closedNotes`). */
  restoreNoteVersion: (widgetId: string, versionId: string) => Promise<Snapshot>;
  /** Notes whose widget was closed, newest first. */
  closedNotes: () => Promise<ClosedNote[]>;

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
  /** Asks for .ics files and copies their events into the local calendar.
   *  `result` is null when the picker was cancelled; rejects if a file can't be read. */
  importIcsFile: () => Promise<{ snapshot: Snapshot; result: IcsImportResult | null }>;

  /** Each resolves once the sign-in / fetch attempt finishes — success or failure is
   *  reported on the account's `status`/`errorMessage` in the returned snapshot,
   *  the promise itself does not reject. */
  addGoogleCalendar: (input: NewGoogleAccount) => Promise<Snapshot>;
  addOutlookCalendar: (input: NewOutlookAccount) => Promise<Snapshot>;
  addIcsCalendar: (input: NewIcsAccount) => Promise<Snapshot>;
  reconnectCalendarAccount: (id: string) => Promise<Snapshot>;
  syncCalendarAccount: (id: string) => Promise<Snapshot>;
  removeCalendarAccount: (id: string) => Promise<Snapshot>;
  addZohoCalendar: (input: NewZohoCalendar) => Promise<Snapshot>;
  addCaldavCalendar: (input: NewCaldavCalendar) => Promise<Snapshot>;
  updateCalendarAccount: (id: string, patch: CalendarAccountPatch) => Promise<Snapshot>;

  /** Changes in a connected calendar. These reject with a readable message when
   *  the provider refuses (no permission, offline…). */
  createRemoteEvent: (input: NewRemoteEvent) => Promise<Snapshot>;
  updateRemoteEvent: (id: string, patch: RemoteEventPatch) => Promise<Snapshot>;
  deleteRemoteEvent: (id: string) => Promise<Snapshot>;
  respondToEvent: (id: string, answer: CalendarRsvp) => Promise<Snapshot>;
  /** Minutes before meetings to remind you; -1 turns reminders off. */
  setCalendarReminder: (minutes: number) => Promise<Snapshot>;
  /** Your own Google OAuth client, for copies of myPA built without one; null removes it. */
  setGoogleClient: (client: { clientId: string; clientSecret: string } | null) => Promise<Snapshot>;
  /** A reminder was clicked: the Calendar widget shows that event. */
  onCalendarFocus: (cb: (eventId: string) => void) => () => void;

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

  /** Expenses. Writes reject with a readable message (no amount, no name…). */
  createExpense: (input: NewExpense) => Promise<Snapshot>;
  updateExpense: (id: string, patch: ExpensePatch) => Promise<Snapshot>;
  deleteExpenses: (ids: string[]) => Promise<Snapshot>;
  createExpenseCategory: (input: NewExpenseCategory) => Promise<Snapshot>;
  updateExpenseCategory: (id: string, patch: ExpenseCategoryPatch) => Promise<Snapshot>;
  /** Moves its spending and bills to `moveTo` (default Other). */
  deleteExpenseCategory: (id: string, moveTo?: string) => Promise<Snapshot>;
  createExpenseBill: (input: NewExpenseRecurring) => Promise<Snapshot>;
  updateExpenseBill: (id: string, patch: ExpenseRecurringPatch) => Promise<Snapshot>;
  deleteExpenseBill: (id: string) => Promise<Snapshot>;
  setExpenseSettings: (patch: Partial<ExpenseSettings>) => Promise<Snapshot>;
  /** Asks where to save the CSV, then writes it. Resolves false if cancelled. */
  exportExpenses: (csv: string, name: string) => Promise<boolean>;

  /** Reminders. Writes reject with a readable message (no title…). */
  createReminder: (input: NewReminder) => Promise<Snapshot>;
  updateReminder: (id: string, patch: ReminderPatch) => Promise<Snapshot>;
  /** A repeating reminder moves to its next date instead of finishing. */
  completeReminder: (id: string, done: boolean) => Promise<Snapshot>;
  /** null = cancel the snooze. */
  snoozeReminder: (id: string, until: number | null) => Promise<Snapshot>;
  deleteReminders: (ids: string[]) => Promise<Snapshot>;
  onReminderFocus: (cb: (id: string) => void) => () => void;

  /** Personal Memory. */
  addMemory: (input: { text: string; kind?: MemoryKind | null }) => Promise<{ id: string; created: boolean; snapshot: Snapshot }>;
  updateMemory: (
    id: string,
    patch: Partial<Pick<MemoryRecord, "text" | "kind" | "assistantCanUse" | "pinned" | "reviewed">>,
  ) => Promise<Snapshot>;
  deleteMemories: (ids: string[]) => Promise<Snapshot>;
  putMemories: (list: MemoryRecord[]) => Promise<Snapshot>;
  /** Shopping Lists. */
  createShoppingList: (name: string) => Promise<{ id: string; snapshot: Snapshot }>;
  renameShoppingList: (id: string, name: string) => Promise<Snapshot>;
  deleteShoppingList: (id: string) => Promise<Snapshot>;
  /** Adds typed items (merging with ones already there); rejects with a readable message. */
  addShopping: (
    listId: string,
    text: string,
  ) => Promise<{ created: string[]; changed: string[]; names: string[]; snapshot: Snapshot }>;
  updateShoppingItem: (id: string, patch: Partial<ShoppingItem>) => Promise<Snapshot>;
  putShoppingItems: (items: ShoppingItem[]) => Promise<Snapshot>;
  deleteShoppingItems: (ids: string[]) => Promise<Snapshot>;
  checkAllShopping: (listId: string, checked: boolean) => Promise<Snapshot>;
  finishShopping: (
    listId: string,
    expense: { amount: number; categoryId: string; note: string } | null,
  ) => Promise<Snapshot>;
  forgetShopping: (name: string) => Promise<Snapshot>;
  setShoppingSettings: (patch: Partial<ShoppingSettings>) => Promise<Snapshot>;

  /** Journal. Writes reject with "The journal is locked." while it is. */
  saveJournal: (day: string, patch: { body?: string; mood?: Mood | null; prompt?: string }) => Promise<Snapshot>;
  deleteJournal: (days: string[]) => Promise<Snapshot>;
  putJournal: (entries: JournalEntry[]) => Promise<Snapshot>;
  /** false = wrong passcode. */
  unlockJournal: (code: string) => Promise<{ ok: boolean; snapshot: Snapshot }>;
  lockJournal: () => Promise<Snapshot>;
  /** Set, change or (empty `next`) remove the passcode; rejects with a readable message. */
  setJournalPasscode: (current: string, next: string) => Promise<Snapshot>;
  /** Forgot the passcode: deletes every entry. */
  eraseJournal: () => Promise<Snapshot>;
  /** How this computer can confirm it's you (Windows Hello / Touch ID), or null. */
  journalVerifyMethod: () => Promise<"windows-hello" | "touch-id" | null>;
  /** Forgot the passcode: asks the OS to confirm it's you, then removes the passcode and keeps every entry. */
  resetJournalWithOs: () => Promise<{ ok: boolean; snapshot: Snapshot }>;
  /** Welcome guide: builds the picked starter pages. */
  applyStarterPlan: (plan: StarterPlan) => Promise<{ result: StarterResult; snapshot: Snapshot }>;
  /** Welcome guide: true shows it again, false marks it finished. */
  setOnboarding: (show: boolean) => Promise<Snapshot>;
  /** What myPA calls the user; empty clears it. */
  setUserName: (name: string) => Promise<Snapshot>;
  setJournalSettings: (patch: Partial<JournalSettings>) => Promise<Snapshot>;
  /** Saves the whole journal as Markdown; false if cancelled. */
  exportJournal: () => Promise<boolean>;
  /** Typing in the journal: keeps the idle lock from firing. */
  touchJournal: () => void;

  /** Project Tracker. Writes reject with a readable message (name taken…). */
  createProject: (name: string, patch?: ProjectPatch) => Promise<{ id: string; snapshot: Snapshot }>;
  updateProject: (id: string, patch: ProjectPatch) => Promise<Snapshot>;
  /** Deletes the project and its tasks; its goals stay without a project. */
  deleteProject: (id: string) => Promise<Snapshot>;
  /** Moves a task to a board column, optionally to a position (its new `sort`). */
  moveTask: (taskId: string, col: BoardColumn, sort?: number) => Promise<Snapshot>;

  /** Study Planner. Session writes reject with a readable message when they'd
   *  clash with an event, the day plan or another session. */
  saveSubject: (id: string | null, patch: SubjectPatch & { name?: string }) => Promise<{ id: string; snapshot: Snapshot }>;
  /** Deletes the subject with its exams and sessions. */
  deleteSubject: (id: string) => Promise<Snapshot>;
  saveExam: (id: string | null, patch: ExamPatch) => Promise<{ id: string; snapshot: Snapshot }>;
  deleteExam: (id: string) => Promise<Snapshot>;
  addSessions: (list: SessionInput[]) => Promise<{ ids: string[]; snapshot: Snapshot }>;
  updateSession: (id: string, patch: SessionPatch) => Promise<Snapshot>;
  deleteSessions: (ids: string[]) => Promise<Snapshot>;
  /** Restores sessions exactly (undo). */
  putSessions: (list: StudySession[]) => Promise<Snapshot>;
  setStudySettings: (patch: Partial<StudySettings>) => Promise<Snapshot>;

  /** Daily Briefing. Writing rejects with a readable message (no model, or it
   *  mentioned something that isn't in your data). */
  writeBriefing: () => Promise<Snapshot>;
  clearBriefing: () => Promise<Snapshot>;
  setBriefingSettings: (patch: Partial<BriefingSettings>) => Promise<Snapshot>;
  /** The morning notification was clicked. */
  onBriefingFocus: (cb: () => void) => () => void;

  /** Timer & Stopwatch. All times are worked out in main with one clock. */
  createTimer: (input: { kind?: TimerKind; label?: string; durationMs?: number; start?: boolean }) => Promise<{ id: string; snapshot: Snapshot }>;
  timerAction: (id: string, action: TimerAction) => Promise<Snapshot>;
  updateTimer: (id: string, patch: { label?: string; durationMs?: number }) => Promise<Snapshot>;
  deleteTimer: (id: string) => Promise<Snapshot>;
  putTimer: (row: TimerRow) => Promise<Snapshot>;
  setTimerSettings: (patch: Partial<TimerSettings>) => Promise<Snapshot>;
  onTimerFired: (cb: (id: string, clicked: boolean) => void) => () => void;

  /** Quick Capture. Saving reads the text for what it is unless `kind` is given;
   *  it rejects with a readable message ("No amount found…"). */
  saveCapture: (text: string, kind?: CaptureKind) => Promise<Snapshot>;
  convertCapture: (id: string, kind: CaptureKind) => Promise<Snapshot>;
  /** `targets`: also delete the task/reminder/event/expense it became. */
  deleteCaptures: (ids: string[], targets: boolean) => Promise<Snapshot>;
  setCaptureDone: (id: string, done: boolean) => Promise<Snapshot>;
  captureToNote: (id: string, widgetId: string) => Promise<Snapshot>;
  setCaptureSettings: (patch: Partial<CaptureSettings>) => Promise<Snapshot>;
  captureHotkeyStatus: () => Promise<{ active: boolean; error: string | null }>;
  hideCapture: () => void;
  openMainFromCapture: () => void;
  resizeCapture: (height: number) => void;
  onCaptureShown: (cb: () => void) => () => void;

  /** Daily Planner: replaces a day's blocks; sets its status or intention; app-wide settings. */
  savePlan: (day: string, blocks: PlanBlockInput[]) => Promise<Snapshot>;
  setPlanDay: (day: string, patch: { status?: PlanStatus; intention?: string }) => Promise<Snapshot>;
  setPlannerSettings: (patch: Partial<PlannerSettings>) => Promise<Snapshot>;

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
  email: MypaEmail;
  meetings: MypaMeetings;
  assistant: MypaAssistant;
  market: MypaMarket;
  system: MypaSystem;
}
