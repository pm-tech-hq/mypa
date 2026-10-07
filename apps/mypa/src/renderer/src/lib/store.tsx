import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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

  addGoogleCalendar: (input: NewGoogleAccount) => Promise<void>;
  addOutlookCalendar: (input: NewOutlookAccount) => Promise<void>;
  addIcsCalendar: (input: NewIcsAccount) => Promise<void>;
  reconnectCalendarAccount: (id: string) => Promise<void>;
  syncCalendarAccount: (id: string) => Promise<void>;
  removeCalendarAccount: (id: string) => Promise<void>;

  pickAndTranscribeFile: (modelSize: WhisperModelSize) => Promise<void>;
  transcribeUrlMedia: (input: NewUrlMediaTranscript) => Promise<void>;
  transcribePage: (input: NewPageTranscript) => Promise<void>;
  deleteTranscript: (id: string) => Promise<void>;
  retryTranscript: (input: RetryTranscript) => Promise<void>;
  transcribeFiles: (paths: string[], modelSize: WhisperModelSize) => Promise<void>;
  renameTranscript: (id: string, title: string) => Promise<void>;

  setCarryOver: (value: boolean) => Promise<void>;
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

      addGoogleCalendar: (input) => run(api.addGoogleCalendar(input)),
      addOutlookCalendar: (input) => run(api.addOutlookCalendar(input)),
      addIcsCalendar: (input) => run(api.addIcsCalendar(input)),
      reconnectCalendarAccount: (id) => run(api.reconnectCalendarAccount(id)),
      syncCalendarAccount: (id) => run(api.syncCalendarAccount(id)),
      removeCalendarAccount: (id) => run(api.removeCalendarAccount(id)),

      pickAndTranscribeFile: (modelSize) => run(api.pickAndTranscribeFile(modelSize)),
      transcribeUrlMedia: (input) => run(api.transcribeUrlMedia(input)),
      transcribePage: (input) => run(api.transcribePage(input)),
      deleteTranscript: (id) => run(api.deleteTranscript(id)),
      retryTranscript: (input) => run(api.retryTranscript(input)),
      transcribeFiles: (paths, modelSize) => run(api.transcribeFiles(paths, modelSize)),
      renameTranscript: (id, title) => run(api.renameTranscript(id, title)),

      setCarryOver: (value) => run(api.setMeta("carryOver", value)),
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
