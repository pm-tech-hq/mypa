import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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
  PageRow,
  RetryTranscript,
  Snapshot,
  StepRow,
  TaskRow,
  WhisperModelSize,
  WidgetKind,
  WidgetRow,
  WidgetSettings,
} from "../../../shared/types";
import type {
  ExpenseCategoryPatch,
  ExpensePatch,
  ExpenseRecurringPatch,
  ExpenseSettings,
  NewExpense,
  NewExpenseCategory,
  NewExpenseRecurring,
} from "../../../shared/expenses";
import type { CaptureKind, CaptureSettings } from "../../../shared/capture";
import type { ShoppingItem, ShoppingSettings } from "../../../shared/shopping";
import type { MemoryKind, MemoryRecord } from "../../../shared/memory";
import type { StarterPlan, StarterResult } from "../../../shared/onboarding";
import type { JournalEntry, JournalSettings, Mood } from "../../../shared/journal";
import type { BoardColumn, ProjectPatch } from "../../../shared/projects";
import type { BriefingSettings } from "../../../shared/briefing";
import type { TimerAction, TimerKind, TimerRow, TimerSettings } from "../../../shared/timers";
import type { ExamPatch, SessionInput, SessionPatch, StudySession, StudySettings, SubjectPatch } from "../../../shared/study";
import type { PlanBlockInput, PlannerSettings, PlanStatus } from "../../../shared/planner";
import type { NewReminder, ReminderPatch } from "../../../shared/reminders";

export interface StoreActions {
  createPage: (input: NewPage) => Promise<void>;
  updatePage: (
    id: string,
    patch: Partial<Pick<PageRow, "title" | "icon" | "color">>,
  ) => Promise<void>;
  deletePage: (id: string) => Promise<void>;
  setCurrentPage: (id: string) => Promise<void>;

  createWidget: (
    kind: WidgetKind,
    pageId: string,
    rect?: { x: number; y: number; w: number; h: number },
    /** `custom` only: the installed widget to run. */
    pluginId?: string,
  ) => Promise<void>;
  updateWidget: (
    id: string,
    patch: Partial<Pick<WidgetRow, "title" | "x" | "y" | "w" | "h">>,
  ) => Promise<void>;
  updateWidgetSettings: (id: string, settings: WidgetSettings) => Promise<void>;
  deleteWidget: (id: string) => Promise<void>;
  restoreNoteVersion: (widgetId: string, versionId: string) => Promise<void>;

  createGoal: (input: NewGoal) => Promise<void>;
  updateGoal: (id: string, patch: Partial<GoalRow>) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;

  createTask: (input: NewTask) => Promise<void>;
  updateTask: (id: string, patch: Partial<TaskRow>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  createStep: (input: NewStep) => Promise<void>;
  updateStep: (id: string, patch: Partial<StepRow>) => Promise<void>;
  deleteStep: (id: string) => Promise<void>;

  createCalendarEvent: (input: NewCalendarEvent) => Promise<void>;
  updateCalendarEvent: (id: string, patch: Partial<CalendarEventRow>) => Promise<void>;
  deleteCalendarEvent: (id: string) => Promise<void>;
  /** null when the file picker was cancelled. */
  importIcsFile: () => Promise<IcsImportResult | null>;

  addGoogleCalendar: (input: NewGoogleAccount) => Promise<void>;
  addOutlookCalendar: (input: NewOutlookAccount) => Promise<void>;
  addIcsCalendar: (input: NewIcsAccount) => Promise<void>;
  reconnectCalendarAccount: (id: string) => Promise<void>;
  syncCalendarAccount: (id: string) => Promise<void>;
  removeCalendarAccount: (id: string) => Promise<void>;
  /** These reject with the reason when they fail (wrong password, no permission…). */
  addZohoCalendar: (input: NewZohoCalendar) => Promise<void>;
  addCaldavCalendar: (input: NewCaldavCalendar) => Promise<void>;
  updateCalendarAccount: (id: string, patch: CalendarAccountPatch) => Promise<void>;
  createRemoteEvent: (input: NewRemoteEvent) => Promise<void>;
  updateRemoteEvent: (id: string, patch: RemoteEventPatch) => Promise<void>;
  deleteRemoteEvent: (id: string) => Promise<void>;
  respondToEvent: (id: string, answer: CalendarRsvp) => Promise<void>;
  setCalendarReminder: (minutes: number) => Promise<void>;
  setGoogleClient: (client: { clientId: string; clientSecret: string } | null) => Promise<void>;

  pickAndTranscribeFile: (modelSize: WhisperModelSize) => Promise<void>;
  transcribeUrlMedia: (input: NewUrlMediaTranscript) => Promise<void>;
  transcribePage: (input: NewPageTranscript) => Promise<void>;
  deleteTranscript: (id: string) => Promise<void>;
  retryTranscript: (input: RetryTranscript) => Promise<void>;
  transcribeFiles: (paths: string[], modelSize: WhisperModelSize) => Promise<void>;
  renameTranscript: (id: string, title: string) => Promise<void>;

  setCarryOver: (value: boolean) => Promise<void>;

  /** These reject with the reason when they fail (no amount, no name…). */
  createExpense: (input: NewExpense) => Promise<void>;
  updateExpense: (id: string, patch: ExpensePatch) => Promise<void>;
  deleteExpenses: (ids: string[]) => Promise<void>;
  createExpenseCategory: (input: NewExpenseCategory) => Promise<void>;
  updateExpenseCategory: (id: string, patch: ExpenseCategoryPatch) => Promise<void>;
  deleteExpenseCategory: (id: string, moveTo?: string) => Promise<void>;
  createExpenseBill: (input: NewExpenseRecurring) => Promise<void>;
  updateExpenseBill: (id: string, patch: ExpenseRecurringPatch) => Promise<void>;
  deleteExpenseBill: (id: string) => Promise<void>;
  setExpenseSettings: (patch: Partial<ExpenseSettings>) => Promise<void>;

  createReminder: (input: NewReminder) => Promise<void>;
  updateReminder: (id: string, patch: ReminderPatch) => Promise<void>;
  completeReminder: (id: string, done: boolean) => Promise<void>;
  snoozeReminder: (id: string, until: number | null) => Promise<void>;
  deleteReminders: (ids: string[]) => Promise<void>;
  /** Resolves to the new list's id. */
  createShoppingList: (name: string) => Promise<string>;
  renameShoppingList: (id: string, name: string) => Promise<void>;
  deleteShoppingList: (id: string) => Promise<void>;
  /** Resolves to what was created and changed (for the message and undo). */
  addShopping: (listId: string, text: string) => Promise<{ created: string[]; changed: string[]; names: string[] }>;
  updateShoppingItem: (id: string, patch: Partial<ShoppingItem>) => Promise<void>;
  putShoppingItems: (items: ShoppingItem[]) => Promise<void>;
  deleteShoppingItems: (ids: string[]) => Promise<void>;
  checkAllShopping: (listId: string, checked: boolean) => Promise<void>;
  finishShopping: (listId: string, expense: { amount: number; categoryId: string; note: string } | null) => Promise<void>;
  forgetShopping: (name: string) => Promise<void>;
  setShoppingSettings: (patch: Partial<ShoppingSettings>) => Promise<void>;
  /** Journal writes reject with "The journal is locked." while it is. */
  saveJournal: (day: string, patch: { body?: string; mood?: Mood | null; prompt?: string }) => Promise<void>;
  deleteJournal: (days: string[]) => Promise<void>;
  putJournal: (entries: JournalEntry[]) => Promise<void>;
  /** Resolves false for a wrong passcode. */
  unlockJournal: (code: string) => Promise<boolean>;
  lockJournal: () => Promise<void>;
  setJournalPasscode: (current: string, next: string) => Promise<void>;
  eraseJournal: () => Promise<void>;
  /** True when the OS confirmed it's you and the passcode was removed (entries kept). */
  resetJournalWithOs: () => Promise<boolean>;
  applyStarterPlan: (plan: StarterPlan) => Promise<StarterResult>;
  setOnboarding: (show: boolean) => Promise<void>;
  setUserName: (name: string) => Promise<void>;
  setJournalSettings: (patch: Partial<JournalSettings>) => Promise<void>;
  /** Resolves to the new project's id; rejects if the name is taken. */
  createProject: (name: string, patch?: ProjectPatch) => Promise<string>;
  updateProject: (id: string, patch: ProjectPatch) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  moveTask: (taskId: string, col: BoardColumn, sort?: number) => Promise<void>;
  /** Study Planner. Resolve to the new ids; reject with a readable message. */
  saveSubject: (id: string | null, patch: SubjectPatch) => Promise<string>;
  deleteSubject: (id: string) => Promise<void>;
  saveExam: (id: string | null, patch: ExamPatch) => Promise<string>;
  deleteExam: (id: string) => Promise<void>;
  addSessions: (list: SessionInput[]) => Promise<string[]>;
  updateSession: (id: string, patch: SessionPatch) => Promise<void>;
  deleteSessions: (ids: string[]) => Promise<void>;
  putSessions: (list: StudySession[]) => Promise<void>;
  setStudySettings: (patch: Partial<StudySettings>) => Promise<void>;
  writeBriefing: () => Promise<void>;
  clearBriefing: () => Promise<void>;
  setBriefingSettings: (patch: Partial<BriefingSettings>) => Promise<void>;
  /** Resolves to the memory's id (an existing one when it was already there). */
  addMemory: (input: { text: string; kind?: MemoryKind | null }) => Promise<{ id: string; created: boolean }>;
  updateMemory: (
    id: string,
    patch: Partial<Pick<MemoryRecord, "text" | "kind" | "assistantCanUse" | "pinned" | "reviewed">>,
  ) => Promise<void>;
  deleteMemories: (ids: string[]) => Promise<void>;
  putMemories: (list: MemoryRecord[]) => Promise<void>;
  /** Resolves to the new timer's id. */
  createTimer: (input: { kind?: TimerKind; label?: string; durationMs?: number; start?: boolean }) => Promise<string>;
  timerAction: (id: string, action: TimerAction) => Promise<void>;
  updateTimer: (id: string, patch: { label?: string; durationMs?: number }) => Promise<void>;
  deleteTimer: (id: string) => Promise<void>;
  putTimer: (row: TimerRow) => Promise<void>;
  setTimerSettings: (patch: Partial<TimerSettings>) => Promise<void>;
  /** Resolves to the new capture's id. */
  saveCapture: (text: string, kind?: CaptureKind) => Promise<string | null>;
  convertCapture: (id: string, kind: CaptureKind) => Promise<void>;
  deleteCaptures: (ids: string[], targets: boolean) => Promise<void>;
  setCaptureDone: (id: string, done: boolean) => Promise<void>;
  captureToNote: (id: string, widgetId: string) => Promise<void>;
  setCaptureSettings: (patch: Partial<CaptureSettings>) => Promise<void>;
  savePlan: (day: string, blocks: PlanBlockInput[]) => Promise<void>;
  setPlanDay: (day: string, patch: { status?: PlanStatus; intention?: string }) => Promise<void>;
  setPlannerSettings: (patch: Partial<PlannerSettings>) => Promise<void>;

  refresh: () => Promise<void>;
  /** Adopt a snapshot returned by another API (e.g. the marketplace). */
  applySnapshot: (snapshot: Snapshot) => void;
}

interface StoreValue {
  snapshot: Snapshot | null;
  actions: StoreActions;
}

const StoreCtx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let live = true;
    void window.mypa.db.snapshot().then((s) => {
      if (live) setSnapshot(s);
    });
    const unsubscribe = window.mypa.db.onSnapshotChanged((s) => {
      if (live) setSnapshot(s);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  const actions = useMemo<StoreActions>(() => {
    const api = window.mypa.db;
    const run = async (p: Promise<Snapshot>): Promise<void> => {
      setSnapshot(await p);
    };
    return {
      createPage: (input) => run(api.createPage(input)),
      updatePage: (id, patch) => run(api.updatePage(id, patch)),
      deletePage: (id) => run(api.deletePage(id)),
      setCurrentPage: (id) => run(api.setCurrentPage(id)),

      createWidget: (kind, pageId, rect, pluginId) =>
        run(api.createWidget({ kind, pageId, pluginId, ...rect })),
      updateWidget: (id, patch) => run(api.updateWidget(id, patch)),
      updateWidgetSettings: (id, settings) => run(api.updateWidgetSettings(id, settings)),
      deleteWidget: (id) => run(api.deleteWidget(id)),
      restoreNoteVersion: (widgetId, versionId) =>
        run(api.restoreNoteVersion(widgetId, versionId)),

      createGoal: (input) => run(api.createGoal(input)),
      updateGoal: (id, patch) => run(api.updateGoal(id, patch)),
      deleteGoal: (id) => run(api.deleteGoal(id)),

      createTask: (input) => run(api.createTask(input)),
      updateTask: (id, patch) => run(api.updateTask(id, patch)),
      deleteTask: (id) => run(api.deleteTask(id)),

      createStep: (input) => run(api.createStep(input)),
      updateStep: (id, patch) => run(api.updateStep(id, patch)),
      deleteStep: (id) => run(api.deleteStep(id)),

      createCalendarEvent: (input) => run(api.createCalendarEvent(input)),
      updateCalendarEvent: (id, patch) => run(api.updateCalendarEvent(id, patch)),
      deleteCalendarEvent: (id) => run(api.deleteCalendarEvent(id)),
      importIcsFile: async () => {
        const { snapshot, result } = await api.importIcsFile();
        setSnapshot(snapshot);
        return result;
      },

      addGoogleCalendar: (input) => run(api.addGoogleCalendar(input)),
      addOutlookCalendar: (input) => run(api.addOutlookCalendar(input)),
      addIcsCalendar: (input) => run(api.addIcsCalendar(input)),
      reconnectCalendarAccount: (id) => run(api.reconnectCalendarAccount(id)),
      syncCalendarAccount: (id) => run(api.syncCalendarAccount(id)),
      removeCalendarAccount: (id) => run(api.removeCalendarAccount(id)),
      addZohoCalendar: (input) => run(api.addZohoCalendar(input)),
      addCaldavCalendar: (input) => run(api.addCaldavCalendar(input)),
      updateCalendarAccount: (id, patch) => run(api.updateCalendarAccount(id, patch)),
      createRemoteEvent: (input) => run(api.createRemoteEvent(input)),
      updateRemoteEvent: (id, patch) => run(api.updateRemoteEvent(id, patch)),
      deleteRemoteEvent: (id) => run(api.deleteRemoteEvent(id)),
      respondToEvent: (id, answer) => run(api.respondToEvent(id, answer)),
      setCalendarReminder: (minutes) => run(api.setCalendarReminder(minutes)),
      setGoogleClient: (client) => run(api.setGoogleClient(client)),

      pickAndTranscribeFile: (modelSize) => run(api.pickAndTranscribeFile(modelSize)),
      transcribeUrlMedia: (input) => run(api.transcribeUrlMedia(input)),
      transcribePage: (input) => run(api.transcribePage(input)),
      deleteTranscript: (id) => run(api.deleteTranscript(id)),
      retryTranscript: (input) => run(api.retryTranscript(input)),
      transcribeFiles: (paths, modelSize) => run(api.transcribeFiles(paths, modelSize)),
      renameTranscript: (id, title) => run(api.renameTranscript(id, title)),

      setCarryOver: (value) => run(api.setMeta("carryOver", value)),

      createExpense: (input) => run(api.createExpense(input)),
      updateExpense: (id, patch) => run(api.updateExpense(id, patch)),
      deleteExpenses: (ids) => run(api.deleteExpenses(ids)),
      createExpenseCategory: (input) => run(api.createExpenseCategory(input)),
      updateExpenseCategory: (id, patch) => run(api.updateExpenseCategory(id, patch)),
      deleteExpenseCategory: (id, moveTo) => run(api.deleteExpenseCategory(id, moveTo)),
      createExpenseBill: (input) => run(api.createExpenseBill(input)),
      updateExpenseBill: (id, patch) => run(api.updateExpenseBill(id, patch)),
      deleteExpenseBill: (id) => run(api.deleteExpenseBill(id)),
      setExpenseSettings: (patch) => run(api.setExpenseSettings(patch)),

      createReminder: (input) => run(api.createReminder(input)),
      updateReminder: (id, patch) => run(api.updateReminder(id, patch)),
      completeReminder: (id, done) => run(api.completeReminder(id, done)),
      snoozeReminder: (id, until) => run(api.snoozeReminder(id, until)),
      deleteReminders: (ids) => run(api.deleteReminders(ids)),
      createShoppingList: async (name) => {
        const r = await api.createShoppingList(name);
        setSnapshot(r.snapshot);
        return r.id;
      },
      renameShoppingList: (id, name) => run(api.renameShoppingList(id, name)),
      deleteShoppingList: (id) => run(api.deleteShoppingList(id)),
      addShopping: async (listId, text) => {
        const r = await api.addShopping(listId, text);
        setSnapshot(r.snapshot);
        return { created: r.created, changed: r.changed, names: r.names };
      },
      updateShoppingItem: (id, patch) => run(api.updateShoppingItem(id, patch)),
      putShoppingItems: (items) => run(api.putShoppingItems(items)),
      deleteShoppingItems: (ids) => run(api.deleteShoppingItems(ids)),
      checkAllShopping: (listId, checked) => run(api.checkAllShopping(listId, checked)),
      finishShopping: (listId, expense) => run(api.finishShopping(listId, expense)),
      forgetShopping: (name) => run(api.forgetShopping(name)),
      setShoppingSettings: (patch) => run(api.setShoppingSettings(patch)),
      saveJournal: (day, patch) => run(api.saveJournal(day, patch)),
      deleteJournal: (days) => run(api.deleteJournal(days)),
      putJournal: (entries) => run(api.putJournal(entries)),
      unlockJournal: async (code) => {
        const r = await api.unlockJournal(code);
        setSnapshot(r.snapshot);
        return r.ok;
      },
      lockJournal: () => run(api.lockJournal()),
      setJournalPasscode: (current, next) => run(api.setJournalPasscode(current, next)),
      eraseJournal: () => run(api.eraseJournal()),
      applyStarterPlan: async (plan) => {
        const r = await api.applyStarterPlan(plan);
        setSnapshot(r.snapshot);
        return r.result;
      },
      setOnboarding: (show) => run(api.setOnboarding(show)),
      setUserName: (name) => run(api.setUserName(name)),
      resetJournalWithOs: async () => {
        const r = await api.resetJournalWithOs();
        setSnapshot(r.snapshot);
        return r.ok;
      },
      setJournalSettings: (patch) => run(api.setJournalSettings(patch)),
      createProject: async (name, patch) => {
        const r = await api.createProject(name, patch);
        setSnapshot(r.snapshot);
        return r.id;
      },
      updateProject: (id, patch) => run(api.updateProject(id, patch)),
      deleteProject: (id) => run(api.deleteProject(id)),
      moveTask: (taskId, col, sort) => run(api.moveTask(taskId, col, sort)),
      saveSubject: async (id, patch) => {
        const r = await api.saveSubject(id, patch);
        setSnapshot(r.snapshot);
        return r.id;
      },
      deleteSubject: (id) => run(api.deleteSubject(id)),
      saveExam: async (id, patch) => {
        const r = await api.saveExam(id, patch);
        setSnapshot(r.snapshot);
        return r.id;
      },
      deleteExam: (id) => run(api.deleteExam(id)),
      addSessions: async (list) => {
        const r = await api.addSessions(list);
        setSnapshot(r.snapshot);
        return r.ids;
      },
      updateSession: (id, patch) => run(api.updateSession(id, patch)),
      deleteSessions: (ids) => run(api.deleteSessions(ids)),
      putSessions: (list) => run(api.putSessions(list)),
      setStudySettings: (patch) => run(api.setStudySettings(patch)),
      writeBriefing: () => run(api.writeBriefing()),
      clearBriefing: () => run(api.clearBriefing()),
      setBriefingSettings: (patch) => run(api.setBriefingSettings(patch)),
      addMemory: async (input) => {
        const { id, created, snapshot } = await api.addMemory(input);
        setSnapshot(snapshot);
        return { id, created };
      },
      updateMemory: (id, patch) => run(api.updateMemory(id, patch)),
      deleteMemories: (ids) => run(api.deleteMemories(ids)),
      putMemories: (list) => run(api.putMemories(list)),
      createTimer: async (input) => {
        const { id, snapshot } = await api.createTimer(input);
        setSnapshot(snapshot);
        return id;
      },
      timerAction: (id, action) => run(api.timerAction(id, action)),
      updateTimer: (id, patch) => run(api.updateTimer(id, patch)),
      deleteTimer: (id) => run(api.deleteTimer(id)),
      putTimer: (row) => run(api.putTimer(row)),
      setTimerSettings: (patch) => run(api.setTimerSettings(patch)),
      saveCapture: async (text, kind) => {
        const s = await api.saveCapture(text, kind);
        setSnapshot(s);
        return s.captures[0]?.id ?? null;
      },
      convertCapture: (id, kind) => run(api.convertCapture(id, kind)),
      deleteCaptures: (ids, targets) => run(api.deleteCaptures(ids, targets)),
      setCaptureDone: (id, done) => run(api.setCaptureDone(id, done)),
      captureToNote: (id, widgetId) => run(api.captureToNote(id, widgetId)),
      setCaptureSettings: (patch) => run(api.setCaptureSettings(patch)),
      savePlan: (day, blocks) => run(api.savePlan(day, blocks)),
      setPlanDay: (day, patch) => run(api.setPlanDay(day, patch)),
      setPlannerSettings: (patch) => run(api.setPlannerSettings(patch)),

      refresh: () => run(api.snapshot()),
      applySnapshot: (s) => setSnapshot(s),
    };
  }, []);

  return (
    <StoreCtx.Provider value={{ snapshot, actions }}>{children}</StoreCtx.Provider>
  );
}

export function useStore(): StoreValue {
  const v = useContext(StoreCtx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
}

/** For components that only render once the snapshot has loaded. */
export function useReadyStore(): { snapshot: Snapshot; actions: StoreActions } {
  const { snapshot, actions } = useStore();
  if (!snapshot) throw new Error("useReadyStore used before the snapshot loaded");
  return { snapshot, actions };
}
