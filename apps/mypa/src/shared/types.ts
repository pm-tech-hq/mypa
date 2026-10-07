/** Domain types shared by the SQLite layer (main), the preload bridge and the UI. */

import type { InstalledWidget } from "./widgetPlatform";

export type WidgetKind = "blank" | "todo" | "calendar" | "transcribe" | "tutor" | "custom";
export type Importance = "high" | "medium" | "low";
export type TaskSection = "today" | "backlog";
export type GoalHorizon = "week" | "month" | "quarter" | "year" | "someday";
export type GoalStatus = "active" | "done" | "archived";
/** Free-form project label on goals and tasks. */
export type Project = string;

export interface WidgetRow {
  id: string;
  pageId: string;
  kind: WidgetKind;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: WidgetSettings;
  sort: number;
  createdAt: number;
}

/** A board — widgets live on exactly one page. */
export interface PageRow {
  id: string;
  title: string;
  /** A key into the curated icon set — see `lib/icons.ts` (renderer). */
  icon: string;
  /** A key into the page palette, see `shared/pageColors.ts`. */
  color: string;
  sort: number;
  createdAt: number;
}

export interface GoalRow {
  id: string;
  title: string;
  detail: string;
  horizon: GoalHorizon;
  targetDate: string | null;
  status: GoalStatus;
  project: Project | null;
  sort: number;
  createdAt: number;
}

export interface TaskRow {
  id: string;
  goalId: string | null;
  title: string;
  project: Project;
  importance: Importance;
  section: TaskSection;
  done: boolean;
  due: number | null;
  sort: number;
  createdAt: number;
}

export interface StepRow {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  sort: number;
}

/* ---- calendar ------------------------------------------------------------ */

export type CalendarProvider = "google" | "outlook" | "ics";
export type CalendarAccountStatus = "connecting" | "connected" | "error";

/** An event you added yourself — always local, per the local-writes-only design. */
export interface CalendarEventRow {
  id: string;
  title: string;
  location: string;
  notes: string;
  start: number;
  end: number;
  allDay: boolean;
  createdAt: number;
}

/**
 * Public shape of a connected calendar — never carries client secrets, feed
 * URLs or tokens across IPC. Those stay in the main process.
 */
export interface CalendarAccountRow {
  id: string;
  provider: CalendarProvider;
  label: string;
  accountEmail: string | null;
  status: CalendarAccountStatus;
  errorMessage: string | null;
  lastSyncedAt: number | null;
  sort: number;
  createdAt: number;
}

/** A read-only event mirrored from a connected calendar. */
export interface CalendarRemoteEventRow {
  id: string;
  accountId: string;
  title: string;
  location: string;
  notes: string;
  start: number;
  end: number;
  allDay: boolean;
  htmlLink: string | null;
}

/* ---- transcribe ----------------------------------------------------------- */

export type TranscriptKind = "file" | "url_media" | "page";
export type TranscriptStatus = "pending" | "processing" | "done" | "error";

/** A local file transcription, a downloaded-media transcription, or an
 *  extracted web page — always global, like goals/tasks, not tied to a
 *  specific widget instance. Runs fully on-device; nothing leaves the
 *  machine except fetching the source itself (a URL) and, once, the model. */
export interface TranscriptRow {
  id: string;
  kind: TranscriptKind;
  title: string;
  /** File path or URL the record was created from. */
  source: string;
  text: string;
  status: TranscriptStatus;
  /** 0-100, meaningful while status is "processing". */
  progress: number;
  errorMessage: string | null;
  durationMs: number | null;
  wordCount: number;
  createdAt: number;
}

export interface Snapshot {
  pages: PageRow[];
  widgets: WidgetRow[];
  goals: GoalRow[];
  tasks: TaskRow[];
  steps: StepRow[];
  calendarEvents: CalendarEventRow[];
  calendarAccounts: CalendarAccountRow[];
  calendarRemoteEvents: CalendarRemoteEventRow[];
  transcripts: TranscriptRow[];
  /** Custom widgets installed from the marketplace, a file or a dev folder. */
  installedWidgets: InstalledWidget[];
  /** app-wide flags kept in the `meta` table */
  meta: { carryOver: boolean; currentPageId: string | null };
}

/* ---- per-widget settings ------------------------------------------------- */

export interface TodoSettings {
  /** null = every project */
  projects: Project[] | null;
  showCompleted: boolean;
  sort: "importance" | "due" | "manual";
  density: "comfortable" | "compact";
  backlogOpen: boolean;
  showGoalTags: boolean;
}

export interface BlankSettings {
  note: string;
}

/** Settings of a `custom` widget instance. */
export interface CustomSettings {
  /** Manifest id of the installed widget this instance runs. */
  pluginId: string;
  /** Values for the manifest's declared settings fields. */
  config: Record<string, unknown>;
  /** The widget's private key-value store (`mypa.storage`), per instance. */
  storage: Record<string, unknown>;
}

export interface CalendarSettings {
  view: "agenda" | "month";
  lookAheadDays: number;
}

export type WhisperModelSize = "tiny" | "base" | "small";

export interface TranscribeSettings {
  modelSize: WhisperModelSize;
  /** Override if yt-dlp isn't on PATH. */
  ytdlpPath: string | null;
}

export type WidgetSettings = Partial<
  TodoSettings & BlankSettings & CalendarSettings & TranscribeSettings & CustomSettings
>;

export const DEFAULT_TODO_SETTINGS: TodoSettings = {
  projects: null,
  showCompleted: true,
  sort: "importance",
  density: "comfortable",
  backlogOpen: false,
  showGoalTags: true,
};

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  view: "agenda",
  lookAheadDays: 30,
};

export const DEFAULT_TRANSCRIBE_SETTINGS: TranscribeSettings = {
  modelSize: "tiny",
  ytdlpPath: null,
};

/* ---- mutation inputs --------------------------------------------------- */

export interface NewWidget {
  kind: WidgetKind;
  pageId: string;
  /** `custom` only: the installed widget to run. */
  pluginId?: string;
  /** Optional placement; omitted = default size, cascaded from the top-left. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface NewPage {
  title: string;
  icon: string;
  /** Omitted: the next unused colour in the cycle. */
  color?: string;
}

export interface NewGoal {
  title: string;
  horizon: GoalHorizon;
  detail?: string;
  targetDate?: string | null;
  project?: Project | null;
}

export interface NewTask {
  title: string;
  project?: Project;
  importance?: Importance;
  section?: TaskSection;
  due?: number | null;
  goalId?: string | null;
}

export interface NewStep {
  taskId: string;
  title: string;
}

export interface NewCalendarEvent {
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
  location?: string;
  notes?: string;
}

export interface NewGoogleAccount {
  label: string;
  clientId: string;
  clientSecret: string;
}

export interface NewOutlookAccount {
  label: string;
  clientId: string;
}

export interface NewIcsAccount {
  label: string;
  feedUrl: string;
}

export interface NewUrlMediaTranscript {
  url: string;
  modelSize: WhisperModelSize;
  ytdlpPath: string | null;
}

export interface NewPageTranscript {
  url: string;
}

export interface RetryTranscript {
  id: string;
  modelSize: WhisperModelSize;
  ytdlpPath: string | null;
}

/* ---- labels / ordering ----------------------------------------------- */

export const HORIZON_ORDER: GoalHorizon[] = [
  "week",
  "month",
  "quarter",
  "year",
  "someday",
];

export const HORIZON_LABEL: Record<GoalHorizon, string> = {
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  someday: "Someday",
};

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  high: "Important",
  medium: "Normal",
  low: "Low",
};

/** Offered when picking a project, alongside the ones already in use. */
export const PROJECTS: Project[] = ["myPA", "Work", "Personal", "Learning"];
