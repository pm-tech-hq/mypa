/** Domain types shared by the SQLite layer (main), the preload bridge and the UI. */

import type { EmailFolder } from "./email";
import type {
  ExpenseCategory,
  ExpenseRecurring,
  ExpenseRow,
  ExpenseSettings,
  ExpensesWidgetSettings,
} from "./expenses";
import type { CaptureRow, CaptureSettings, CaptureWidgetSettings } from "./capture";
import type {
  ShoppingHistory,
  ShoppingItem,
  ShoppingList,
  ShoppingSettings,
  ShoppingWidgetSettings,
} from "./shopping";
import type { PlanBlock, PlanDay, PlannerSettings } from "./planner";
import type { JournalEntry, JournalMeta, JournalWidgetSettings } from "./journal";
import type { ProjectRow, ProjectsWidgetSettings, TaskStage } from "./projects";
import type { ReminderRow, RemindersWidgetSettings } from "./reminders";
import type { BriefingNote, BriefingSettings } from "./briefing";
import type { CalcWidgetSettings } from "./calc";
import type { TimerRow, TimerSettings, TimerWidgetSettings } from "./timers";
import type { ConverterWidgetSettings } from "./units";
import type { MemoryRecord, MemoryWidgetSettings } from "./memory";
import type { StudyExam, StudySession, StudySettings, StudySubject, StudyWidgetSettings } from "./study";
import type { InstalledWidget } from "./widgetPlatform";

export type WidgetKind =
  | "blank"
  | "todo"
  | "calendar"
  | "transcribe"
  | "tutor"
  | "typing"
  | "flashcards"
  | "email"
  | "meeting"
  | "expenses"
  | "reminders"
  | "planner"
  | "capture"
  | "shopping"
  | "journal"
  | "projects"
  | "study"
  | "briefing"
  | "calculator"
  | "timer"
  | "converter"
  | "memory"
  | "custom";
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
  /** Project Tracker column while open. */
  stage: TaskStage;
  /** When it was ticked off; null while open (and for tasks done before this was kept). */
  doneAt: number | null;
}

export interface StepRow {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  sort: number;
}

/* ---- calendar ------------------------------------------------------------ */

export type CalendarProvider = "google" | "zoho" | "caldav" | "outlook" | "ics";
export type CalendarAccountStatus = "connecting" | "connected" | "error";

/** One calendar inside a connected account (an account can have several). */
export interface CalendarInfo {
  id: string;
  name: string;
  /** "#rrggbb" from the provider, when it has one. */
  color: string | null;
  /** You can add and change events in it. */
  writable: boolean;
  /** Hidden from the widget, reminders and the Assistant. */
  hidden: boolean;
  primary: boolean;
}

/** Your answer to an invitation. */
export type CalendarRsvp = "accepted" | "tentative" | "declined" | "needsAction";

export interface CalendarAttendee {
  name: string;
  email: string;
  status: CalendarRsvp;
  organizer: boolean;
  /** This is you. */
  self: boolean;
}

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
  /** Desktop reminders before this account's meetings. */
  notify: boolean;
  calendars: CalendarInfo[];
  /** Events can be added and changed from myPA (false for feeds, Outlook, and
   *  Google accounts connected before myPA asked for that permission). */
  canWrite: boolean;
}

/** An event mirrored from a connected calendar. */
export interface CalendarRemoteEventRow {
  id: string;
  accountId: string;
  calendarId: string;
  title: string;
  location: string;
  notes: string;
  start: number;
  end: number;
  allDay: boolean;
  htmlLink: string | null;
  /** Zoom, Meet, Teams… link found in the event. */
  meetingUrl: string | null;
  attendees: CalendarAttendee[];
  /** Your answer when you're invited; null when it's your own event. */
  myStatus: CalendarRsvp | null;
  /** Who organised it, when that isn't you. */
  organizer: string | null;
  /** You can change or delete it (not just answer it). */
  canEdit: boolean;
  /** One occurrence of a repeating event. */
  recurring: boolean;
}

/** A new event in a connected calendar. */
export interface NewRemoteEvent {
  accountId: string;
  calendarId: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  notes: string;
  /** Email addresses to invite. */
  guests: string[];
  /** Google only: add a Google Meet link. */
  addMeet?: boolean;
}

export type RemoteEventPatch = Partial<
  Pick<NewRemoteEvent, "title" | "start" | "end" | "allDay" | "location" | "notes" | "guests">
>;

export interface CalendarAccountPatch {
  label?: string;
  notify?: boolean;
  /** Calendar ids to hide; the rest are shown. */
  hiddenCalendars?: string[];
}

/** How myPA signs in to Google: a client built into this copy, one you added, or none yet. */
export type GoogleSignIn = "builtin" | "custom" | null;

/* ---- transcribe ----------------------------------------------------------- */

export type TranscriptKind = "file" | "url_media" | "page" | "meeting";
/** "recording" only for meetings, while the recorder is still running. */
export type TranscriptStatus = "recording" | "pending" | "processing" | "done" | "error";

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
  /** One per recorded meeting; its transcript is the `transcripts` row with the same id. */
  meetings: MeetingRow[];
  /** Custom widgets installed from the marketplace, a file or a dev folder. */
  installedWidgets: InstalledWidget[];
  /** Every expense, newest first; app-wide like tasks. */
  expenses: ExpenseRow[];
  expenseCategories: ExpenseCategory[];
  /** Bills and subscriptions that post themselves each month. */
  expenseRecurring: ExpenseRecurring[];
  /** Every reminder, open and done; app-wide like tasks. */
  reminders: ReminderRow[];
  /** Daily Planner: blocks and day records from two weeks back onwards. */
  planBlocks: PlanBlock[];
  planDays: PlanDay[];
  /** Quick Capture: what was captured (newest first) and where it went. */
  captures: CaptureRow[];
  /** Shopping Lists: every list, every item, and what's been bought before. */
  shoppingLists: ShoppingList[];
  shoppingItems: ShoppingItem[];
  shoppingHistory: ShoppingHistory[];
  /** Journal: every entry, newest first (text empty while locked). */
  journalEntries: JournalEntry[];
  /** Project Tracker: one record per project name used by tasks and goals. */
  projects: ProjectRow[];
  /** Study Planner: subjects, exams, and sessions from 120 days back on. */
  studySubjects: StudySubject[];
  studyExams: StudyExam[];
  studySessions: StudySession[];
  /** Timers and stopwatches. */
  timers: TimerRow[];
  /** Personal Memory: what the user has told myPA (and the Assistant) about themselves. */
  memories: MemoryRecord[];
  /** app-wide flags kept in the `meta` table */
  meta: {
    carryOver: boolean;
    currentPageId: string | null;
    /** Minutes before a meeting to remind you; -1 = off. */
    calendarReminder: number;
    googleSignIn: GoogleSignIn;
    /** Currency, monthly budget and the day months start, for every Expenses widget. */
    expenses: ExpenseSettings;
    /** Work hours, lunch, gaps… for the Daily Planner. */
    planner: PlannerSettings;
    /** Quick Capture's shortcut and where new tasks go. */
    capture: CaptureSettings;
    /** Shopping Lists: aisle order and logging trips in Expenses. */
    shopping: ShoppingSettings;
    /** Journal settings and whether it is locked. */
    journal: JournalMeta;
    /** Study hours, session length and limits for the Study Planner. */
    study: StudySettings;
    timers: TimerSettings;
    /** Daily Briefing: morning notification and today's written version. */
    briefing: { settings: BriefingSettings; note: BriefingNote | null };
    /** True until a new user finishes or skips the welcome guide. */
    onboarding: boolean;
    /** What the user asked to be called (Daily Briefing, the Assistant). */
    profile: { name: string | null };
  };
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

/** A saved state of a note widget's text. The newest one is the current text. */
export interface NoteVersion {
  id: string;
  text: string;
  /** When this version's editing began, and when it last changed. */
  createdAt: number;
  updatedAt: number;
}

/** A closed note widget's last text, kept with its history so it can be brought back. */
export interface ClosedNote extends NoteVersion {
  widgetId: string;
  /** How many versions come back with it. */
  versions: number;
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
  /** "all", "local" (this computer) or an account id. */
  show: string;
}

export type WhisperModelSize = "tiny" | "base" | "small";

export interface TranscribeSettings {
  modelSize: WhisperModelSize;
  /** Override if yt-dlp isn't on PATH. */
  ytdlpPath: string | null;
}

/* ---- meetings ------------------------------------------------------------ */

export type MeetingSummaryStatus = "none" | "waiting" | "running" | "done" | "error" | "off";

/** Something someone agreed to do, pulled out of a meeting by the summary. */
export interface MeetingActionItem {
  text: string;
  /** Who said they'd do it, as the transcript names them ("Me", "Speaker 1"…). */
  owner: string | null;
  /** The To-do task made from it, once added. */
  taskId: string | null;
}

/** The meeting-only parts of a recorded meeting. Its id, title, status and
 *  text (one "[m:ss] Speaker: words" line per turn) live in `transcripts`. */
export interface MeetingRow {
  id: string;
  /** The calendar event it was recorded for, if any. */
  eventId: string | null;
  startedAt: number;
  endedAt: number | null;
  /** Speaker labels as found ("Speaker 1") → the names the user gave them. */
  speakerNames: Record<string, string>;
  summary: string;
  decisions: string[];
  actionItems: MeetingActionItem[];
  summaryStatus: MeetingSummaryStatus;
  summaryError: string | null;
  /** The audio is still on disk. */
  hasAudio: boolean;
}

export interface MeetingSettings {
  modelSize: WhisperModelSize;
  /** Tell the other people apart (Speaker 1, 2…), not only you and them. */
  meetingSpeakers: boolean;
  /** AI for summaries: "local" (built in), a provider id, or "off". */
  meetingAi: string;
  /** Offer to record when a calendar meeting starts or a call app turns the mic on. */
  meetingPrompt: boolean;
  /** Keep the recording's audio after it's transcribed. */
  meetingKeepAudio: boolean;
  /** The microphone's device id, "" for automatic (the Windows default, skipping silent ones). */
  meetingMic: string;
}

/** How a meeting is processed once the recording stops (from the widget's settings). */
export interface MeetingOptions {
  modelSize: WhisperModelSize;
  speakers: boolean;
  ai: string;
  keepAudio: boolean;
}

export interface StartMeetingInput {
  title: string;
  eventId: string | null;
  options: MeetingOptions;
}

/** One passage's place in the typing trainer's review schedule. */
export interface TypingCard {
  /** 0 copy, 1 fill the gaps, 2 recall */
  stage: number;
  /** Recall box: how many spaced recalls in a row went well. */
  box: number;
  /** When it should come back (ms). */
  due: number;
  reps: number;
}

export interface TypingDay {
  ms: number;
  /** Correctly typed characters (copy and gaps). */
  chars: number;
  keystrokes: number;
  errors: number;
  passages: number;
}

export interface TypingSettings {
  /** "t:<transcript id>" / "n:<note widget id>"; null = everything. */
  typingSources: string[] | null;
  /** By passage id. */
  typingCards: Record<string, TypingCard>;
  /** By local date, YYYY-MM-DD. */
  typingDays: Record<string, TypingDay>;
  /** Misses by the character that should have been typed. */
  typingKeys: Record<string, number>;
  typingBestWpm: number;
  /** Best sprint speed by sprint length in seconds. */
  typingSprintBest: Record<string, number>;
  typingPrefs: Partial<TypingPrefs>;
}

export interface TypingPrefs {
  /** Home tab: the learning ladder, free speed practice, or timed sprints. */
  tab: "learn" | "speed" | "sprint";
  roundSize: number;
  length: "short" | "medium" | "long";
  gapDensity: "few" | "some" | "many";
  /** Start new passages at Fill the gaps. */
  skipCopy: boolean;
  /** A wrong key isn't accepted; fix it before moving on. */
  stopOnError: boolean;
  ignoreCase: boolean;
  ignorePunctuation: boolean;
  /** Minutes per day; 0 = no goal. */
  dailyGoalMin: number;
  fontSize: "s" | "m" | "l";
  showLive: boolean;
  sounds: boolean;
  sprintSeconds: number;
}

export const DEFAULT_TYPING_PREFS: TypingPrefs = {
  tab: "learn",
  roundSize: 5,
  length: "medium",
  gapDensity: "some",
  skipCopy: false,
  stopOnError: false,
  ignoreCase: false,
  ignorePunctuation: false,
  dailyGoalMin: 10,
  fontSize: "m",
  showLive: true,
  sounds: false,
  sprintSeconds: 60,
};

/** 0 new, 1 learning, 2 review, 3 relearning (forgotten, being learned again). */
export type FlashState = 0 | 1 | 2 | 3;

/** One flashcard and its place in the review schedule (FSRS). */
export interface Flashcard {
  id: string;
  /** "t:<transcript id>", "n:<note widget id>" or "manual". */
  sourceId: string;
  sourceTitle: string;
  /** cloze: `front` is a sentence with the answer replaced by "{{}}". */
  kind: "qa" | "cloze";
  front: string;
  back: string;
  /** The words in the material the card was made from. */
  quote: string;
  /** Plausible wrong answers, for multiple choice. */
  wrong: string[];
  origin: "ai" | "rules" | "manual";
  createdAt: number;
  state: FlashState;
  /** Index into the (re)learning steps. */
  step: number;
  due: number;
  /** Days until the chance of remembering falls to 90%. */
  stability: number;
  /** 1 (easy) to 10 (hard). */
  difficulty: number;
  lastReview: number;
  reps: number;
  lapses: number;
  suspended?: boolean;
}

export interface FlashDay {
  /** Every answer given. */
  reviews: number;
  /** New cards seen for the first time. */
  fresh: number;
  /** Answers on cards already learned, and how many of those were remembered. */
  rev: number;
  revOk: number;
  ms: number;
}

export interface FlashcardsPrefs {
  tab: "study" | "cards" | "stats";
  newPerDay: number;
  /** Reviews per day; 0 = no limit. */
  maxReviews: number;
  /** Target chance of still remembering a card when it comes back. */
  retention: number;
  /** How questions are asked. Mixed moves from recognising to recalling. */
  mode: "mixed" | "flip" | "type" | "choice";
  /** "off", "local" or a Tutor provider id: writes cards, explains, checks answers. */
  ai: string;
  /** Make cards with AI or with the quick built-in rules; null = not chosen yet. */
  useAi: boolean | null;
  focus: "understanding" | "facts" | "mixed";
  batchSize: number;
  showQuote: boolean;
  readAloud: boolean;
  /** Let the AI judge typed answers that don't match word for word. */
  aiCheck: boolean;
}

export const DEFAULT_FLASHCARDS_PREFS: FlashcardsPrefs = {
  tab: "study",
  newPerDay: 15,
  maxReviews: 200,
  retention: 0.9,
  mode: "mixed",
  ai: "local",
  useAi: null,
  focus: "understanding",
  batchSize: 20,
  showQuote: true,
  readAloud: false,
  aiCheck: true,
};

/** The Email widget's view. */
export interface EmailSettings {
  /** Accounts shown; null = all of them. */
  emailAccounts: string[] | null;
  emailFolder: EmailFolder;
  /** AI for summaries and drafts: "local", a provider id, or "off". Unset = automatic. */
  emailAi: string;
}

export interface FlashcardsSettings {
  /** By card id. */
  flashCards: Record<string, Flashcard>;
  /** By study day, YYYY-MM-DD (a study day starts at 4am). */
  flashDays: Record<string, FlashDay>;
  /** By source id: the parts of it already turned into cards. */
  flashMade: Record<string, number[]>;
  flashPrefs: Partial<FlashcardsPrefs>;
}

export type WidgetSettings = Partial<
  TodoSettings &
    BlankSettings &
    CalendarSettings &
    TranscribeSettings &
    CustomSettings &
    TypingSettings &
    FlashcardsSettings &
    EmailSettings &
    MeetingSettings &
    ExpensesWidgetSettings &
    RemindersWidgetSettings &
    CaptureWidgetSettings &
    ShoppingWidgetSettings &
    JournalWidgetSettings &
    ProjectsWidgetSettings &
    StudyWidgetSettings &
    CalcWidgetSettings &
    TimerWidgetSettings &
    ConverterWidgetSettings &
    MemoryWidgetSettings
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
  show: "all",
};

export const DEFAULT_TRANSCRIBE_SETTINGS: TranscribeSettings = {
  modelSize: "tiny",
  ytdlpPath: null,
};

export const DEFAULT_MEETING_SETTINGS: MeetingSettings = {
  modelSize: "base",
  meetingSpeakers: true,
  meetingAi: "local",
  meetingPrompt: true,
  meetingKeepAudio: true,
  meetingMic: "",
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
  stage?: TaskStage;
  /** Position; default puts it first. */
  sort?: number;
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

/** What importing a .ics file did. */
export interface IcsImportResult {
  added: number;
  /** Already on the calendar (same title, start and end). */
  skipped: number;
}

export interface NewGoogleAccount {
  label: string;
  /** Leave both out to use the Google sign-in set up for myPA. */
  clientId?: string;
  clientSecret?: string;
}

/** Zoho Calendar over CalDAV with an app password, or the one from a connected Zoho mailbox. */
export interface NewZohoCalendar {
  label?: string;
  email?: string;
  password?: string;
  region?: string;
  /** Reuse the address, password and region of this Email-widget account. */
  emailAccountId?: string;
  /** A calendar's CalDAV address from Zoho's settings, when finding them doesn't work. */
  calendarUrl?: string;
}

/** Any other CalDAV server (iCloud, Fastmail, Nextcloud…). */
export interface NewCaldavCalendar {
  label?: string;
  serverUrl: string;
  username: string;
  password: string;
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
