import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rename, writeFile } from "node:fs/promises";

import initSqlJs from "sql.js";

import { isPageColor, nextPageColor } from "../shared/pageColors";
import type {
  InstallSource,
  InstalledWidget,
  TrustLevel,
  WidgetManifest,
} from "../shared/widgetPlatform";
import { SEED_GOALS, SEED_TASKS } from "../shared/seed";
import {
  DEFAULT_CALENDAR_SETTINGS,
  DEFAULT_MEETING_SETTINGS,
  DEFAULT_TODO_SETTINGS,
  DEFAULT_TRANSCRIBE_SETTINGS,
  type CalendarAccountRow,
  type CalendarAccountStatus,
  type CalendarAttendee,
  type CalendarInfo,
  type CalendarRsvp,
  type CalendarEventRow,
  type CalendarProvider,
  type CalendarRemoteEventRow,
  type GoalRow,
  type MeetingActionItem,
  type MeetingOptions,
  type MeetingRow,
  type MeetingSummaryStatus,
  type NewCalendarEvent,
  type IcsImportResult,
  type NewGoal,
  type NewPage,
  type NewStep,
  type NewTask,
  type NewWidget,
  type ClosedNote,
  type NoteVersion,
  type PageRow,
  type Snapshot,
  type StepRow,
  type TaskRow,
  type TranscriptKind,
  type TranscriptRow,
  type TranscriptStatus,
  type WidgetKind,
  type WidgetRow,
  type WidgetSettings,
} from "../shared/types";
import type { EmailAccount, EmailAddress, EmailAuth, EmailProvider } from "../shared/email";
import {
  DEFAULT_EXPENSE_SETTINGS,
  FALLBACK_CATEGORY,
  SEED_CATEGORIES,
  guessCategory,
  isYmd,
  occurrences,
  ymd,
  type ExpenseCategory,
  type ExpenseCategoryPatch,
  type ExpensePatch,
  type ExpenseRecurring,
  type ExpenseRecurringPatch,
  type ExpenseRow,
  type ExpenseSettings,
  type NewExpense,
  type NewExpenseCategory,
  type NewExpenseRecurring,
} from "../shared/expenses";
import {
  CAPTURE_KINDS,
  cleanCaptureSettings,
  type CaptureKind,
  type CaptureRow,
  type CaptureSettings,
} from "../shared/capture";
import {
  cleanShoppingSettings,
  isAisle,
  itemKey,
  type ShoppingHistory,
  type ShoppingItem,
  type ShoppingList,
  type ShoppingSettings,
} from "../shared/shopping";
import {
  cleanPlannerSettings,
  dayKey as planDayKey,
  isDayKey,
  shiftDay,
  type PlanBlock,
  type PlanBlockInput,
  type PlanBlockKind,
  type PlanDay,
  type PlannerSettings,
  type PlanStatus,
} from "../shared/planner";
import {
  advance,
  cleanRepeat,
  type NewReminder,
  type ReminderPatch,
  type ReminderRow,
} from "../shared/reminders";
import {
  cleanJournalSettings,
  countWords,
  extractTags,
  isMood,
  type JournalEntry,
  type JournalMeta,
  type JournalSettings,
  type Mood,
} from "../shared/journal";
import {
  isColumn,
  isProjectStatus,
  isStage,
  sameProject,
  type BoardColumn,
  type ProjectPatch,
  type ProjectRow,
  type TaskStage,
} from "../shared/projects";
import {
  clashesOf,
  clashMessage,
  cleanStudySettings,
  isHm,
  parseTopics,
  studyBusy,
  type ExamPatch,
  type SessionInput,
  type SessionPatch,
  type StudyBusy,
  type StudyExam,
  type StudySession,
  type StudySettings,
  type StudySubject,
  type SubjectPatch,
} from "../shared/study";
import {
  cleanMemoryText,
  guessKind,
  isMemoryKind,
  MEMORY_CONTEXT_MAX,
  sameMemory,
  type MemoryKind,
  type MemoryRecord,
} from "../shared/memory";
import {
  cleanName,
  isStarterKind,
  STARTER_AREAS,
  type StarterPlan,
  type StarterResult,
  type StarterWidget,
} from "../shared/onboarding";
import {
  applyAction,
  cleanTimerSettings,
  MAX_TIMER_MS,
  type TimerAction,
  type TimerKind,
  type TimerRow,
  type TimerSettings,
} from "../shared/timers";
import {
  cleanBriefingSettings,
  type BriefingNote,
  type BriefingSettings,
} from "../shared/briefing";
import { decryptSecret, encryptSecret } from "./calendar/crypto";
import type { NormalizedEvent } from "./calendar/types";

type Cell = number | string | Uint8Array | null;
type Row = Record<string, unknown>;

interface RawStmt {
  bind(params?: Cell[]): boolean;
  step(): boolean;
  getAsObject(): Row;
  free(): boolean;
}

interface RawDb {
  run(sql: string, params?: Cell[]): void;
  exec(sql: string): unknown;
  prepare(sql: string): RawStmt;
  export(): Uint8Array;
  close(): void;
}

const DAY = 86_400_000;

let db: RawDb;
let filePath = "";
let saveTimer: NodeJS.Timeout | null = null;
let dirty = false;

/* ---------------------------------------------------------------- helpers -- */

function run(sql: string, params: Cell[] = []): void {
  db.run(sql, params);
  scheduleSave();
}

function get(sql: string, params: Cell[] = []): Row | undefined {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    return stmt.step() ? stmt.getAsObject() : undefined;
  } finally {
    stmt.free();
  }
}

function all(sql: string, params: Cell[] = []): Row[] {
  const stmt = db.prepare(sql);
  const out: Row[] = [];
  try {
    stmt.bind(params);
    while (stmt.step()) out.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return out;
}

/** sql.js closes and reopens the database inside export(), which resets
 *  connection pragmas — foreign keys included. Without re-enabling them every
 *  ON DELETE CASCADE / SET NULL silently stops working after the first save. */
function exportDb(): Buffer {
  const data = Buffer.from(db.export());
  db.run("PRAGMA foreign_keys = ON");
  return data;
}

/** Removes rows left behind while cascades weren't enforced (see exportDb). */
function removeOrphans(): void {
  run(`DELETE FROM steps WHERE task_id NOT IN (SELECT id FROM tasks)`);
  run(`DELETE FROM widgets WHERE page_id IS NOT NULL AND page_id NOT IN (SELECT id FROM pages)`);
  run(
    `UPDATE tasks SET goal_id = NULL WHERE goal_id IS NOT NULL AND goal_id NOT IN (SELECT id FROM goals)`,
  );
  run(
    `DELETE FROM calendar_remote_events WHERE account_id NOT IN (SELECT id FROM calendar_accounts)`,
  );
  run(`DELETE FROM email_messages WHERE account_id NOT IN (SELECT id FROM email_accounts)`);
  run(`DELETE FROM email_categories WHERE account_id NOT IN (SELECT id FROM email_accounts)`);
  // History outlives its note (see listClosedNotes), but only for the latest few.
  run(
    `DELETE FROM note_versions WHERE widget_id NOT IN (SELECT id FROM widgets)
       AND widget_id NOT IN (
         SELECT widget_id FROM note_versions WHERE widget_id NOT IN (SELECT id FROM widgets)
         GROUP BY widget_id ORDER BY MAX(updated_at) DESC LIMIT ?)`,
    [CLOSED_NOTES_KEEP],
  );
}

/** Closed notes used to take their history with them (ON DELETE CASCADE).
 *  SQLite can't drop a foreign key, so rebuild the table without it. Also
 *  saves the text of notes written before history existed, so a note closed
 *  before its next edit can still be brought back. */
function migrateNoteVersions(): void {
  const sql = get(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'note_versions'`);
  if (String(sql?.sql ?? "").includes("REFERENCES")) {
    db.exec(`
      CREATE TABLE note_versions_new (
        id TEXT PRIMARY KEY, widget_id TEXT NOT NULL,
        text TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO note_versions_new SELECT id, widget_id, text, created_at, updated_at FROM note_versions;
      DROP TABLE note_versions;
      ALTER TABLE note_versions_new RENAME TO note_versions;
      CREATE INDEX IF NOT EXISTS idx_note_versions_widget ON note_versions(widget_id, updated_at);
    `);
    scheduleSave();
  }
  for (const w of all(`SELECT id, settings FROM widgets WHERE kind = 'blank'`)) {
    let note: string;
    try {
      note = String((JSON.parse(String(w.settings)) as WidgetSettings).note ?? "");
    } catch {
      continue;
    }
    if (!note.trim()) continue;
    const head = get(
      `SELECT text FROM note_versions WHERE widget_id = ?
       ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      [String(w.id)],
    );
    if (head && String(head.text) === note) continue;
    const now = Date.now();
    run(
      `INSERT INTO note_versions (id, widget_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), String(w.id), note, now, now],
    );
  }
}

function scheduleSave(): void {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    void saveAtomic(exportDb());
  }, 300);
}

/* Saves never overwrite the database in place: a crash or power cut mid-write
 * would leave an empty or half-written file, which used to load as a brand-new
 * install and get re-seeded over the user's data. Write a temp file, then swap. */
let saving: Promise<void> = Promise.resolve();
/** Bumped by every save; an older background save that finishes late must not
 *  replace what a newer one already wrote. */
let generation = 0;

function saveAtomic(data: Buffer): Promise<void> {
  const mine = ++generation;
  saving = saving
    .catch(() => undefined)
    .then(async () => {
      if (mine !== generation) return;
      const tmp = `${filePath}.tmp`;
      await writeFile(tmp, data);
      if (mine === generation) await rename(tmp, filePath);
    });
  return saving;
}

function saveAtomicSync(data: Buffer): void {
  generation += 1;
  const tmp = `${filePath}.tmp-sync`;
  writeFileSync(tmp, data);
  renameSync(tmp, filePath);
}

export function flush(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dirty) return;
  dirty = false;
  saveAtomicSync(exportDb());
}

/* ------------------------------------------------------------------ schema -- */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS installed_widgets (
  id TEXT PRIMARY KEY, manifest TEXT NOT NULL, source TEXT NOT NULL,
  trust TEXT NOT NULL, registry_url TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  licensee TEXT, license_key TEXT, dev_path TEXT,
  installed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'layout-grid',
  color TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY, page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}', sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
  horizon TEXT NOT NULL DEFAULT 'month', target_date TEXT,
  status TEXT NOT NULL DEFAULT 'active', project TEXT,
  sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  title TEXT NOT NULL, project TEXT NOT NULL DEFAULT 'myPA',
  importance TEXT NOT NULL DEFAULT 'medium', section TEXT NOT NULL DEFAULT 'today',
  done INTEGER NOT NULL DEFAULT 0, due INTEGER,
  sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_steps_task ON steps(task_id);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  start INTEGER NOT NULL, end INTEGER NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS calendar_accounts (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL,
  account_email TEXT, status TEXT NOT NULL DEFAULT 'connecting', error_message TEXT,
  client_id TEXT, client_secret_enc BLOB, feed_url_enc BLOB,
  refresh_token_enc BLOB, access_token_enc BLOB, access_token_expires_at INTEGER,
  last_synced_at INTEGER, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS calendar_remote_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES calendar_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  start INTEGER NOT NULL, end INTEGER NOT NULL, all_day INTEGER NOT NULL DEFAULT 0,
  html_link TEXT
);
CREATE INDEX IF NOT EXISTS idx_remote_events_account ON calendar_remote_events(account_id);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0, error_message TEXT,
  duration_ms INTEGER, word_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY REFERENCES transcripts(id) ON DELETE CASCADE,
  event_id TEXT, started_at INTEGER NOT NULL, ended_at INTEGER,
  audio_dir TEXT NOT NULL, has_audio INTEGER NOT NULL DEFAULT 1,
  options TEXT NOT NULL DEFAULT '{}', segments TEXT NOT NULL DEFAULT '[]',
  speaker_names TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '', decisions TEXT NOT NULL DEFAULT '[]',
  action_items TEXT NOT NULL DEFAULT '[]',
  summary_status TEXT NOT NULL DEFAULT 'none', summary_error TEXT
);

CREATE TABLE IF NOT EXISTS note_versions (
  id TEXT PRIMARY KEY, widget_id TEXT NOT NULL,
  text TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_versions_widget ON note_versions(widget_id, updated_at);

CREATE TABLE IF NOT EXISTS email_accounts (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL, address TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL,
  smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL,
  password_enc BLOB, status TEXT NOT NULL DEFAULT 'connecting', error_message TEXT,
  last_synced_at INTEGER, notify INTEGER NOT NULL DEFAULT 1, signature TEXT NOT NULL DEFAULT '',
  uid_validity TEXT, last_uid INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS email_messages (
  account_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL, from_name TEXT NOT NULL DEFAULT '', from_address TEXT NOT NULL DEFAULT '',
  to_json TEXT NOT NULL DEFAULT '[]', cc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '', snippet TEXT, date INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0,
  answered INTEGER NOT NULL DEFAULT 0, attachments INTEGER NOT NULL DEFAULT 0, message_id TEXT,
  PRIMARY KEY (account_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_email_messages_date ON email_messages(account_id, date);
-- keyed by the Message-ID header where there is one, so a category survives moves
CREATE TABLE IF NOT EXISTS email_categories (
  key TEXT PRIMARY KEY, account_id TEXT NOT NULL, category TEXT NOT NULL, updated_at INTEGER NOT NULL
);

-- amounts in hundredths of the currency; dates are local YYYY-MM-DD
CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'tag',
  budget INTEGER, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS expense_recurring (
  id TEXT PRIMARY KEY, amount INTEGER NOT NULL, category_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', day INTEGER NOT NULL, start TEXT NOT NULL, end TEXT,
  paused INTEGER NOT NULL DEFAULT 0, last_posted TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY, amount INTEGER NOT NULL, category_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', date TEXT NOT NULL,
  recurring_id TEXT REFERENCES expense_recurring(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

-- times are epoch ms; repeat is JSON (see shared/reminders.ts)
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  due_at INTEGER, repeat TEXT, important INTEGER NOT NULL DEFAULT 0,
  snoozed_until INTEGER, fired_at INTEGER, done_at INTEGER, created_at INTEGER NOT NULL
);

-- Daily Planner: a day's time blocks; task blocks point at their task
CREATE TABLE IF NOT EXISTS plan_blocks (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL, task_id TEXT,
  title TEXT NOT NULL DEFAULT '', start INTEGER NOT NULL, end INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_blocks_day ON plan_blocks(day);

-- Shopping Lists
CREATE TABLE IF NOT EXISTS shopping_lists (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shopping_items (
  id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL, qty TEXT NOT NULL DEFAULT '', aisle TEXT NOT NULL DEFAULT 'other',
  note TEXT NOT NULL DEFAULT '', price INTEGER, checked INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shopping_items_list ON shopping_items(list_id);
-- what's been bought before: Buy again, and the aisle you put it in
CREATE TABLE IF NOT EXISTS shopping_history (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, aisle TEXT NOT NULL, qty TEXT NOT NULL DEFAULT '',
  price INTEGER, count INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL
);

-- Quick Capture: what was typed and the record it became (null for notes)
CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT,
  done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
-- Journal: one entry per day; body is "v1:" + AES-GCM ciphertext (key wrapped by the OS keychain)
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY, day TEXT NOT NULL UNIQUE, body TEXT NOT NULL DEFAULT '',
  mood INTEGER, tags TEXT NOT NULL DEFAULT '[]', prompt TEXT NOT NULL DEFAULT '',
  words INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
-- Project Tracker: a record per project name (tasks.project / goals.project hold the name)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active', color TEXT NOT NULL DEFAULT '', target_date TEXT,
  sort REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
-- Study Planner: subjects, exams (topics as JSON) and timed study sessions
CREATE TABLE IF NOT EXISTS study_subjects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '',
  weekly_minutes INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  sort REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS study_exams (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, title TEXT NOT NULL, day TEXT NOT NULL,
  time TEXT, topics TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, exam_id TEXT, topic TEXT NOT NULL DEFAULT '',
  start INTEGER NOT NULL, end INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, studied INTEGER,
  notes TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_study_sessions_start ON study_sessions(start);
CREATE TABLE IF NOT EXISTS timers (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', duration_ms INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER, accumulated_ms INTEGER NOT NULL DEFAULT 0, laps TEXT NOT NULL DEFAULT '[]', fired_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other', source TEXT NOT NULL DEFAULT 'you',
  context TEXT NOT NULL DEFAULT '', assistant_can_use INTEGER NOT NULL DEFAULT 1, pinned INTEGER NOT NULL DEFAULT 0,
  reviewed INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_days (
  day TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft', approved_at INTEGER,
  intention TEXT NOT NULL DEFAULT ''
);
`;

/* --------------------------------------------------------------- row maps -- */

function toWidget(r: Row): WidgetRow {
  let settings: WidgetSettings = {};
  try {
    settings = JSON.parse(String(r.settings)) as WidgetSettings;
  } catch {
    /* keep {} */
  }
  return {
    id: String(r.id),
    pageId: String(r.page_id),
    kind: String(r.kind) as WidgetKind,
    title: String(r.title),
    x: Number(r.x),
    y: Number(r.y),
    w: Number(r.w),
    h: Number(r.h),
    settings,
    sort: Number(r.sort),
    createdAt: Number(r.created_at),
  };
}

function toPage(r: Row): PageRow {
  return {
    id: String(r.id),
    title: String(r.title),
    icon: String(r.icon),
    color: String(r.color ?? ""),
    sort: Number(r.sort),
    createdAt: Number(r.created_at),
  };
}

function toGoal(r: Row): GoalRow {
  return {
    id: String(r.id),
    title: String(r.title),
    detail: String(r.detail ?? ""),
    horizon: String(r.horizon) as GoalRow["horizon"],
    targetDate: r.target_date == null ? null : String(r.target_date),
    status: String(r.status) as GoalRow["status"],
    project: r.project == null ? null : (String(r.project) as GoalRow["project"]),
    sort: Number(r.sort),
    createdAt: Number(r.created_at),
  };
}

function toTask(r: Row): TaskRow {
  return {
    id: String(r.id),
    goalId: r.goal_id == null ? null : String(r.goal_id),
    title: String(r.title),
    project: String(r.project) as TaskRow["project"],
    importance: String(r.importance) as TaskRow["importance"],
    section: String(r.section) as TaskRow["section"],
    done: Number(r.done) === 1,
    due: r.due == null ? null : Number(r.due),
    sort: Number(r.sort),
    createdAt: Number(r.created_at),
    stage: isStage(r.stage) ? r.stage : "todo",
    doneAt: r.done_at == null ? null : Number(r.done_at),
  };
}

function toStep(r: Row): StepRow {
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    title: String(r.title),
    done: Number(r.done) === 1,
    sort: Number(r.sort),
  };
}

function toCalendarEvent(r: Row): CalendarEventRow {
  return {
    id: String(r.id),
    title: String(r.title),
    location: String(r.location ?? ""),
    notes: String(r.notes ?? ""),
    start: Number(r.start),
    end: Number(r.end),
    allDay: Number(r.all_day) === 1,
    createdAt: Number(r.created_at),
  };
}

function parseJson<T>(v: unknown, fallback: T): T {
  try {
    return v == null ? fallback : (JSON.parse(String(v)) as T);
  } catch {
    return fallback;
  }
}

/** The Google permission that lets myPA change events (older connections only had read access). */
export const GOOGLE_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

function canWrite(provider: CalendarProvider, scope: unknown): boolean {
  if (provider === "zoho" || provider === "caldav") return true;
  return provider === "google" && String(scope ?? "").includes(GOOGLE_WRITE_SCOPE);
}

/** Public shape only — omits every secret/token column. */
function toCalendarAccount(r: Row): CalendarAccountRow {
  const provider = String(r.provider) as CalendarProvider;
  return {
    id: String(r.id),
    provider,
    label: String(r.label),
    accountEmail: r.account_email == null ? null : String(r.account_email),
    status: String(r.status) as CalendarAccountStatus,
    errorMessage: r.error_message == null ? null : String(r.error_message),
    lastSyncedAt: r.last_synced_at == null ? null : Number(r.last_synced_at),
    sort: Number(r.sort),
    createdAt: Number(r.created_at),
    notify: r.notify == null ? true : Boolean(r.notify),
    calendars: parseJson<CalendarInfo[]>(r.calendars, []),
    canWrite: canWrite(provider, r.scope),
  };
}

function toCalendarRemoteEvent(r: Row): CalendarRemoteEventRow {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    calendarId: String(r.calendar_id ?? ""),
    title: String(r.title),
    location: String(r.location ?? ""),
    notes: String(r.notes ?? ""),
    start: Number(r.start),
    end: Number(r.end),
    allDay: Number(r.all_day) === 1,
    htmlLink: r.html_link == null ? null : String(r.html_link),
    meetingUrl: r.meeting_url == null ? null : String(r.meeting_url),
    attendees: parseJson<CalendarAttendee[]>(r.attendees, []),
    myStatus: r.my_status == null ? null : (String(r.my_status) as CalendarRsvp),
    organizer: r.organizer == null ? null : String(r.organizer),
    canEdit: Boolean(r.can_edit),
    recurring: Boolean(r.recurring),
  };
}

function toTranscript(r: Row): TranscriptRow {
  return {
    id: String(r.id),
    kind: String(r.kind) as TranscriptKind,
    title: String(r.title),
    source: String(r.source),
    text: String(r.text ?? ""),
    status: String(r.status) as TranscriptStatus,
    progress: Number(r.progress),
    errorMessage: r.error_message == null ? null : String(r.error_message),
    durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
    wordCount: Number(r.word_count),
    createdAt: Number(r.created_at),
  };
}

function toMeeting(r: Row): MeetingRow {
  return {
    id: String(r.id),
    eventId: r.event_id == null ? null : String(r.event_id),
    startedAt: Number(r.started_at),
    endedAt: r.ended_at == null ? null : Number(r.ended_at),
    speakerNames: parseJson<Record<string, string>>(r.speaker_names, {}),
    summary: String(r.summary ?? ""),
    decisions: parseJson<string[]>(r.decisions, []),
    actionItems: parseJson<MeetingActionItem[]>(r.action_items, []),
    summaryStatus: String(r.summary_status) as MeetingSummaryStatus,
    summaryError: r.summary_error == null ? null : String(r.summary_error),
    hasAudio: Boolean(r.has_audio),
  };
}

/* ------------------------------------------------------------------- meta --- */

export function getMetaRaw(key: string): string | null {
  const row = get(`SELECT value FROM meta WHERE key = ?`, [key]);
  return row ? String(row.value) : null;
}

export function setMetaRaw(key: string, value: string): void {
  run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/* ----------------------------------------------------------------- seeding -- */

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}

function seed(): void {
  const now = Date.now();

  const goalIds = new Map<string, string>();
  SEED_GOALS.forEach((g, i) => {
    const id = randomUUID();
    goalIds.set(g.key, id);
    run(
      `INSERT INTO goals (id, title, detail, horizon, target_date, status, project, sort, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [id, g.title, g.detail, g.horizon, g.targetDate ?? null, g.project, i, now],
    );
  });

  SEED_TASKS.forEach((t, i) => {
    const id = randomUUID();
    run(
      `INSERT INTO tasks (id, goal_id, title, project, importance, section, done, due, sort, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        t.goal ? (goalIds.get(t.goal) ?? null) : null,
        t.t,
        t.p,
        t.imp,
        t.section,
        t.done ? 1 : 0,
        t.section === "today" && typeof t.dueDays === "number" ? now + t.dueDays * DAY : null,
        i,
        now,
      ],
    );
    (t.steps ?? []).forEach((s, j) => {
      run(`INSERT INTO steps (id, task_id, title, done, sort) VALUES (?, ?, ?, ?, ?)`, [
        randomUUID(),
        id,
        s.t,
        s.done ? 1 : 0,
        j,
      ]);
    });
  });

  const pageId = randomUUID();
  run(
    `INSERT INTO pages (id, title, icon, sort, created_at) VALUES (?, 'Home', 'layout-grid', 0, ?)`,
    [pageId, now],
  );

  run(
    `INSERT INTO widgets (id, page_id, kind, title, x, y, w, h, settings, sort, created_at)
     VALUES (?, ?, 'todo', 'To-do', 40, 40, 480, 620, ?, 0, ?)`,
    [randomUUID(), pageId, JSON.stringify(DEFAULT_TODO_SETTINGS), now],
  );

  setMetaRaw("seeded", "1");
  setMetaRaw("carryOver", "1");
  // only brand-new installs see the welcome guide
  setMetaRaw("onboarding", "pending");
  setMetaRaw("currentPageId", pageId);
}

/** Runs against a database that predates the multi-page feature: adds
 *  `widgets.page_id` if it's missing (SQLite's `CREATE TABLE IF NOT EXISTS`
 *  doesn't retroactively add columns to a table that already exists) and
 *  backfills every widget onto a single default page. Only called for
 *  already-seeded databases — a brand new one gets its page from `seed()`. */
function migrate(): void {
  const cols = all(`PRAGMA table_info(widgets)`).map((r) => String(r.name));
  if (!cols.includes("page_id")) {
    run(`ALTER TABLE widgets ADD COLUMN page_id TEXT REFERENCES pages(id) ON DELETE CASCADE`);
  }

  let defaultPageId = get(`SELECT id FROM pages ORDER BY sort, created_at LIMIT 1`)?.id as
    string | undefined;
  if (!defaultPageId) {
    defaultPageId = randomUUID();
    run(
      `INSERT INTO pages (id, title, icon, sort, created_at) VALUES (?, 'Home', 'layout-grid', 0, ?)`,
      [defaultPageId, Date.now()],
    );
  }
  run(`UPDATE widgets SET page_id = ? WHERE page_id IS NULL`, [defaultPageId]);
  if (getMetaRaw("currentPageId") === null) setMetaRaw("currentPageId", defaultPageId);
}

/** Pages predating page colours get a column and a colour each, dealt in
 *  sidebar order. Runs for new and existing databases alike (after seed or
 *  migrate), so it's the one place colours are backfilled. */
function ensurePageColors(): void {
  const cols = all(`PRAGMA table_info(pages)`).map((r) => String(r.name));
  if (!cols.includes("color")) {
    run(`ALTER TABLE pages ADD COLUMN color TEXT NOT NULL DEFAULT ''`);
  }
  const pages = all(`SELECT id, color FROM pages ORDER BY sort, created_at`);
  const used = pages.map((p) => String(p.color)).filter(isPageColor);
  for (const p of pages) {
    if (isPageColor(p.color)) continue;
    const color = nextPageColor(used);
    used.push(color);
    run(`UPDATE pages SET color = ? WHERE id = ?`, [color, String(p.id)]);
  }
}

/** Columns added when connected calendars became editable (Google, Zoho, CalDAV). */
function ensureCalendarColumns(): void {
  const add = (table: string, defs: [string, string][]) => {
    const cols = all(`PRAGMA table_info(${table})`).map((r) => String(r.name));
    for (const [name, def] of defs)
      if (!cols.includes(name)) run(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  };
  add("calendar_accounts", [
    ["server_url", "TEXT"],
    ["username", "TEXT"],
    ["password_enc", "BLOB"],
    ["scope", "TEXT"],
    ["notify", "INTEGER NOT NULL DEFAULT 1"],
    ["calendars", "TEXT NOT NULL DEFAULT '[]'"],
  ]);
  add("calendar_remote_events", [
    ["calendar_id", "TEXT NOT NULL DEFAULT ''"],
    ["meeting_url", "TEXT"],
    ["attendees", "TEXT NOT NULL DEFAULT '[]'"],
    ["my_status", "TEXT"],
    ["organizer", "TEXT"],
    ["can_edit", "INTEGER NOT NULL DEFAULT 0"],
    ["recurring", "INTEGER NOT NULL DEFAULT 0"],
    ["ref", "TEXT"],
  ]);
  // Project Tracker: board column, and when a task was finished
  add("tasks", [
    ["stage", "TEXT NOT NULL DEFAULT 'todo'"],
    ["done_at", "INTEGER"],
  ]);
  // Gmail can sign in with Google instead of an app password
  add("email_accounts", [["auth", "TEXT NOT NULL DEFAULT 'password'"]]);
  // The marketplace moved to its own domain (2026-11). Widgets installed
  // from it keep finding their updates under the new address.
  run(
    `UPDATE installed_widgets SET registry_url = 'https://my-pa.xyz/registry.json'
     WHERE registry_url IN ('https://mypa-market.vercel.app/registry.json', 'https://www.my-pa.xyz/registry.json')`,
  );
}

function carryOver(): void {
  if (getMetaRaw("carryOver") !== "1") return;
  run(
    `UPDATE tasks SET due = ?
     WHERE section = 'today' AND done = 0 AND due IS NOT NULL AND due < ?`,
    [endOfToday(), startOfToday()],
  );
}

/* --------------------------------------------------------------- lifecycle -- */

type SqlStatic = Awaited<ReturnType<typeof initSqlJs>>;

/** Loads `path` if it is a readable myPA database. */
function tryLoad(SQL: SqlStatic, path: string): RawDb | null {
  try {
    if (!existsSync(path) || statSync(path).size === 0) return null;
    const candidate = new SQL.Database(readFileSync(path)) as unknown as RawDb;
    // Must actually be ours: a seeded database always has the meta table.
    const stmt = candidate.prepare("SELECT value FROM meta WHERE key = 'seeded'");
    const ok = stmt.step();
    stmt.free();
    return ok ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Opens the database, falling back to the last good backup if the main file is
 * empty or damaged. A bad file is set aside (never overwritten), so nothing is
 * lost silently. Only a missing file means a genuinely new install.
 */
function openDatabase(SQL: SqlStatic, path: string): RawDb {
  const backup = `${path}.bak`;
  const main = tryLoad(SQL, path);
  if (main) {
    // Keep the copy that just loaded fine as the fallback for next time.
    try {
      copyFileSync(path, backup);
    } catch {
      /* a missing backup only matters if the main file later breaks */
    }
    return main;
  }
  if (existsSync(path)) {
    const aside = `${path}.damaged-${Date.now()}`;
    try {
      renameSync(path, aside);
      console.error(`[db] ${path} couldn't be read; kept it as ${aside}.`);
    } catch {
      /* leave it in place; the backup below still protects the data */
    }
    const restored = tryLoad(SQL, backup);
    if (restored) {
      console.error(`[db] Restored from ${backup}.`);
      return restored;
    }
  }
  return new SQL.Database() as unknown as RawDb;
}

export async function initDb(dbPath: string): Promise<void> {
  filePath = dbPath;
  const SQL = await initSqlJs({
    locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
  });
  db = openDatabase(SQL, dbPath);
  db.run("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  if (getMetaRaw("seeded") !== "1") {
    seed();
  } else {
    migrate();
  }
  // Only safe to index once page_id definitely exists — for a pre-migration
  // database that's after migrate() runs, not as part of SCHEMA itself.
  db.run(`CREATE INDEX IF NOT EXISTS idx_widgets_page ON widgets(page_id)`);
  ensurePageColors();
  migrateNoteVersions();
  ensureCalendarColumns();
  ensureExpenseCategories();
  removeOrphans();
  carryOver();
  postDueBills();
  flush();
}

export function getSnapshot(): Snapshot {
  return {
    pages: all(`SELECT * FROM pages ORDER BY sort, created_at`).map(toPage),
    widgets: all(`SELECT * FROM widgets ORDER BY sort, created_at`).map(toWidget),
    goals: all(`SELECT * FROM goals ORDER BY sort, created_at`).map(toGoal),
    tasks: all(`SELECT * FROM tasks ORDER BY sort, created_at`).map(toTask),
    steps: all(`SELECT * FROM steps ORDER BY sort`).map(toStep),
    calendarEvents: all(`SELECT * FROM calendar_events ORDER BY start`).map(toCalendarEvent),
    calendarAccounts: all(`SELECT * FROM calendar_accounts ORDER BY sort, created_at`).map(
      toCalendarAccount,
    ),
    calendarRemoteEvents: all(`SELECT * FROM calendar_remote_events ORDER BY start`).map(
      toCalendarRemoteEvent,
    ),
    installedWidgets: listInstalledWidgets(),
    transcripts: all(`SELECT * FROM transcripts ORDER BY created_at DESC`).map(toTranscript),
    meetings: all(
      `SELECT id, event_id, started_at, ended_at, has_audio, speaker_names, summary, decisions,
              action_items, summary_status, summary_error
       FROM meetings ORDER BY started_at DESC`,
    ).map(toMeeting),
    expenses: listExpenses(),
    expenseCategories: listExpenseCategories(),
    expenseRecurring: listExpenseRecurring(),
    reminders: listReminders(),
    planBlocks: listPlanBlocks(shiftDay(planDayKey(Date.now()), -14)),
    planDays: listPlanDays(shiftDay(planDayKey(Date.now()), -14)),
    captures: listCaptures(),
    shoppingLists: listShoppingLists(),
    shoppingItems: listShoppingItems(),
    shoppingHistory: listShoppingHistory(),
    journalEntries: listJournalEntries(),
    projects: listProjects(),
    studySubjects: listSubjects(),
    studyExams: listExams(),
    studySessions: listSessions(),
    timers: listTimers(),
    memories: listMemories(),
    meta: {
      carryOver: getMetaRaw("carryOver") === "1",
      currentPageId: getMetaRaw("currentPageId"),
      calendarReminder: calendarReminder(),
      googleSignIn: BUILTIN_GOOGLE ? "builtin" : getMetaRaw("googleClient") ? "custom" : null,
      expenses: expenseSettings(),
      planner: plannerSettings(),
      capture: captureSettings(),
      shopping: shoppingSettings(),
      journal: journalMeta(),
      study: studySettings(),
      timers: timerSettings(),
      briefing: { settings: briefingSettings(), note: briefingNote() },
      onboarding: getMetaRaw("onboarding") === "pending",
      profile: { name: userName() },
    },
  };
}

/* -------------------------------------------------------------- onboarding -- */

/** What the user asked to be called, or null. */
export function userName(): string | null {
  return cleanName(getMetaRaw("userName")) || null;
}

export function setUserName(name: string): void {
  const clean = cleanName(name);
  if (clean) setMetaRaw("userName", clean);
  else run(`DELETE FROM meta WHERE key = 'userName'`);
}

/** Shows the welcome guide again (from Settings), or marks it finished. */
export function setOnboarding(show: boolean): void {
  setMetaRaw("onboarding", show ? "pending" : "done");
}

function starterRect(w: StarterWidget): { x: number; y: number; w: number; h: number } {
  const n = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d;
  return { x: n(w.x, 0, 8000, 40), y: n(w.y, 0, 8000, 40), w: n(w.w, 240, 4000, 480), h: n(w.h, 160, 4000, 600) };
}

/**
 * Builds what the guide picked. Home is laid out only while it still holds at
 * most its starter To-do, so reopening the guide later never rearranges a
 * board the user has made. An area whose page already exists is skipped.
 */
export function applyStarterPlan(plan: StarterPlan): StarterResult {
  const home = get(`SELECT id FROM pages ORDER BY sort, created_at LIMIT 1`)?.id as string | undefined;
  let homeSet = false;
  if (home) {
    const onHome = all(`SELECT id, kind FROM widgets WHERE page_id = ?`, [home]);
    const homeWidgets = (Array.isArray(plan?.home) ? plan.home : []).filter((w) => isStarterKind(w?.kind));
    if (onHome.length <= 1 && homeWidgets.length) {
      const used = new Set<string>();
      for (const w of homeWidgets) {
        const rect = starterRect(w);
        const existing = onHome.find((r) => r.kind === w.kind && !used.has(String(r.id)));
        if (existing) {
          used.add(String(existing.id));
          updateWidget(String(existing.id), rect);
        } else createWidget({ kind: w.kind, pageId: home, ...rect });
      }
      homeSet = true;
    }
  }

  const titles = new Set(all(`SELECT title FROM pages`).map((r) => String(r.title).toLowerCase()));
  const created: StarterResult["created"] = [];
  for (const p of Array.isArray(plan?.pages) ? plan.pages : []) {
    const area = STARTER_AREAS.find((a) => a.id === p?.area);
    if (!area || titles.has(area.page.title.toLowerCase())) continue;
    const widgets = (Array.isArray(p.widgets) ? p.widgets : []).filter((w) => isStarterKind(w?.kind));
    if (!widgets.length) continue;
    const pageId = createPage({ title: area.page.title, icon: area.page.icon });
    for (const w of widgets) createWidget({ kind: w.kind, pageId, ...starterRect(w) });
    titles.add(area.page.title.toLowerCase());
    created.push(area.id);
  }
  if (home) setMetaRaw("currentPageId", home);
  return { created, homeSet };
}

/* --------------------------------------------------------------- mutations -- */

function patch(table: string, id: string, cols: [string, Cell][]): void {
  if (cols.length === 0) return;
  const setClause = cols.map(([c]) => `${c} = ?`).join(", ");
  run(`UPDATE ${table} SET ${setClause} WHERE id = ?`, [...cols.map(([, v]) => v), id]);
}

const bool = (v: unknown): number => (v ? 1 : 0);

/* ----------------------------------------------------------------- pages -- */

export function createPage(input: NewPage): string {
  const id = randomUUID();
  const sort = Number(get(`SELECT COUNT(*) c FROM pages`)?.c ?? 0);
  const used = all(`SELECT color FROM pages`).map((r) => String(r.color));
  const color = isPageColor(input.color) ? input.color : nextPageColor(used);
  run(`INSERT INTO pages (id, title, icon, color, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    id,
    input.title,
    input.icon,
    color,
    sort,
    Date.now(),
  ]);
  return id;
}

export function updatePage(
  id: string,
  p: Partial<Pick<PageRow, "title" | "icon" | "color">>,
): void {
  const cols: [string, Cell][] = [];
  if (p.title !== undefined) cols.push(["title", p.title]);
  if (p.icon !== undefined) cols.push(["icon", p.icon]);
  if (p.color !== undefined && isPageColor(p.color)) cols.push(["color", p.color]);
  patch("pages", id, cols);
}

/** No-ops if `id` is the only remaining page — the app always needs at least
 *  one. Widgets on the page are removed with it (ON DELETE CASCADE). If the
 *  deleted page was the current one, moves `currentPageId` to whichever page
 *  now sorts first. */
export function deletePage(id: string): void {
  const total = Number(get(`SELECT COUNT(*) c FROM pages`)?.c ?? 0);
  if (total <= 1) return;
  run(`DELETE FROM pages WHERE id = ?`, [id]);
  if (getMetaRaw("currentPageId") === id) {
    const next = get(`SELECT id FROM pages ORDER BY sort, created_at LIMIT 1`);
    if (next) setMetaRaw("currentPageId", String(next.id));
  }
}

export function setCurrentPage(id: string): void {
  setMetaRaw("currentPageId", id);
}

/** Title, default size and initial settings for a custom widget instance. */
function customPreset(pluginId: string | undefined) {
  const installed = pluginId ? getInstalledWidget(pluginId) : null;
  if (!installed || !installed.enabled) return null;
  const m = installed.manifest;
  const config: Record<string, unknown> = {};
  for (const f of m.settings ?? []) if (f.default !== undefined) config[f.key] = f.default;
  return {
    title: m.name,
    w: m.size.w,
    h: m.size.h,
    settings: JSON.stringify({ pluginId: m.id, config, storage: {} }),
  };
}

export function createWidget(input: NewWidget): string | null {
  const now = Date.now();
  const custom = input.kind === "custom" ? customPreset(input.pluginId) : null;
  if (input.kind === "custom" && !custom) return null;
  const id = randomUUID();
  const preset = custom
    ? custom
    : input.kind === "todo"
      ? { title: "To-do", w: 480, h: 620, settings: JSON.stringify(DEFAULT_TODO_SETTINGS) }
      : input.kind === "calendar"
        ? {
            title: "Calendar",
            w: 640,
            h: 500,
            settings: JSON.stringify(DEFAULT_CALENDAR_SETTINGS),
          }
        : input.kind === "tutor"
          ? { title: "Tutor", w: 480, h: 640, settings: "{}" }
          : input.kind === "typing"
            ? { title: "Typing", w: 560, h: 660, settings: "{}" }
            : input.kind === "flashcards"
              ? { title: "Flashcards", w: 520, h: 660, settings: "{}" }
            : input.kind === "email"
              ? { title: "Email", w: 560, h: 640, settings: "{}" }
            : input.kind === "expenses"
              ? { title: "Expenses", w: 520, h: 680, settings: "{}" }
            : input.kind === "shopping"
              ? {
                  title: "Shopping",
                  w: 440,
                  h: 640,
                  settings: JSON.stringify({ shopListId: ensureShoppingList(), shopGroup: true, shopCartOpen: true }),
                }
            : input.kind === "projects"
              ? { title: "Projects", w: 760, h: 640, settings: "{}" }
            : input.kind === "memory"
              ? { title: "Personal Memory", w: 420, h: 600, settings: "{}" }
            : input.kind === "converter"
              ? { title: "Unit Converter", w: 380, h: 560, settings: "{}" }
            : input.kind === "timer"
              ? { title: "Timer & Stopwatch", w: 380, h: 540, settings: "{}" }
            : input.kind === "calculator"
              ? { title: "Calculator", w: 340, h: 560, settings: "{}" }
            : input.kind === "briefing"
              ? { title: "Daily Briefing", w: 480, h: 640, settings: "{}" }
            : input.kind === "study"
              ? { title: "Study Planner", w: 520, h: 680, settings: "{}" }
            : input.kind === "journal"
              ? { title: "Journal", w: 480, h: 660, settings: "{}" }
            : input.kind === "capture"
              ? { title: "Quick Capture", w: 460, h: 560, settings: "{}" }
            : input.kind === "planner"
              ? { title: "Daily Planner", w: 480, h: 720, settings: "{}" }
            : input.kind === "reminders"
              ? { title: "Reminders", w: 440, h: 600, settings: "{}" }
            : input.kind === "meeting"
              ? {
                  title: "Meetings",
                  w: 520,
                  h: 640,
                  settings: JSON.stringify(DEFAULT_MEETING_SETTINGS),
                }
            : input.kind === "transcribe"
              ? {
                  title: "Transcribe",
                  w: 480,
                  h: 600,
                  settings: JSON.stringify(DEFAULT_TRANSCRIBE_SETTINGS),
                }
              : { title: "Note", w: 360, h: 300, settings: "{}" };
  const count = Number(
    get(`SELECT COUNT(*) c FROM widgets WHERE page_id = ?`, [input.pageId])?.c ?? 0,
  );
  const off = 28 * (count % 7);
  run(
    `INSERT INTO widgets (id, page_id, kind, title, x, y, w, h, settings, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.pageId,
      input.kind,
      preset.title,
      input.x ?? 40 + off,
      input.y ?? 40 + off,
      input.w ?? preset.w,
      input.h ?? preset.h,
      preset.settings,
      count,
      now,
    ],
  );
  return id;
}

export function updateWidget(
  id: string,
  p: Partial<Pick<WidgetRow, "title" | "x" | "y" | "w" | "h">>,
): void {
  const cols: [string, Cell][] = [];
  if (p.title !== undefined) cols.push(["title", p.title]);
  if (p.x !== undefined) cols.push(["x", p.x]);
  if (p.y !== undefined) cols.push(["y", p.y]);
  if (p.w !== undefined) cols.push(["w", p.w]);
  if (p.h !== undefined) cols.push(["h", p.h]);
  patch("widgets", id, cols);
}

/**
 * `checkpoint` keeps a note's previous text as its own version (for edits made
 * by the assistant, a Tutor save or a restore) instead of folding the change
 * into the version being typed.
 */
export function updateWidgetSettings(
  id: string,
  settings: WidgetSettings,
  opts: { checkpoint?: boolean } = {},
): void {
  const row = get(`SELECT kind, settings FROM widgets WHERE id = ?`, [id]);
  let current: WidgetSettings = {};
  try {
    current = row ? (JSON.parse(String(row.settings)) as WidgetSettings) : {};
  } catch {
    /* keep {} */
  }
  if (row?.kind === "blank" && typeof settings.note === "string") {
    recordNoteVersion(id, String(current.note ?? ""), settings.note, opts.checkpoint === true);
  }
  patch("widgets", id, [["settings", JSON.stringify({ ...current, ...settings })]]);
}

/* ----------------------------------------------------------- note history -- */

/** Typing that pauses for less than this continues the same version… */
const NOTE_PAUSE = 5 * 60_000;
/** …but a long session still gets a version every so often. */
const NOTE_SPAN = 30 * 60_000;
const NOTE_KEEP = 100;
/** How many closed notes keep their history. */
const CLOSED_NOTES_KEEP = 50;

function recordNoteVersion(widgetId: string, before: string, after: string, checkpoint: boolean) {
  if (before === after) return;
  const now = Date.now();
  let head = get(
    `SELECT id, text, created_at, updated_at FROM note_versions
     WHERE widget_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
    [widgetId],
  );
  // a note written before history existed: keep what it said
  if ((!head || String(head.text) !== before) && before.trim()) {
    run(
      `INSERT INTO note_versions (id, widget_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), widgetId, before, now, now],
    );
    head = undefined;
  }
  // A big deletion starts a new version, so the text it removed stays in history.
  const lost = before.length - after.length;
  const deleted = lost > 80 && lost > before.length / 3;
  const continues =
    head &&
    !checkpoint &&
    !deleted &&
    now - Number(head.updated_at) < NOTE_PAUSE &&
    now - Number(head.created_at) < NOTE_SPAN;
  if (continues) {
    run(`UPDATE note_versions SET text = ?, updated_at = ? WHERE id = ?`, [
      after,
      now,
      String(head!.id),
    ]);
  } else {
    run(
      `INSERT INTO note_versions (id, widget_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), widgetId, after, now, now],
    );
  }
  run(
    `DELETE FROM note_versions WHERE widget_id = ? AND id NOT IN (
       SELECT id FROM note_versions WHERE widget_id = ?
       ORDER BY updated_at DESC, created_at DESC LIMIT ?)`,
    [widgetId, widgetId, NOTE_KEEP],
  );
}

/** Newest first. */
export function listNoteVersions(widgetId: string): NoteVersion[] {
  return all(
    `SELECT * FROM note_versions WHERE widget_id = ? ORDER BY updated_at DESC, created_at DESC`,
    [widgetId],
  ).map((r) => ({
    id: String(r.id),
    text: String(r.text),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
}

/** Notes whose widget was closed, newest first, each with the last text it had. */
export function listClosedNotes(): ClosedNote[] {
  return all(
    `SELECT v.* , (SELECT COUNT(*) FROM note_versions c WHERE c.widget_id = v.widget_id) AS versions
     FROM note_versions v
     WHERE v.widget_id NOT IN (SELECT id FROM widgets) AND TRIM(v.text) <> ''
       AND v.updated_at = (SELECT MAX(updated_at) FROM note_versions o
                           WHERE o.widget_id = v.widget_id AND TRIM(o.text) <> '')
     GROUP BY v.widget_id
     ORDER BY v.updated_at DESC`,
  ).map((r) => ({
    id: String(r.id),
    widgetId: String(r.widget_id),
    text: String(r.text),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    versions: Number(r.versions),
  }));
}

/**
 * Puts an old version back as the note's text (itself a new version, so it
 * can be undone). The version may also be a closed note's: an empty note then
 * takes over that note's whole history, any other gets its text as a restore.
 */
export function restoreNoteVersion(widgetId: string, versionId: string): void {
  const v = get(
    `SELECT widget_id, text FROM note_versions WHERE id = ?
       AND (widget_id = ? OR widget_id NOT IN (SELECT id FROM widgets))`,
    [versionId, widgetId],
  );
  if (!v) return;
  const from = String(v.widget_id);
  const row = get(`SELECT settings FROM widgets WHERE id = ? AND kind = 'blank'`, [widgetId]);
  if (!row) return;
  let settings: WidgetSettings = {};
  try {
    settings = JSON.parse(String(row.settings)) as WidgetSettings;
  } catch {
    /* keep {} */
  }
  if (from !== widgetId && !String(settings.note ?? "").trim()) {
    run(`UPDATE note_versions SET widget_id = ? WHERE widget_id = ?`, [widgetId, from]);
    // the newest version must be the note's text, or the next edit records it twice
    const head = get(
      `SELECT text FROM note_versions WHERE widget_id = ?
       ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      [widgetId],
    );
    if (String(head?.text) !== String(v.text)) {
      const now = Date.now();
      run(
        `INSERT INTO note_versions (id, widget_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), widgetId, String(v.text), now, now],
      );
    }
    patch("widgets", widgetId, [
      ["settings", JSON.stringify({ ...settings, note: String(v.text) })],
    ]);
    return;
  }
  updateWidgetSettings(widgetId, { note: String(v.text) }, { checkpoint: true });
}

export function deleteWidget(id: string): void {
  run(`DELETE FROM widgets WHERE id = ?`, [id]);
}

/* ------------------------------------------------------- installed widgets -- */

function toInstalled(r: Row): InstalledWidget {
  return {
    manifest: JSON.parse(String(r.manifest)) as WidgetManifest,
    source: String(r.source) as InstallSource,
    trust: String(r.trust) as TrustLevel,
    registryUrl: r.registry_url == null ? null : String(r.registry_url),
    enabled: Boolean(r.enabled),
    licensee: r.licensee == null ? null : String(r.licensee),
    devPath: r.dev_path == null ? null : String(r.dev_path),
    installedAt: Number(r.installed_at),
    updatedAt: Number(r.updated_at),
  };
}

export function listInstalledWidgets(): InstalledWidget[] {
  return all(`SELECT * FROM installed_widgets ORDER BY installed_at`).map(toInstalled);
}

export function getInstalledWidget(id: string): InstalledWidget | null {
  const r = get(`SELECT * FROM installed_widgets WHERE id = ?`, [id]);
  return r ? toInstalled(r) : null;
}

/** Insert or replace (an update keeps the original install date and license). */
export function upsertInstalledWidget(input: {
  manifest: WidgetManifest;
  source: InstallSource;
  trust: TrustLevel;
  registryUrl: string | null;
  devPath: string | null;
}): void {
  const now = Date.now();
  const existing = get(`SELECT installed_at FROM installed_widgets WHERE id = ?`, [
    input.manifest.id,
  ]);
  if (existing) {
    run(
      `UPDATE installed_widgets SET manifest = ?, source = ?, trust = ?, registry_url = ?,
       dev_path = ?, updated_at = ? WHERE id = ?`,
      [
        JSON.stringify(input.manifest),
        input.source,
        input.trust,
        input.registryUrl,
        input.devPath,
        now,
        input.manifest.id,
      ],
    );
  } else {
    run(
      `INSERT INTO installed_widgets (id, manifest, source, trust, registry_url, enabled,
       dev_path, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        input.manifest.id,
        JSON.stringify(input.manifest),
        input.source,
        input.trust,
        input.registryUrl,
        input.devPath,
        now,
        now,
      ],
    );
  }
}

export function setInstalledWidgetEnabled(id: string, enabled: boolean): void {
  run(`UPDATE installed_widgets SET enabled = ? WHERE id = ?`, [bool(enabled), id]);
}

export function setInstalledWidgetLicense(id: string, key: string, licensee: string): void {
  run(`UPDATE installed_widgets SET license_key = ?, licensee = ? WHERE id = ?`, [
    key,
    licensee,
    id,
  ]);
}

/** Uninstalling also removes every board instance of the widget. */
export function removeInstalledWidget(id: string): void {
  run(`DELETE FROM installed_widgets WHERE id = ?`, [id]);
  for (const w of all(`SELECT id, settings FROM widgets WHERE kind = 'custom'`)) {
    try {
      if ((JSON.parse(String(w.settings)) as WidgetSettings).pluginId === id)
        deleteWidget(String(w.id));
    } catch {
      /* unreadable settings: leave the row alone */
    }
  }
}

export function getMetaJson<T>(key: string, fallback: T): T {
  const raw = getMetaRaw(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setMetaJson(key: string, value: unknown): void {
  setMetaRaw(key, JSON.stringify(value));
  flush();
}

export function createGoal(input: NewGoal): string {
  const now = Date.now();
  const id = randomUUID();
  const sort = Number(get(`SELECT COUNT(*) c FROM goals`)?.c ?? 0);
  run(
    `INSERT INTO goals (id, title, detail, horizon, target_date, status, project, sort, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [
      id,
      input.title,
      input.detail ?? "",
      input.horizon,
      input.targetDate ?? null,
      input.project ?? null,
      sort,
      now,
    ],
  );
  return id;
}

export function updateGoal(id: string, p: Partial<GoalRow>): void {
  const cols: [string, Cell][] = [];
  if (p.title !== undefined) cols.push(["title", p.title]);
  if (p.detail !== undefined) cols.push(["detail", p.detail]);
  if (p.horizon !== undefined) cols.push(["horizon", p.horizon]);
  if (p.targetDate !== undefined) cols.push(["target_date", p.targetDate]);
  if (p.status !== undefined) cols.push(["status", p.status]);
  if (p.project !== undefined) cols.push(["project", p.project]);
  if (p.sort !== undefined) cols.push(["sort", p.sort]);
  patch("goals", id, cols);
}

export function deleteGoal(id: string): void {
  run(`DELETE FROM goals WHERE id = ?`, [id]);
}

export function createTask(input: NewTask): string {
  const now = Date.now();
  const id = randomUUID();
  const sort =
    typeof input.sort === "number" && Number.isFinite(input.sort)
      ? input.sort
      : Number(get(`SELECT COALESCE(MIN(sort), 0) m FROM tasks`)?.m ?? 0) - 1;
  run(
    `INSERT INTO tasks (id, goal_id, title, project, importance, section, done, due, sort, created_at, stage)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      id,
      input.goalId ?? null,
      input.title,
      input.project ?? "myPA",
      input.importance ?? "medium",
      input.section ?? "today",
      input.due ?? null,
      sort,
      now,
      isStage(input.stage) ? input.stage : "todo",
    ],
  );
  return id;
}

export function updateTask(id: string, p: Partial<TaskRow>): void {
  const cols: [string, Cell][] = [];
  if (p.title !== undefined) cols.push(["title", p.title]);
  if (p.project !== undefined) cols.push(["project", p.project]);
  if (p.importance !== undefined) cols.push(["importance", p.importance]);
  if (p.section !== undefined) cols.push(["section", p.section]);
  if (p.done !== undefined) {
    cols.push(["done", bool(p.done)]);
    const was = get(`SELECT done FROM tasks WHERE id = ?`, [id]);
    if (was && Number(was.done) !== bool(p.done)) cols.push(["done_at", p.done ? Date.now() : null]);
  }
  if (p.stage !== undefined && isStage(p.stage)) cols.push(["stage", p.stage]);
  if (p.due !== undefined) cols.push(["due", p.due]);
  if (p.goalId !== undefined) cols.push(["goal_id", p.goalId]);
  if (p.sort !== undefined) cols.push(["sort", p.sort]);
  patch("tasks", id, cols);
}

export function deleteTask(id: string): void {
  run(`DELETE FROM tasks WHERE id = ?`, [id]);
}

export function createStep(input: NewStep): string {
  const id = randomUUID();
  const sort =
    Number(
      get(`SELECT COALESCE(MAX(sort), -1) m FROM steps WHERE task_id = ?`, [input.taskId])?.m ?? -1,
    ) + 1;
  run(`INSERT INTO steps (id, task_id, title, done, sort) VALUES (?, ?, ?, 0, ?)`, [
    id,
    input.taskId,
    input.title,
    sort,
  ]);
  return id;
}

export function updateStep(id: string, p: Partial<StepRow>): void {
  const cols: [string, Cell][] = [];
  if (p.title !== undefined) cols.push(["title", p.title]);
  if (p.done !== undefined) cols.push(["done", bool(p.done)]);
  if (p.sort !== undefined) cols.push(["sort", p.sort]);
  patch("steps", id, cols);
}

export function deleteStep(id: string): void {
  run(`DELETE FROM steps WHERE id = ?`, [id]);
}

export function setMeta(key: "carryOver", value: boolean): void {
  setMetaRaw(key, value ? "1" : "0");
}

/* ----------------------------------------------------------- calendar --- */

export function createCalendarEvent(input: NewCalendarEvent): string {
  const id = randomUUID();
  run(
    `INSERT INTO calendar_events (id, title, location, notes, start, end, all_day, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.location ?? "",
      input.notes ?? "",
      input.start,
      input.end,
      bool(input.allDay),
      Date.now(),
    ],
  );
  return id;
}

/**
 * Adds events copied from a calendar file. One already on the calendar with
 * the same title, start and end is skipped, so importing a file twice is harmless.
 */
export function importCalendarEvents(events: NewCalendarEvent[]): IcsImportResult {
  const seen = new Set(
    all(`SELECT title, start, end FROM calendar_events`).map(
      (r) => `${String(r.title)}
${Number(r.start)}
${Number(r.end)}`,
    ),
  );
  let added = 0;
  let skipped = 0;
  for (const e of events) {
    const key = `${e.title}
${e.start}
${e.end}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    createCalendarEvent(e);
    added++;
  }
  return { added, skipped };
}

export function updateCalendarEvent(id: string, p: Partial<CalendarEventRow>): void {
  const cols: [string, Cell][] = [];
  if (p.title !== undefined) cols.push(["title", p.title]);
  if (p.location !== undefined) cols.push(["location", p.location]);
  if (p.notes !== undefined) cols.push(["notes", p.notes]);
  if (p.start !== undefined) cols.push(["start", p.start]);
  if (p.end !== undefined) cols.push(["end", p.end]);
  if (p.allDay !== undefined) cols.push(["all_day", bool(p.allDay)]);
  patch("calendar_events", id, cols);
}

export function deleteCalendarEvent(id: string): void {
  run(`DELETE FROM calendar_events WHERE id = ?`, [id]);
}

/** Main-process-only shape — carries decrypted secrets, never sent over IPC. */
export interface CalendarAccountSecrets {
  id: string;
  provider: CalendarProvider;
  label: string;
  accountEmail: string | null;
  notify: boolean;
  calendars: CalendarInfo[];
  canWrite: boolean;
  clientId: string | null;
  clientSecret: string | null;
  feedUrl: string | null;
  refreshToken: string | null;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  /** CalDAV: where calendars are looked up; null when they were added by their own URLs. */
  serverUrl: string | null;
  username: string | null;
  password: string | null;
}

export function getCalendarAccountSecrets(id: string): CalendarAccountSecrets | undefined {
  const r = get(`SELECT * FROM calendar_accounts WHERE id = ?`, [id]);
  if (!r) return undefined;
  const pub = toCalendarAccount(r);
  return {
    id: pub.id,
    provider: pub.provider,
    label: pub.label,
    accountEmail: pub.accountEmail,
    notify: pub.notify,
    calendars: pub.calendars,
    canWrite: pub.canWrite,
    clientId: r.client_id == null ? null : String(r.client_id),
    clientSecret: decryptSecret(r.client_secret_enc as Uint8Array | null),
    feedUrl: decryptSecret(r.feed_url_enc as Uint8Array | null),
    refreshToken: decryptSecret(r.refresh_token_enc as Uint8Array | null),
    accessToken: decryptSecret(r.access_token_enc as Uint8Array | null),
    accessTokenExpiresAt:
      r.access_token_expires_at == null ? null : Number(r.access_token_expires_at),
    serverUrl: r.server_url == null ? null : String(r.server_url),
    username: r.username == null ? null : String(r.username),
    password: decryptSecret(r.password_enc as Uint8Array | null),
  };
}

export function listCalendarAccountIds(): string[] {
  return all(`SELECT id FROM calendar_accounts`).map((r) => String(r.id));
}

function nextAccountSort(): number {
  return Number(get(`SELECT COUNT(*) c FROM calendar_accounts`)?.c ?? 0);
}

/** Inserts a not-yet-signed-in OAuth account row; `completeOAuthAccount` or
 *  `failAccount` follows once the browser round-trip resolves. */
export function createOAuthAccountPending(
  provider: "google" | "outlook",
  label: string,
  clientId: string,
  clientSecret: string | null,
): string {
  const id = randomUUID();
  run(
    `INSERT INTO calendar_accounts (id, provider, label, status, client_id, client_secret_enc, sort, created_at)
     VALUES (?, ?, ?, 'connecting', ?, ?, ?, ?)`,
    [
      id,
      provider,
      label,
      clientId,
      clientSecret ? encryptSecret(clientSecret) : null,
      nextAccountSort(),
      Date.now(),
    ],
  );
  return id;
}

export function createIcsAccount(label: string, feedUrl: string): string {
  const id = randomUUID();
  run(
    `INSERT INTO calendar_accounts (id, provider, label, status, feed_url_enc, sort, created_at)
     VALUES (?, 'ics', ?, 'connecting', ?, ?, ?)`,
    [id, label, encryptSecret(feedUrl), nextAccountSort(), Date.now()],
  );
  return id;
}

/** A Zoho or other CalDAV account whose calendars were already found. */
export function createDavAccount(input: {
  provider: "zoho" | "caldav";
  label: string;
  serverUrl: string | null;
  username: string;
  password: string;
  calendars: CalendarInfo[];
}): string {
  const id = randomUUID();
  run(
    `INSERT INTO calendar_accounts (id, provider, label, account_email, status, server_url, username,
       password_enc, calendars, sort, created_at)
     VALUES (?, ?, ?, ?, 'connecting', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.provider,
      input.label,
      input.username.includes("@") ? input.username : null,
      input.serverUrl,
      input.username,
      encryptSecret(input.password),
      JSON.stringify(input.calendars),
      nextAccountSort(),
      Date.now(),
    ],
  );
  return id;
}

export function completeOAuthAccount(
  id: string,
  p: {
    accountEmail: string | null;
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: number;
    scope?: string | null;
  },
): void {
  run(
    `UPDATE calendar_accounts SET status = 'connected', error_message = NULL, account_email = ?,
       refresh_token_enc = ?, access_token_enc = ?, access_token_expires_at = ?, scope = ?
     WHERE id = ?`,
    [
      p.accountEmail,
      encryptSecret(p.refreshToken),
      encryptSecret(p.accessToken),
      p.accessTokenExpiresAt,
      p.scope ?? null,
      id,
    ],
  );
}

export function updateAccountTokens(
  id: string,
  p: { accessToken: string; accessTokenExpiresAt: number; refreshToken?: string },
): void {
  if (p.refreshToken) {
    run(
      `UPDATE calendar_accounts
       SET access_token_enc = ?, access_token_expires_at = ?, refresh_token_enc = ?
       WHERE id = ?`,
      [encryptSecret(p.accessToken), p.accessTokenExpiresAt, encryptSecret(p.refreshToken), id],
    );
  } else {
    run(
      `UPDATE calendar_accounts SET access_token_enc = ?, access_token_expires_at = ? WHERE id = ?`,
      [encryptSecret(p.accessToken), p.accessTokenExpiresAt, id],
    );
  }
}

export function setAccountCalendars(id: string, calendars: CalendarInfo[]): void {
  run(`UPDATE calendar_accounts SET calendars = ? WHERE id = ?`, [JSON.stringify(calendars), id]);
}

export function updateCalendarAccount(
  id: string,
  p: { label?: string; notify?: boolean; calendars?: CalendarInfo[] },
): void {
  const cols: [string, Cell][] = [];
  if (p.label !== undefined) cols.push(["label", p.label]);
  if (p.notify !== undefined) cols.push(["notify", bool(p.notify)]);
  if (p.calendars !== undefined) cols.push(["calendars", JSON.stringify(p.calendars)]);
  patch("calendar_accounts", id, cols);
}

export function touchAccountSynced(id: string): void {
  run(
    `UPDATE calendar_accounts SET last_synced_at = ?, status = 'connected', error_message = NULL WHERE id = ?`,
    [Date.now(), id],
  );
}

export function failAccount(id: string, message: string): void {
  run(`UPDATE calendar_accounts SET status = 'error', error_message = ? WHERE id = ?`, [
    message,
    id,
  ]);
}

export function deleteCalendarAccount(id: string): void {
  run(`DELETE FROM calendar_remote_events WHERE account_id = ?`, [id]);
  run(`DELETE FROM calendar_accounts WHERE id = ?`, [id]);
}

/** The same event gets the same id on every sync, so what's open, and what
 *  was already reminded, still points at it. */
export function remoteEventId(accountId: string, calendarId: string, key: string): string {
  const hash = createHash("sha1").update(`${calendarId}\n${key}`).digest("hex").slice(0, 20);
  return `${accountId}:${hash}`;
}

/** Replaces an account's events (only those in `calendarIds`, when given). */
export function replaceRemoteEvents(
  accountId: string,
  events: NormalizedEvent[],
  calendarIds?: string[],
): void {
  if (calendarIds) {
    for (const c of calendarIds)
      run(`DELETE FROM calendar_remote_events WHERE account_id = ? AND calendar_id = ?`, [
        accountId,
        c,
      ]);
  } else run(`DELETE FROM calendar_remote_events WHERE account_id = ?`, [accountId]);
  const seen = new Set<string>();
  for (const e of events) {
    const id = remoteEventId(accountId, e.calendarId, e.key);
    if (seen.has(id)) continue;
    seen.add(id);
    run(
      `INSERT OR REPLACE INTO calendar_remote_events (id, account_id, calendar_id, title, location,
         notes, start, end, all_day, html_link, meeting_url, attendees, my_status, organizer,
         can_edit, recurring, ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        accountId,
        e.calendarId,
        e.title,
        e.location,
        e.notes,
        e.start,
        e.end,
        bool(e.allDay),
        e.htmlLink,
        e.meetingUrl ?? null,
        JSON.stringify(e.attendees ?? []),
        e.myStatus ?? null,
        e.organizer ?? null,
        bool(e.canEdit ?? false),
        bool(e.recurring ?? false),
        e.ref === undefined ? null : JSON.stringify(e.ref),
      ],
    );
  }
}

/** Drops events from calendars that were hidden. */
export function deleteRemoteEventsIn(accountId: string, calendarIds: string[]): void {
  for (const c of calendarIds)
    run(`DELETE FROM calendar_remote_events WHERE account_id = ? AND calendar_id = ?`, [
      accountId,
      c,
    ]);
}

/** One connected-calendar event plus what its provider needs to change it. */
export function getRemoteEvent(
  id: string,
): { event: CalendarRemoteEventRow; ref: unknown } | undefined {
  const r = get(`SELECT * FROM calendar_remote_events WHERE id = ?`, [id]);
  return r ? { event: toCalendarRemoteEvent(r), ref: parseJson<unknown>(r.ref, null) } : undefined;
}

/** Minutes before a meeting to remind; -1 = off. Default 10. */
export function calendarReminder(): number {
  const v = getMetaRaw("calendarReminder");
  return v == null ? 10 : Number(v);
}

export function setCalendarReminder(minutes: number): void {
  setMetaRaw("calendarReminder", String(minutes));
}

/** Reminders already shown, so a restart doesn't repeat them. */
export function remindedKeys(): string[] {
  return parseJson<string[]>(getMetaRaw("calendarReminded"), []);
}

export function setRemindedKeys(keys: string[]): void {
  setMetaRaw("calendarReminded", JSON.stringify(keys));
}

/** A Google "Desktop app" OAuth client built into this copy at build time. */
const BUILTIN_GOOGLE =
  import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID && import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET
    ? {
        clientId: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
        clientSecret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
      }
    : null;

/** The client "Sign in with Google" uses: the built-in one, else one added in settings. */
export function googleAppClient(): { clientId: string; clientSecret: string } | null {
  if (BUILTIN_GOOGLE) return BUILTIN_GOOGLE;
  const raw = getMetaRaw("googleClient");
  if (!raw) return null;
  const c = parseJson<{ clientId?: string; secret?: string }>(raw, {});
  const clientSecret = c.secret ? decryptSecret(Buffer.from(c.secret, "base64")) : null;
  return c.clientId && clientSecret ? { clientId: c.clientId, clientSecret } : null;
}

export function setGoogleAppClient(c: { clientId: string; clientSecret: string } | null): void {
  if (!c) {
    run(`DELETE FROM meta WHERE key = 'googleClient'`);
    return;
  }
  setMetaRaw(
    "googleClient",
    JSON.stringify({
      clientId: c.clientId,
      secret: encryptSecret(c.clientSecret).toString("base64"),
    }),
  );
}

/* ---------------------------------------------------------- transcribe --- */

export function createTranscriptJob(kind: TranscriptKind, title: string, source: string): string {
  const id = randomUUID();
  run(
    `INSERT INTO transcripts (id, kind, title, source, status, progress, created_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?)`,
    [id, kind, title, source, Date.now()],
  );
  return id;
}

export function updateTranscriptStatus(id: string, status: TranscriptStatus): void {
  run(`UPDATE transcripts SET status = ? WHERE id = ?`, [status, id]);
}

export function updateTranscriptProgress(id: string, progress: number): void {
  run(`UPDATE transcripts SET progress = ? WHERE id = ?`, [
    Math.max(0, Math.min(100, Math.round(progress))),
    id,
  ]);
}

export function renameTranscript(id: string, title: string): void {
  run(`UPDATE transcripts SET title = ? WHERE id = ?`, [title, id]);
}

export function completeTranscript(
  id: string,
  text: string,
  durationMs: number | null,
  wordCount: number,
): void {
  run(
    `UPDATE transcripts SET status = 'done', progress = 100, text = ?, duration_ms = ?,
       word_count = ?, error_message = NULL
     WHERE id = ?`,
    [text, durationMs, wordCount, id],
  );
}

export function failTranscript(id: string, message: string): void {
  run(`UPDATE transcripts SET status = 'error', error_message = ? WHERE id = ?`, [message, id]);
}

export function deleteTranscript(id: string): void {
  run(`DELETE FROM transcripts WHERE id = ?`, [id]);
}

export function getTranscriptById(id: string): TranscriptRow | undefined {
  const r = get(`SELECT * FROM transcripts WHERE id = ?`, [id]);
  return r ? toTranscript(r) : undefined;
}

export function resetTranscriptForRetry(id: string): void {
  run(
    `UPDATE transcripts SET status = 'pending', progress = 0, error_message = NULL WHERE id = ?`,
    [id],
  );
}

/* ------------------------------------------------------------- meetings --- */

/** A meeting's stored details, including what the snapshot leaves out. */
export interface MeetingRecord extends MeetingRow {
  audioDir: string;
  options: MeetingOptions;
  segments: MeetingSegment[];
}

/** One stretch of one person talking. Times are ms from the start of the recording. */
export interface MeetingSegment {
  start: number;
  end: number;
  /** "Me", or "Them" / "Speaker N" for the other side. */
  speaker: string;
  text: string;
}

export function createMeeting(input: {
  title: string;
  eventId: string | null;
  /** Where its audio goes, from its id. */
  audioDir: (id: string) => string;
  options: MeetingOptions;
}): MeetingRecord {
  const id = randomUUID();
  const now = Date.now();
  const audioDir = input.audioDir(id);
  run(
    `INSERT INTO transcripts (id, kind, title, source, status, progress, created_at)
     VALUES (?, 'meeting', ?, ?, 'recording', 0, ?)`,
    [id, input.title, audioDir, now],
  );
  run(
    `INSERT INTO meetings (id, event_id, started_at, audio_dir, options) VALUES (?, ?, ?, ?, ?)`,
    [id, input.eventId, now, audioDir, JSON.stringify(input.options)],
  );
  flush();
  return getMeeting(id)!;
}

export function getMeeting(id: string): MeetingRecord | undefined {
  const r = get(`SELECT * FROM meetings WHERE id = ?`, [id]);
  if (!r) return undefined;
  return {
    ...toMeeting(r),
    audioDir: String(r.audio_dir),
    options: parseJson<MeetingOptions>(r.options, {
      modelSize: DEFAULT_MEETING_SETTINGS.modelSize,
      speakers: DEFAULT_MEETING_SETTINGS.meetingSpeakers,
      ai: DEFAULT_MEETING_SETTINGS.meetingAi,
      keepAudio: DEFAULT_MEETING_SETTINGS.meetingKeepAudio,
    }),
    segments: parseJson<MeetingSegment[]>(r.segments, []),
  };
}

/** Meetings whose recording never got to "stopped" (the app closed or crashed). */
export function unfinishedMeetingIds(): string[] {
  return all(`SELECT id FROM transcripts WHERE kind = 'meeting' AND status = 'recording'`).map(
    (r) => String(r.id),
  );
}

/** Meetings that were being transcribed or summarized when the app closed. */
export function interruptedMeetingIds(): { transcribe: string[]; summarize: string[] } {
  const transcribe = all(
    `SELECT id FROM transcripts WHERE kind = 'meeting' AND status IN ('pending', 'processing')`,
  ).map((r) => String(r.id));
  const summarize = all(
    `SELECT m.id FROM meetings m JOIN transcripts t ON t.id = m.id
     WHERE t.status = 'done' AND m.summary_status IN ('waiting', 'running')`,
  ).map((r) => String(r.id));
  return { transcribe, summarize };
}

export function updateMeeting(
  id: string,
  p: {
    endedAt?: number;
    options?: MeetingOptions;
    segments?: MeetingSegment[];
    speakerNames?: Record<string, string>;
    summary?: string;
    decisions?: string[];
    actionItems?: MeetingActionItem[];
    summaryStatus?: MeetingSummaryStatus;
    summaryError?: string | null;
    hasAudio?: boolean;
  },
): void {
  const cols: [string, Cell][] = [];
  if (p.endedAt !== undefined) cols.push(["ended_at", p.endedAt]);
  if (p.options !== undefined) cols.push(["options", JSON.stringify(p.options)]);
  if (p.segments !== undefined) cols.push(["segments", JSON.stringify(p.segments)]);
  if (p.speakerNames !== undefined) cols.push(["speaker_names", JSON.stringify(p.speakerNames)]);
  if (p.summary !== undefined) cols.push(["summary", p.summary]);
  if (p.decisions !== undefined) cols.push(["decisions", JSON.stringify(p.decisions)]);
  if (p.actionItems !== undefined) cols.push(["action_items", JSON.stringify(p.actionItems)]);
  if (p.summaryStatus !== undefined) cols.push(["summary_status", p.summaryStatus]);
  if (p.summaryError !== undefined) cols.push(["summary_error", p.summaryError]);
  if (p.hasAudio !== undefined) cols.push(["has_audio", bool(p.hasAudio)]);
  patch("meetings", id, cols);
}

/** Some Meetings widget wants to offer recording when a meeting starts. */
export function meetingPromptsWanted(): boolean {
  return all(`SELECT settings FROM widgets WHERE kind = 'meeting'`).some(
    (r) =>
      parseJson<WidgetSettings>(r.settings, {}).meetingPrompt ??
      DEFAULT_MEETING_SETTINGS.meetingPrompt,
  );
}

/** Replaces a finished transcript's text (e.g. after a speaker is renamed). */
export function setTranscriptText(id: string, text: string, wordCount: number): void {
  run(`UPDATE transcripts SET text = ?, word_count = ? WHERE id = ?`, [text, wordCount, id]);
}

/* ------------------------------------------------- raw rows (assistant undo) -- */

/** Tables the assistant can change; undo restores their rows exactly. */
export type UndoTable =
  | "tasks"
  | "steps"
  | "goals"
  | "calendar_events"
  | "widgets"
  | "expenses"
  | "reminders"
  | "plan_blocks"
  | "captures"
  | "shopping_items"
  | "journal_entries"
  | "study_sessions"
  | "memories";

const UNDO_TABLES = new Set<UndoTable>([
  "tasks",
  "steps",
  "goals",
  "calendar_events",
  "widgets",
  "expenses",
  "reminders",
  "plan_blocks",
  "captures",
  "shopping_items",
  "journal_entries",
  "study_sessions",
  "memories",
]);

/** The stored rows for these ids, column for column. */
export function rawRows(table: UndoTable, ids: string[]): Row[] {
  if (!UNDO_TABLES.has(table) || ids.length === 0) return [];
  return all(`SELECT * FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
}

/** Steps belonging to these tasks (deleting a task cascades to them). */
export function rawStepsForTasks(taskIds: string[]): Row[] {
  if (taskIds.length === 0) return [];
  return all(`SELECT * FROM steps WHERE task_id IN (${taskIds.map(() => "?").join(",")})`, taskIds);
}

/** Puts rows back exactly as captured. An upsert, not INSERT OR REPLACE:
 *  replacing would delete the row first and cascade to its children. */
export function restoreRows(table: UndoTable, rows: Row[]): void {
  if (!UNDO_TABLES.has(table)) return;
  for (const row of rows) {
    const cols = Object.keys(row);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    run(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})
       ON CONFLICT(id) DO UPDATE SET ${updates.join(", ")}`,
      cols.map((c) => row[c] as Cell),
    );
  }
}

export function deleteRows(table: UndoTable, ids: string[]): void {
  if (!UNDO_TABLES.has(table) || ids.length === 0) return;
  run(`DELETE FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
}

/* --------------------------------------------------------------- expenses -- */

/** Hundredths, whole and within a sane range; refunds are negative. */
function cleanAmount(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1e12) throw new Error("Enter an amount.");
  return n;
}

function cleanDay(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : 1;
}

function toExpense(r: Row): ExpenseRow {
  return {
    id: String(r.id),
    amount: Number(r.amount),
    categoryId: String(r.category_id),
    note: String(r.note ?? ""),
    date: String(r.date),
    recurringId: r.recurring_id == null ? null : String(r.recurring_id),
    createdAt: Number(r.created_at),
  };
}

function toExpenseCategory(r: Row): ExpenseCategory {
  return {
    id: String(r.id),
    name: String(r.name),
    icon: String(r.icon ?? "tag"),
    budget: r.budget == null ? null : Number(r.budget),
    sort: Number(r.sort),
  };
}

function toExpenseRecurring(r: Row): ExpenseRecurring {
  return {
    id: String(r.id),
    amount: Number(r.amount),
    categoryId: String(r.category_id),
    note: String(r.note ?? ""),
    day: Number(r.day),
    start: String(r.start),
    end: r.end == null ? null : String(r.end),
    paused: Number(r.paused) === 1,
    lastPosted: r.last_posted == null ? null : String(r.last_posted),
    createdAt: Number(r.created_at),
  };
}

export function listExpenses(): ExpenseRow[] {
  return all(`SELECT * FROM expenses ORDER BY date DESC, created_at DESC`).map(toExpense);
}

export function listExpenseCategories(): ExpenseCategory[] {
  return all(`SELECT * FROM expense_categories ORDER BY sort, name`).map(toExpenseCategory);
}

export function listExpenseRecurring(): ExpenseRecurring[] {
  return all(`SELECT * FROM expense_recurring ORDER BY day, created_at`).map(toExpenseRecurring);
}

/** The starter categories, once. Deleting them later is respected. */
function ensureExpenseCategories(): void {
  if (getMetaRaw("expenseCategoriesSeeded") === "1") return;
  if (Number(get(`SELECT COUNT(*) c FROM expense_categories`)?.c ?? 0) === 0) {
    SEED_CATEGORIES.forEach((c, i) =>
      run(`INSERT INTO expense_categories (id, name, icon, budget, sort) VALUES (?, ?, ?, NULL, ?)`, [
        c.id,
        c.name,
        c.icon,
        i,
      ]),
    );
  }
  setMetaRaw("expenseCategoriesSeeded", "1");
}

/** Spending always needs somewhere to go: Other comes back if it was deleted. */
function fallbackCategory(): string {
  if (get(`SELECT id FROM expense_categories WHERE id = ?`, [FALLBACK_CATEGORY])) return FALLBACK_CATEGORY;
  const sort = Number(get(`SELECT MAX(sort) m FROM expense_categories`)?.m ?? 0) + 1;
  run(`INSERT INTO expense_categories (id, name, icon, budget, sort) VALUES (?, 'Other', 'tag', NULL, ?)`, [
    FALLBACK_CATEGORY,
    sort,
  ]);
  return FALLBACK_CATEGORY;
}

function knownCategory(id: unknown): string {
  const s = typeof id === "string" ? id : "";
  return s && get(`SELECT id FROM expense_categories WHERE id = ?`, [s]) ? s : fallbackCategory();
}

export function expenseSettings(): ExpenseSettings {
  const s = getMetaJson<Partial<ExpenseSettings>>("expenseSettings", {});
  return {
    currency: typeof s.currency === "string" && /^[A-Z]{3}$/.test(s.currency) ? s.currency : DEFAULT_EXPENSE_SETTINGS.currency,
    budget: typeof s.budget === "number" && s.budget > 0 ? Math.round(s.budget) : null,
    monthStart:
      typeof s.monthStart === "number" ? Math.min(28, Math.max(1, Math.round(s.monthStart))) : 1,
  };
}

export function hasExpenseCurrency(): boolean {
  return typeof getMetaJson<Partial<ExpenseSettings>>("expenseSettings", {}).currency === "string";
}

export function setExpenseSettings(patch: Partial<ExpenseSettings>): void {
  const next = { ...expenseSettings(), ...patch };
  if (typeof patch.currency === "string") next.currency = patch.currency.trim().toUpperCase();
  setMetaJson("expenseSettings", next);
}

export function createExpense(input: NewExpense): string {
  const id = randomUUID();
  const note = String(input.note ?? "").trim().slice(0, 200);
  const categoryId = input.categoryId
    ? knownCategory(input.categoryId)
    : knownCategory(guessCategory(note, listExpenseCategories(), listExpenses().slice(0, 500)));
  run(
    `INSERT INTO expenses (id, amount, category_id, note, date, recurring_id, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [id, cleanAmount(input.amount), categoryId, note, isYmd(input.date) ? input.date : ymd(new Date()), Date.now()],
  );
  return id;
}

export function updateExpense(id: string, p: ExpensePatch): void {
  const cols: [string, Cell][] = [];
  if (p.amount !== undefined) cols.push(["amount", cleanAmount(p.amount)]);
  if (p.categoryId !== undefined) cols.push(["category_id", knownCategory(p.categoryId)]);
  if (p.note !== undefined) cols.push(["note", String(p.note).trim().slice(0, 200)]);
  if (p.date !== undefined && isYmd(p.date)) cols.push(["date", p.date]);
  patch("expenses", id, cols);
}

export function deleteExpenses(ids: string[]): void {
  deleteRows("expenses", ids);
}

export function createExpenseCategory(input: NewExpenseCategory): string {
  const name = String(input.name ?? "").trim().slice(0, 40);
  if (!name) throw new Error("A category needs a name.");
  const id = randomUUID();
  const sort = Number(get(`SELECT MAX(sort) m FROM expense_categories`)?.m ?? 0) + 1;
  run(`INSERT INTO expense_categories (id, name, icon, budget, sort) VALUES (?, ?, ?, ?, ?)`, [
    id,
    name,
    String(input.icon || "tag"),
    input.budget && input.budget > 0 ? Math.round(input.budget) : null,
    sort,
  ]);
  return id;
}

export function updateExpenseCategory(id: string, p: ExpenseCategoryPatch): void {
  const cols: [string, Cell][] = [];
  if (p.name !== undefined && String(p.name).trim()) cols.push(["name", String(p.name).trim().slice(0, 40)]);
  if (p.icon !== undefined) cols.push(["icon", String(p.icon)]);
  if (p.budget !== undefined) cols.push(["budget", p.budget && p.budget > 0 ? Math.round(p.budget) : null]);
  if (p.sort !== undefined) cols.push(["sort", Math.round(p.sort)]);
  patch("expense_categories", id, cols);
}

/** Its spending and bills move to `moveTo` (default Other); Other itself stays. */
export function deleteExpenseCategory(id: string, moveTo?: string): void {
  if (id === FALLBACK_CATEGORY) return;
  const target = moveTo && moveTo !== id ? knownCategory(moveTo) : fallbackCategory();
  run(`UPDATE expenses SET category_id = ? WHERE category_id = ?`, [target, id]);
  run(`UPDATE expense_recurring SET category_id = ? WHERE category_id = ?`, [target, id]);
  run(`DELETE FROM expense_categories WHERE id = ?`, [id]);
}

export function createExpenseRecurring(input: NewExpenseRecurring): string {
  const id = randomUUID();
  const note = String(input.note ?? "").trim().slice(0, 200);
  if (!note) throw new Error("Give the bill a name.");
  run(
    `INSERT INTO expense_recurring (id, amount, category_id, note, day, start, end, paused, last_posted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
    [
      id,
      cleanAmount(input.amount),
      knownCategory(input.categoryId),
      note,
      cleanDay(input.day),
      isYmd(input.start) ? input.start : ymd(new Date()),
      isYmd(input.end) ? input.end : null,
      Date.now(),
    ],
  );
  postDueBills();
  return id;
}

export function updateExpenseRecurring(id: string, p: ExpenseRecurringPatch): void {
  const cols: [string, Cell][] = [];
  if (p.amount !== undefined) cols.push(["amount", cleanAmount(p.amount)]);
  if (p.categoryId !== undefined) cols.push(["category_id", knownCategory(p.categoryId)]);
  if (p.note !== undefined && String(p.note).trim()) cols.push(["note", String(p.note).trim().slice(0, 200)]);
  if (p.day !== undefined) {
    cols.push(["day", cleanDay(p.day)]);
    // Moving the due day mustn't post a second time in a month already paid.
    const last = get(`SELECT last_posted FROM expense_recurring WHERE id = ?`, [id])?.last_posted;
    if (typeof last === "string" && isYmd(last)) {
      const d = new Date(`${last}T12:00:00`);
      cols.push(["last_posted", ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12))]);
    }
  }
  if (p.end !== undefined) cols.push(["end", isYmd(p.end) ? p.end : null]);
  if (p.paused !== undefined) {
    cols.push(["paused", bool(p.paused)]);
    // Resuming doesn't post the months it was paused for.
    if (!p.paused) cols.push(["last_posted", ymd(new Date())]);
  }
  patch("expense_recurring", id, cols);
  postDueBills();
}

/** Stops the bill; what it already posted stays as ordinary spending. */
export function deleteExpenseRecurring(id: string): void {
  run(`UPDATE expenses SET recurring_id = NULL WHERE recurring_id = ?`, [id]);
  run(`DELETE FROM expense_recurring WHERE id = ?`, [id]);
}

/**
 * Posts every bill that has fallen due since it last posted, up to today.
 * Each occurrence posts once: deleting a posted bill doesn't bring it back.
 * Returns how many were posted.
 */
export function postDueBills(today = ymd(new Date())): number {
  let posted = 0;
  for (const r of listExpenseRecurring()) {
    if (r.paused) continue;
    // A new bill never backfills more than a year.
    const floor = ymd(new Date(Date.now() - 366 * 86_400_000));
    const from = r.lastPosted ?? (r.start < floor ? floor : null);
    const due = occurrences(r, from, today);
    if (!due.length) continue;
    for (const date of due) {
      run(
        `INSERT INTO expenses (id, amount, category_id, note, date, recurring_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), r.amount, knownCategory(r.categoryId), r.note, date, r.id, Date.now()],
      );
      posted++;
    }
    run(`UPDATE expense_recurring SET last_posted = ? WHERE id = ?`, [due[due.length - 1]!, r.id]);
  }
  return posted;
}

/* ------------------------------------------------------------------ email -- */

/** An inbox message as cached between syncs (headers only; bodies are fetched on open). */
export interface CachedEmail {
  uid: number;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  snippet: string | null;
  date: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
  /** The Message-ID header. */
  messageId: string | null;
}

export interface EmailAccountSecrets {
  account: EmailAccount;
  /** null when it can't be decrypted on this machine. */
  password: string | null;
}

function toEmailAccount(r: Row): EmailAccount {
  return {
    id: String(r.id),
    provider: String(r.provider) as EmailProvider,
    auth: r.auth === "google" ? "google" : "password",
    label: String(r.label),
    address: String(r.address),
    displayName: String(r.display_name ?? ""),
    status: String(r.status) as EmailAccount["status"],
    errorMessage: r.error_message == null ? null : String(r.error_message),
    lastSyncedAt: r.last_synced_at == null ? null : Number(r.last_synced_at),
    unread: Number(r.unread ?? 0),
    notify: Boolean(r.notify),
    signature: String(r.signature ?? ""),
    imapHost: String(r.imap_host),
    imapPort: Number(r.imap_port),
    smtpHost: String(r.smtp_host),
    smtpPort: Number(r.smtp_port),
    sort: Number(r.sort ?? 0),
  };
}

function parseAddresses(json: unknown): EmailAddress[] {
  try {
    const v = JSON.parse(String(json)) as EmailAddress[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function toCachedEmail(r: Row): CachedEmail {
  return {
    uid: Number(r.uid),
    from: { name: String(r.from_name), address: String(r.from_address) },
    to: parseAddresses(r.to_json),
    cc: parseAddresses(r.cc_json),
    subject: String(r.subject),
    snippet: r.snippet == null ? null : String(r.snippet),
    date: Number(r.date),
    seen: Boolean(r.seen),
    flagged: Boolean(r.flagged),
    answered: Boolean(r.answered),
    hasAttachments: Boolean(r.attachments),
    messageId: r.message_id == null ? null : String(r.message_id),
  };
}

export function listEmailAccounts(): EmailAccount[] {
  return all(`SELECT * FROM email_accounts ORDER BY sort, created_at`).map(toEmailAccount);
}

/** Main process only: the password is never sent over IPC. */
export function getEmailAccountSecrets(id: string): EmailAccountSecrets | undefined {
  const r = get(`SELECT * FROM email_accounts WHERE id = ?`, [id]);
  if (!r) return undefined;
  return {
    account: toEmailAccount(r),
    password: decryptSecret(r.password_enc as Uint8Array | null),
  };
}

export function createEmailAccount(input: {
  provider: EmailProvider;
  label: string;
  address: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** The app password, or for `auth: "google"` the Google refresh token. */
  password: string;
  auth?: EmailAuth;
}): string {
  const id = randomUUID();
  const sort = Number(get(`SELECT COUNT(*) c FROM email_accounts`)?.c ?? 0);
  run(
    `INSERT INTO email_accounts (id, provider, label, address, display_name, imap_host, imap_port,
       smtp_host, smtp_port, password_enc, auth, status, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connecting', ?, ?)`,
    [
      id,
      input.provider,
      input.label,
      input.address,
      input.displayName,
      input.imapHost,
      input.imapPort,
      input.smtpHost,
      input.smtpPort,
      encryptSecret(input.password),
      input.auth ?? "password",
      sort,
      Date.now(),
    ],
  );
  return id;
}

export function updateEmailAccount(
  id: string,
  p: {
    label?: string;
    displayName?: string;
    notify?: boolean;
    signature?: string;
    /** The app password, or the Google refresh token. */
    password?: string;
    auth?: EmailAuth;
  },
): void {
  const cols: [string, Cell][] = [];
  if (p.label !== undefined) cols.push(["label", p.label]);
  if (p.displayName !== undefined) cols.push(["display_name", p.displayName]);
  if (p.notify !== undefined) cols.push(["notify", bool(p.notify)]);
  if (p.signature !== undefined) cols.push(["signature", p.signature]);
  if (p.password !== undefined) cols.push(["password_enc", encryptSecret(p.password)]);
  if (p.auth !== undefined) cols.push(["auth", p.auth]);
  patch("email_accounts", id, cols);
}

export function setEmailAccountStatus(
  id: string,
  status: EmailAccount["status"],
  error: string | null = null,
): void {
  run(`UPDATE email_accounts SET status = ?, error_message = ? WHERE id = ?`, [status, error, id]);
}

export function touchEmailAccountSynced(id: string, unread: number): void {
  run(
    `UPDATE email_accounts SET status = 'connected', error_message = NULL, last_synced_at = ?,
       unread = ? WHERE id = ?`,
    [Date.now(), unread, id],
  );
}

export function setEmailUnread(id: string, unread: number): void {
  run(`UPDATE email_accounts SET unread = ? WHERE id = ?`, [unread, id]);
}

export function deleteEmailAccount(id: string): void {
  run(`DELETE FROM email_categories WHERE account_id = ?`, [id]);
  run(`DELETE FROM email_messages WHERE account_id = ?`, [id]);
  run(`DELETE FROM email_accounts WHERE id = ?`, [id]);
}

export function getEmailSyncState(id: string): { uidValidity: string | null; lastUid: number } {
  const r = get(`SELECT uid_validity, last_uid FROM email_accounts WHERE id = ?`, [id]);
  return {
    uidValidity: r?.uid_validity == null ? null : String(r.uid_validity),
    lastUid: Number(r?.last_uid ?? 0),
  };
}

export function setEmailSyncState(id: string, uidValidity: string, lastUid: number): void {
  run(`UPDATE email_accounts SET uid_validity = ?, last_uid = ? WHERE id = ?`, [
    uidValidity,
    lastUid,
    id,
  ]);
}

export function clearEmailMessages(accountId: string): void {
  run(`DELETE FROM email_messages WHERE account_id = ?`, [accountId]);
}

export function upsertEmailMessages(accountId: string, rows: CachedEmail[]): void {
  for (const m of rows) {
    run(
      `INSERT INTO email_messages (account_id, uid, from_name, from_address, to_json, cc_json,
         subject, snippet, date, seen, flagged, answered, attachments, message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, uid) DO UPDATE SET seen = excluded.seen,
         flagged = excluded.flagged, answered = excluded.answered`,
      [
        accountId,
        m.uid,
        m.from.name,
        m.from.address,
        JSON.stringify(m.to),
        JSON.stringify(m.cc),
        m.subject,
        m.snippet,
        m.date,
        bool(m.seen),
        bool(m.flagged),
        bool(m.answered),
        bool(m.hasAttachments),
        m.messageId,
      ],
    );
  }
}

export function listCachedEmails(
  accountId: string,
  opts: { unreadOnly?: boolean; flaggedOnly?: boolean; limit: number },
): CachedEmail[] {
  const where = [
    "account_id = ?",
    ...(opts.unreadOnly ? ["seen = 0"] : []),
    ...(opts.flaggedOnly ? ["flagged = 1"] : []),
  ];
  return all(
    `SELECT * FROM email_messages WHERE ${where.join(" AND ")} ORDER BY date DESC LIMIT ?`,
    [accountId, opts.limit],
  ).map(toCachedEmail);
}

export function getCachedEmail(accountId: string, uid: number): CachedEmail | undefined {
  const r = get(`SELECT * FROM email_messages WHERE account_id = ? AND uid = ?`, [accountId, uid]);
  return r ? toCachedEmail(r) : undefined;
}

export function cachedEmailFlags(
  accountId: string,
): Map<number, { seen: boolean; flagged: boolean; answered: boolean }> {
  const out = new Map<number, { seen: boolean; flagged: boolean; answered: boolean }>();
  for (const r of all(
    `SELECT uid, seen, flagged, answered FROM email_messages WHERE account_id = ?`,
    [accountId],
  )) {
    out.set(Number(r.uid), {
      seen: Boolean(r.seen),
      flagged: Boolean(r.flagged),
      answered: Boolean(r.answered),
    });
  }
  return out;
}

export function setCachedEmailFlags(
  accountId: string,
  uid: number,
  f: { seen?: boolean; flagged?: boolean; answered?: boolean },
): void {
  const cols: [string, Cell][] = [];
  if (f.seen !== undefined) cols.push(["seen", bool(f.seen)]);
  if (f.flagged !== undefined) cols.push(["flagged", bool(f.flagged)]);
  if (f.answered !== undefined) cols.push(["answered", bool(f.answered)]);
  if (cols.length === 0) return;
  run(
    `UPDATE email_messages SET ${cols.map(([c]) => `${c} = ?`).join(", ")}
     WHERE account_id = ? AND uid = ?`,
    [...cols.map(([, v]) => v), accountId, uid],
  );
}

export function deleteCachedEmails(accountId: string, uids: number[]): void {
  for (const uid of uids) {
    run(`DELETE FROM email_messages WHERE account_id = ? AND uid = ?`, [accountId, uid]);
  }
}

export function setEmailSnippet(accountId: string, uid: number, snippet: string): void {
  run(`UPDATE email_messages SET snippet = ? WHERE account_id = ? AND uid = ?`, [
    snippet,
    accountId,
    uid,
  ]);
}

/** Newest first. */
export function emailsMissingSnippet(accountId: string, limit: number): number[] {
  return all(
    `SELECT uid FROM email_messages WHERE account_id = ? AND snippet IS NULL
     ORDER BY date DESC LIMIT ?`,
    [accountId, limit],
  ).map((r) => Number(r.uid));
}

export function countUnreadEmails(accountId: string): number {
  return Number(
    get(`SELECT COUNT(*) c FROM email_messages WHERE account_id = ? AND seen = 0`, [accountId])
      ?.c ?? 0,
  );
}

/** Keeps the newest `keep` cached messages of an account. */
export function pruneEmailMessages(accountId: string, keep: number): void {
  run(
    `DELETE FROM email_messages WHERE account_id = ? AND uid NOT IN (
       SELECT uid FROM email_messages WHERE account_id = ? ORDER BY date DESC LIMIT ?)`,
    [accountId, accountId, keep],
  );
}

/* ---------------------------------------------------- email categories -- */

/** Categories by key (see `categoryKey` in email/imap); keys without one are left out. */
export function emailCategories(keys: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 400) {
    const chunk = keys.slice(i, i + 400);
    for (const r of all(
      `SELECT key, category FROM email_categories WHERE key IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    ))
      out.set(String(r.key), String(r.category));
  }
  return out;
}

/** Every category in use, with how many messages are in it. */
export function emailCategoryCounts(): { category: string; count: number }[] {
  return all(
    `SELECT category, COUNT(*) n FROM email_categories GROUP BY category ORDER BY n DESC`,
  ).map((r) => ({ category: String(r.category), count: Number(r.n) }));
}

export function setEmailCategories(
  rows: { key: string; accountId: string; category: string | null }[],
): void {
  const now = Date.now();
  for (const r of rows) {
    if (r.category)
      run(
        `INSERT INTO email_categories (key, account_id, category, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at`,
        [r.key, r.accountId, r.category, now],
      );
    else run(`DELETE FROM email_categories WHERE key = ?`, [r.key]);
  }
}

/** Timed events starting between `from` and `to` that should get a reminder:
 *  your own, and those of connected accounts with reminders on (not declined). */
export function reminderCandidates(
  from: number,
  to: number,
): { id: string; title: string; start: number; location: string; meetingUrl: string | null; source: string | null }[] {
  const own = all(
    `SELECT id, title, start, location FROM calendar_events
     WHERE all_day = 0 AND start BETWEEN ? AND ?`,
    [from, to],
  ).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    start: Number(r.start),
    location: String(r.location ?? ""),
    meetingUrl: null,
    source: null,
  }));
  const connected = all(
    `SELECT e.id, e.title, e.start, e.location, e.meeting_url, a.label FROM calendar_remote_events e
     JOIN calendar_accounts a ON a.id = e.account_id
     WHERE a.status = 'connected' AND a.notify = 1 AND e.all_day = 0
       AND (e.my_status IS NULL OR e.my_status <> 'declined') AND e.start BETWEEN ? AND ?`,
    [from, to],
  ).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    start: Number(r.start),
    location: String(r.location ?? ""),
    meetingUrl: r.meeting_url == null ? null : String(r.meeting_url),
    source: String(r.label),
  }));
  return [...own, ...connected].sort((a, b) => a.start - b.start);
}

/** What the day plan works around: calendar events and study sessions. */
export function busyEvents(from: number, to: number): { id: string; title: string; start: number; end: number }[] {
  const names = new Map(all(`SELECT id, name FROM study_subjects`).map((r) => [String(r.id), String(r.name)]));
  const study = all(`SELECT id, subject_id, topic, start, end FROM study_sessions WHERE start < ? AND end > ?`, [
    to,
    from,
  ]).map((r) => {
    const name = names.get(String(r.subject_id)) ?? "Study";
    return {
      id: `study:${String(r.id)}`,
      title: `Study: ${r.topic ? `${name}, ${String(r.topic)}` : name}`,
      start: Number(r.start),
      end: Number(r.end),
    };
  });
  return [...calendarBusy(from, to), ...study].sort((a, b) => a.start - b.start);
}

/* -------------------------------------------------------------- reminders -- */

function toReminder(r: Row): ReminderRow {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id),
    title: String(r.title),
    notes: String(r.notes ?? ""),
    dueAt: n(r.due_at),
    repeat: cleanRepeat(parseJson<unknown>(r.repeat, null)),
    important: r.important === 1,
    snoozedUntil: n(r.snoozed_until),
    firedAt: n(r.fired_at),
    doneAt: n(r.done_at),
    createdAt: Number(r.created_at),
  };
}

export function listReminders(): ReminderRow[] {
  return all(`SELECT * FROM reminders ORDER BY created_at DESC`).map(toReminder);
}

export function getReminder(id: string): ReminderRow | undefined {
  const r = get(`SELECT * FROM reminders WHERE id = ?`, [id]);
  return r ? toReminder(r) : undefined;
}

function cleanTime(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function reminderTitle(v: unknown): string {
  const t = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!t) throw new Error("A reminder needs something to remind you of.");
  return t;
}

export function createReminder(input: NewReminder): string {
  const id = randomUUID();
  const dueAt = cleanTime(input.dueAt);
  const repeat = dueAt === null ? null : cleanRepeat(input.repeat);
  run(
    `INSERT INTO reminders (id, title, notes, due_at, repeat, important, snoozed_until, fired_at, done_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
    [
      id,
      reminderTitle(input.title),
      String(input.notes ?? "").slice(0, 4000),
      dueAt,
      repeat ? JSON.stringify(repeat) : null,
      bool(input.important),
      Date.now(),
    ],
  );
  return id;
}

/** Changing when it's due (or its repeat) clears any snooze and re-arms the alert. */
export function updateReminder(id: string, p: ReminderPatch): void {
  const cols: [string, Cell][] = [];
  if (p.title !== undefined) cols.push(["title", reminderTitle(p.title)]);
  if (p.notes !== undefined) cols.push(["notes", String(p.notes).slice(0, 4000)]);
  if (p.important !== undefined) cols.push(["important", bool(p.important)]);
  const timing = p.dueAt !== undefined || p.repeat !== undefined;
  if (p.dueAt !== undefined) {
    const due = cleanTime(p.dueAt);
    cols.push(["due_at", due]);
    if (due === null) cols.push(["repeat", null]);
  }
  if (p.repeat !== undefined && !(p.dueAt !== undefined && cleanTime(p.dueAt) === null)) {
    const rep = cleanRepeat(p.repeat);
    cols.push(["repeat", rep ? JSON.stringify(rep) : null]);
  }
  if (timing) {
    cols.push(["snoozed_until", null]);
    cols.push(["fired_at", null]);
  } else if (p.snoozedUntil !== undefined) {
    cols.push(["snoozed_until", cleanTime(p.snoozedUntil)]);
  }
  patch("reminders", id, cols);
}

/** Alert again at `until` (null = drop the snooze and go back to the due time). */
export function snoozeReminder(id: string, until: number | null): void {
  const t = cleanTime(until);
  run(`UPDATE reminders SET snoozed_until = ?, fired_at = CASE WHEN ? IS NULL THEN fired_at ELSE NULL END WHERE id = ?`, [
    t,
    t,
    id,
  ]);
}

/**
 * Ticks a reminder off. A repeating one moves on to its next date (and is
 * only done for good when its repeat has run out); unticking reopens it.
 * Returns the next due time for a repeating reminder, else null.
 */
export function completeReminder(id: string, done: boolean): number | null {
  const r = getReminder(id);
  if (!r) return null;
  if (!done) {
    run(`UPDATE reminders SET done_at = NULL, snoozed_until = NULL WHERE id = ?`, [id]);
    return null;
  }
  const next = r.repeat ? advance(r, Date.now()) : null;
  if (next !== null) {
    run(
      `UPDATE reminders SET due_at = ?, snoozed_until = NULL, fired_at = NULL, done_at = NULL WHERE id = ?`,
      [next, id],
    );
    return next;
  }
  run(`UPDATE reminders SET done_at = ?, snoozed_until = NULL WHERE id = ?`, [Date.now(), id]);
  return null;
}

export function deleteReminders(ids: string[]): void {
  deleteRows("reminders", ids);
}

/** Open reminders whose alert time has come and that haven't alerted for it yet. */
export function dueReminderAlerts(now: number): ReminderRow[] {
  return all(
    `SELECT * FROM reminders
     WHERE done_at IS NULL AND COALESCE(snoozed_until, due_at) IS NOT NULL
       AND COALESCE(snoozed_until, due_at) <= ?
       AND (fired_at IS NULL OR fired_at <> COALESCE(snoozed_until, due_at))`,
    [now],
  ).map(toReminder);
}

/** The soonest alert still to come, to time the next check. */
export function nextReminderAlert(now: number): number | null {
  const r = get(
    `SELECT MIN(COALESCE(snoozed_until, due_at)) t FROM reminders
     WHERE done_at IS NULL AND COALESCE(snoozed_until, due_at) > ?`,
    [now],
  );
  return r?.t === null || r?.t === undefined ? null : Number(r.t);
}

export function markReminderFired(id: string, at: number): void {
  run(`UPDATE reminders SET fired_at = ? WHERE id = ?`, [at, id]);
}

/** The quick-snooze minutes chosen in the (first) Reminders widget's settings. */
export function reminderSnoozeMinutes(): number {
  const row = get(`SELECT settings FROM widgets WHERE kind = 'reminders' ORDER BY sort, created_at LIMIT 1`);
  try {
    const n = Number((JSON.parse(String(row?.settings ?? "{}")) as { remSnooze?: unknown }).remSnooze);
    return Number.isFinite(n) && n > 0 && n <= 24 * 60 ? n : 10;
  } catch {
    return 10;
  }
}

/* ---------------------------------------------------------- daily planner -- */

const PLAN_KINDS: PlanBlockKind[] = ["task", "focus", "break", "custom"];

function toPlanBlock(r: Row): PlanBlock {
  return {
    id: String(r.id),
    day: String(r.day),
    kind: PLAN_KINDS.includes(r.kind as PlanBlockKind) ? (r.kind as PlanBlockKind) : "custom",
    taskId: r.task_id ? String(r.task_id) : null,
    title: String(r.title ?? ""),
    start: Number(r.start),
    end: Number(r.end),
    done: Number(r.done) === 1,
    locked: Number(r.locked) === 1,
  };
}

function toPlanDay(r: Row): PlanDay {
  return {
    day: String(r.day),
    status: r.status === "approved" ? "approved" : "draft",
    approvedAt: r.approved_at === null || r.approved_at === undefined ? null : Number(r.approved_at),
    intention: String(r.intention ?? ""),
  };
}

export function listPlanBlocks(fromDay: string): PlanBlock[] {
  return all(`SELECT * FROM plan_blocks WHERE day >= ? ORDER BY start`, [fromDay]).map(toPlanBlock);
}

export function planBlocksFor(day: string): PlanBlock[] {
  return all(`SELECT * FROM plan_blocks WHERE day = ? ORDER BY start`, [day]).map(toPlanBlock);
}

export function listPlanDays(fromDay: string): PlanDay[] {
  return all(`SELECT * FROM plan_days WHERE day >= ? ORDER BY day`, [fromDay]).map(toPlanDay);
}

export function planDay(day: string): PlanDay {
  const r = get(`SELECT * FROM plan_days WHERE day = ?`, [day]);
  return r ? toPlanDay(r) : { day, status: "draft", approvedAt: null, intention: "" };
}

function dayStartFor(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
}

/** Replaces a day's blocks with `blocks` (ids kept where given). Returns the saved ids in order. */
export function savePlanBlocks(day: string, blocks: PlanBlockInput[]): string[] {
  if (!isDayKey(day)) throw new Error("That isn't a day.");
  const from = dayStartFor(day);
  const clean = (Array.isArray(blocks) ? blocks : []).flatMap((b) => {
    const start = Math.round(Number(b?.start));
    const end = Math.round(Number(b?.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    // a block belongs to the day it starts on (a little slack either side)
    if (start < from - 6 * 3_600_000 || start >= from + 30 * 3_600_000) return [];
    const kind: PlanBlockKind = PLAN_KINDS.includes(b.kind) ? b.kind : "custom";
    const taskId = kind === "task" && typeof b.taskId === "string" && b.taskId ? b.taskId : null;
    const title = String(b.title ?? "").trim().slice(0, 200);
    if (!title && !taskId) return [];
    const finalKind: PlanBlockKind = kind === "task" && !taskId ? "custom" : kind;
    return [
      {
        id: typeof b.id === "string" && /^[a-z0-9-]{8,64}$/i.test(b.id) ? b.id : randomUUID(),
        kind: finalKind,
        taskId,
        title: title || "Task",
        start,
        end: Math.min(end, start + 16 * 3_600_000),
        done: b.done === true,
        locked: b.locked === true,
      },
    ];
  });
  const now = Date.now();
  run(`DELETE FROM plan_blocks WHERE day = ?`, [day]);
  for (const b of clean) {
    run(
      `INSERT OR REPLACE INTO plan_blocks (id, day, kind, task_id, title, start, end, done, locked, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.id, day, b.kind, b.taskId, b.title, b.start, b.end, bool(b.done), bool(b.locked), now],
    );
  }
  return clean.map((b) => b.id);
}

export function setPlanDay(day: string, p: { status?: PlanStatus; intention?: string }): void {
  if (!isDayKey(day)) throw new Error("That isn't a day.");
  const cur = planDay(day);
  const status: PlanStatus = p.status === "approved" || p.status === "draft" ? p.status : cur.status;
  const approvedAt =
    status === "approved" ? (p.status === "approved" ? Date.now() : cur.approvedAt) : null;
  const intention = typeof p.intention === "string" ? p.intention.trim().slice(0, 200) : cur.intention;
  run(
    `INSERT INTO plan_days (day, status, approved_at, intention) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET status = excluded.status, approved_at = excluded.approved_at,
       intention = excluded.intention`,
    [day, status, approvedAt, intention],
  );
}

export function plannerSettings(): PlannerSettings {
  return cleanPlannerSettings(getMetaJson<Partial<PlannerSettings>>("plannerSettings", {}));
}

export function setPlannerSettings(patch: Partial<PlannerSettings>): void {
  setMetaJson("plannerSettings", cleanPlannerSettings({ ...plannerSettings(), ...(patch ?? {}) }));
}

export function getTask(id: string): TaskRow | null {
  const r = get(`SELECT * FROM tasks WHERE id = ?`, [id]);
  return r ? toTask(r) : null;
}

export function listTasks(): TaskRow[] {
  return all(`SELECT * FROM tasks ORDER BY sort, created_at`).map(toTask);
}

/** Timed events that take up time between `from` and `to` (yours, and connected ones you haven't declined). */
/** Timed calendar events (not declined) overlapping [from, to). */
export function calendarBusy(from: number, to: number): { id: string; title: string; start: number; end: number }[] {
  const pick = (r: Row) => ({ id: String(r.id), title: String(r.title), start: Number(r.start), end: Number(r.end) });
  const own = all(
    `SELECT id, title, start, end FROM calendar_events WHERE all_day = 0 AND start < ? AND end > ?`,
    [to, from],
  ).map(pick);
  const connected = all(
    `SELECT e.id, e.title, e.start, e.end FROM calendar_remote_events e
     JOIN calendar_accounts a ON a.id = e.account_id
     WHERE a.status = 'connected' AND e.all_day = 0
       AND (e.my_status IS NULL OR e.my_status <> 'declined') AND e.start < ? AND e.end > ?`,
    [to, from],
  ).map(pick);
  return [...own, ...connected].sort((a, b) => a.start - b.start);
}

/* ---------------------------------------------------------- quick capture -- */

function toCapture(r: Row): CaptureRow {
  return {
    id: String(r.id),
    text: String(r.text),
    kind: CAPTURE_KINDS.includes(r.kind as CaptureKind) ? (r.kind as CaptureKind) : "note",
    targetId: r.target_id ? String(r.target_id) : null,
    done: Number(r.done) === 1,
    createdAt: Number(r.created_at),
  };
}

/** The newest 300 captures, plus every note still in the inbox. */
export function listCaptures(): CaptureRow[] {
  return all(
    `SELECT * FROM captures
     WHERE id IN (SELECT id FROM captures ORDER BY created_at DESC LIMIT 300)
        OR (kind = 'note' AND done = 0)
     ORDER BY created_at DESC`,
  ).map(toCapture);
}

export function getCapture(id: string): CaptureRow | null {
  const r = get(`SELECT * FROM captures WHERE id = ?`, [id]);
  return r ? toCapture(r) : null;
}

export function insertCapture(c: { text: string; kind: CaptureKind; targetId: string | null }): string {
  const id = randomUUID();
  run(`INSERT INTO captures (id, text, kind, target_id, done, created_at) VALUES (?, ?, ?, ?, 0, ?)`, [
    id,
    c.text,
    c.kind,
    c.targetId,
    Date.now(),
  ]);
  return id;
}

export function updateCapture(id: string, p: { kind?: CaptureKind; targetId?: string | null; done?: boolean }): void {
  const cols: [string, Cell][] = [];
  if (p.kind !== undefined) cols.push(["kind", p.kind]);
  if (p.targetId !== undefined) cols.push(["target_id", p.targetId]);
  if (p.done !== undefined) cols.push(["done", bool(p.done)]);
  if (cols.length) patch("captures", id, cols);
}

export function deleteCaptures(ids: string[]): void {
  if (!ids.length) return;
  run(`DELETE FROM captures WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
}

/** Adds a paragraph to the end of a Note widget (kept in its history). */
export function appendToNote(widgetId: string, text: string): void {
  const row = get(`SELECT kind, settings FROM widgets WHERE id = ?`, [widgetId]);
  if (!row || row.kind !== "blank") throw new Error("That note is gone.");
  let note = "";
  try {
    note = String((JSON.parse(String(row.settings)) as { note?: unknown }).note ?? "");
  } catch {
    /* empty note */
  }
  const next = note.trim() ? `${note.replace(/\s+$/, "")}\n\n${text}` : text;
  updateWidgetSettings(widgetId, { note: next }, { checkpoint: true });
}

export function captureSettings(): CaptureSettings {
  return cleanCaptureSettings(getMetaJson<Partial<CaptureSettings>>("captureSettings", {}));
}

export function setCaptureSettings(patch: Partial<CaptureSettings>): void {
  setMetaJson("captureSettings", cleanCaptureSettings({ ...captureSettings(), ...(patch ?? {}) }));
}

/* --------------------------------------------------------- shopping lists -- */

function toShoppingList(r: Row): ShoppingList {
  return { id: String(r.id), name: String(r.name), sort: Number(r.sort), createdAt: Number(r.created_at) };
}

function toShoppingItem(r: Row): ShoppingItem {
  return {
    id: String(r.id),
    listId: String(r.list_id),
    name: String(r.name),
    qty: String(r.qty ?? ""),
    aisle: isAisle(r.aisle) ? r.aisle : "other",
    note: String(r.note ?? ""),
    price: r.price === null || r.price === undefined ? null : Number(r.price),
    checked: Number(r.checked) === 1,
    checkedAt: r.checked_at ? Number(r.checked_at) : null,
    createdAt: Number(r.created_at),
  };
}

export function listShoppingLists(): ShoppingList[] {
  return all(`SELECT * FROM shopping_lists ORDER BY sort, created_at`).map(toShoppingList);
}

export function getShoppingList(id: string): ShoppingList | null {
  const r = get(`SELECT * FROM shopping_lists WHERE id = ?`, [id]);
  return r ? toShoppingList(r) : null;
}

export function findShoppingList(name: string): ShoppingList | null {
  const n = name.trim().toLowerCase();
  const lists = listShoppingLists();
  return lists.find((l) => l.name.toLowerCase() === n) ?? lists.find((l) => l.name.toLowerCase().startsWith(n)) ?? null;
}

export function createShoppingList(name: string): string {
  const id = randomUUID();
  const sort = Number(get(`SELECT COALESCE(MAX(sort), 0) m FROM shopping_lists`)?.m ?? 0) + 1;
  run(`INSERT INTO shopping_lists (id, name, sort, created_at) VALUES (?, ?, ?, ?)`, [
    id,
    name.trim().slice(0, 60) || "Shopping",
    sort,
    Date.now(),
  ]);
  return id;
}

/** The first list, made ("Groceries") if there are none yet. */
export function ensureShoppingList(): string {
  return listShoppingLists()[0]?.id ?? createShoppingList("Groceries");
}

export function renameShoppingList(id: string, name: string): void {
  const n = name.trim().slice(0, 60);
  if (n) patch("shopping_lists", id, [["name", n]]);
}

export function deleteShoppingList(id: string): void {
  run(`DELETE FROM shopping_items WHERE list_id = ?`, [id]);
  run(`DELETE FROM shopping_lists WHERE id = ?`, [id]);
}

export function listShoppingItems(listId?: string): ShoppingItem[] {
  return (
    listId
      ? all(`SELECT * FROM shopping_items WHERE list_id = ? ORDER BY created_at`, [listId])
      : all(`SELECT * FROM shopping_items ORDER BY created_at`)
  ).map(toShoppingItem);
}

export function insertShoppingItem(i: {
  listId: string;
  name: string;
  qty: string;
  note: string;
  price: number | null;
  aisle: string;
}): string {
  const id = randomUUID();
  run(
    `INSERT INTO shopping_items (id, list_id, name, qty, aisle, note, price, checked, checked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
    [id, i.listId, i.name, i.qty, isAisle(i.aisle) ? i.aisle : "other", i.note, i.price, Date.now()],
  );
  return id;
}

export function updateShoppingItem(id: string, p: Partial<ShoppingItem>): void {
  const cols: [string, Cell][] = [];
  if (typeof p.name === "string" && p.name.trim()) cols.push(["name", p.name.trim().slice(0, 120)]);
  if (typeof p.qty === "string") cols.push(["qty", p.qty.trim().slice(0, 30)]);
  if (typeof p.note === "string") cols.push(["note", p.note.trim().slice(0, 200)]);
  if (p.price === null || (typeof p.price === "number" && Number.isFinite(p.price) && p.price >= 0)) {
    cols.push(["price", p.price === null ? null : Math.round(p.price)]);
  }
  if (typeof p.listId === "string" && getShoppingList(p.listId)) cols.push(["list_id", p.listId]);
  if (isAisle(p.aisle)) {
    cols.push(["aisle", p.aisle]);
    const r = get(`SELECT name FROM shopping_items WHERE id = ?`, [id]);
    if (r) rememberAisle(String(r.name), p.aisle);
  }
  if (typeof p.checked === "boolean") {
    cols.push(["checked", bool(p.checked)]);
    cols.push(["checked_at", p.checked ? Date.now() : null]);
  }
  if (cols.length) patch("shopping_items", id, cols);
}

/** Puts items back exactly (for undo). */
export function putShoppingItems(items: ShoppingItem[]): void {
  for (const i of items) {
    if (!getShoppingList(String(i.listId))) continue;
    run(
      `INSERT INTO shopping_items (id, list_id, name, qty, aisle, note, price, checked, checked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET list_id = excluded.list_id, name = excluded.name, qty = excluded.qty,
         aisle = excluded.aisle, note = excluded.note, price = excluded.price, checked = excluded.checked,
         checked_at = excluded.checked_at`,
      [
        String(i.id),
        String(i.listId),
        String(i.name),
        String(i.qty ?? ""),
        isAisle(i.aisle) ? i.aisle : "other",
        String(i.note ?? ""),
        i.price === null || i.price === undefined ? null : Math.round(Number(i.price)),
        bool(i.checked),
        i.checkedAt ?? null,
        Number(i.createdAt) || Date.now(),
      ],
    );
  }
}

export function deleteShoppingItems(ids: string[]): void {
  if (!ids.length) return;
  run(`DELETE FROM shopping_items WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
}

function toHistory(r: Row): ShoppingHistory {
  return {
    key: String(r.key),
    name: String(r.name),
    aisle: isAisle(r.aisle) ? r.aisle : "other",
    qty: String(r.qty ?? ""),
    price: r.price === null || r.price === undefined ? null : Number(r.price),
    count: Number(r.count),
    lastAt: Number(r.last_at),
  };
}

export function listShoppingHistory(): ShoppingHistory[] {
  return all(`SELECT * FROM shopping_history ORDER BY count DESC, last_at DESC LIMIT 400`).map(toHistory);
}

/** Done shopping: one more purchase of this item. */
export function recordBought(i: ShoppingItem): void {
  run(
    `INSERT INTO shopping_history (key, name, aisle, qty, price, count, last_at) VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET name = excluded.name, aisle = excluded.aisle, qty = excluded.qty,
       price = COALESCE(excluded.price, shopping_history.price), count = shopping_history.count + 1,
       last_at = excluded.last_at`,
    [itemKey(i.name), i.name, i.aisle, i.qty, i.price, Date.now()],
  );
}

/** Moving an item to another aisle teaches where it lives. */
function rememberAisle(name: string, aisle: string): void {
  run(
    `INSERT INTO shopping_history (key, name, aisle, qty, price, count, last_at) VALUES (?, ?, ?, '', NULL, 0, ?)
     ON CONFLICT(key) DO UPDATE SET aisle = excluded.aisle`,
    [itemKey(name), name, aisle, Date.now()],
  );
}

export function forgetShoppingHistory(key: string): void {
  run(`DELETE FROM shopping_history WHERE key = ?`, [key]);
}

export function shoppingSettings(): ShoppingSettings {
  return cleanShoppingSettings(getMetaJson<Partial<ShoppingSettings>>("shoppingSettings", {}));
}

export function setShoppingSettings(p: Partial<ShoppingSettings>): void {
  setMetaJson("shoppingSettings", cleanShoppingSettings({ ...shoppingSettings(), ...(p ?? {}) }));
}

/* ---------------------------------------------------------------- journal -- */

/*
 * Entry text is encrypted with AES-256-GCM. The key is random and kept in the
 * meta table wrapped by the OS keychain (DPAPI on Windows), so a copied
 * database file can't be read elsewhere. A passcode, when set, hides the
 * journal in the app: while it's locked no entry text leaves this process.
 */

let journalKeyCache: Buffer | null = null;
let journalLocked: boolean | null = null;
const journalPlainCache = new Map<string, { at: number; body: string }>();

function journalKey(): Buffer {
  if (journalKeyCache) return journalKeyCache;
  const stored = getMetaRaw("journalKey");
  if (stored) {
    const hex = decryptSecret(Buffer.from(stored, "base64"));
    if (hex && /^[0-9a-f]{64}$/.test(hex)) return (journalKeyCache = Buffer.from(hex, "hex"));
    throw new Error("This journal's key can't be opened on this computer.");
  }
  const key = randomBytes(32);
  setMetaRaw("journalKey", encryptSecret(key.toString("hex")).toString("base64"));
  return (journalKeyCache = key);
}

function sealJournal(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", journalKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64")}`;
}

function openJournal(stored: string): string {
  if (!stored) return "";
  if (!stored.startsWith("v1:")) return stored;
  const buf = Buffer.from(stored.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", journalKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

function journalLockRecord(): { salt: string; hash: string } | null {
  const l = getMetaJson<{ salt?: string; hash?: string } | null>("journalLock", null);
  return l?.salt && l.hash ? { salt: l.salt, hash: l.hash } : null;
}

/** Locked at every start when a passcode is set. */
export function isJournalLocked(): boolean {
  if (journalLocked === null) journalLocked = journalLockRecord() !== null;
  return journalLocked;
}

function passHash(code: string, salt: string): Buffer {
  return scryptSync(code.normalize("NFKC"), Buffer.from(salt, "hex"), 32, { N: 16384, r: 8, p: 1 });
}

function passOk(code: string): boolean {
  const l = journalLockRecord();
  if (!l) return true;
  const want = Buffer.from(l.hash, "hex");
  const got = passHash(String(code ?? ""), l.salt);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function unlockJournal(code: string): boolean {
  if (!passOk(code)) return false;
  journalLocked = false;
  return true;
}

export function lockJournal(): void {
  if (journalLockRecord()) journalLocked = true;
  journalPlainCache.clear();
}

/** Sets, changes (needs the current one) or removes (empty `next`) the passcode. */
export function setJournalPasscode(current: string, next: string): void {
  if (journalLockRecord() && !passOk(current)) throw new Error("That's not the current passcode.");
  const code = String(next ?? "");
  if (!code) {
    run(`DELETE FROM meta WHERE key = 'journalLock'`);
    journalLocked = false;
    flush();
    return;
  }
  if (code.length < 4) throw new Error("Use at least 4 characters.");
  const salt = randomBytes(16).toString("hex");
  setMetaJson("journalLock", { salt, hash: passHash(code, salt).toString("hex") });
  journalLocked = false;
}

/**
 * Forgot the passcode, and the OS confirmed it's the computer's user: removes
 * the passcode and keeps every entry (they're protected by the OS account's
 * key, not the passcode). Only main calls this, after the OS check passes.
 */
export function resetJournalPasscode(): void {
  run(`DELETE FROM meta WHERE key = 'journalLock'`);
  journalLocked = false;
  flush();
}

/** Forgot the passcode and can't confirm it's them: deletes every entry and the passcode. */
export function eraseJournal(): void {
  run(`DELETE FROM journal_entries`);
  run(`DELETE FROM meta WHERE key = 'journalLock'`);
  journalPlainCache.clear();
  journalLocked = false;
  flush();
}

function needUnlocked(): void {
  if (isJournalLocked()) throw new Error("The journal is locked.");
}

function toJournalEntry(r: Row, withBody: boolean): JournalEntry {
  const id = String(r.id);
  const at = Number(r.updated_at);
  let body = "";
  if (withBody) {
    const hit = journalPlainCache.get(id);
    if (hit && hit.at === at) body = hit.body;
    else {
      try {
        body = openJournal(String(r.body ?? ""));
      } catch {
        body = "[This entry can't be read on this computer.]";
      }
      journalPlainCache.set(id, { at, body });
    }
  }
  let tags: string[] = [];
  try {
    const t = JSON.parse(String(r.tags ?? "[]"));
    if (Array.isArray(t)) tags = t.map(String);
  } catch {
    /* none */
  }
  const mood = Number(r.mood);
  return {
    id,
    day: String(r.day),
    body,
    mood: r.mood != null && isMood(mood) ? mood : null,
    tags,
    prompt: String(r.prompt ?? ""),
    words: Number(r.words ?? 0),
    createdAt: Number(r.created_at),
    updatedAt: at,
  };
}

/** Every entry, newest day first; bodies are empty while locked. */
export function listJournalEntries(): JournalEntry[] {
  const open = !isJournalLocked();
  return all(`SELECT * FROM journal_entries ORDER BY day DESC`).map((r) => toJournalEntry(r, open));
}

export function getJournalEntry(day: string): JournalEntry | null {
  const r = get(`SELECT * FROM journal_entries WHERE day = ?`, [day]);
  return r ? toJournalEntry(r, !isJournalLocked()) : null;
}

export interface JournalWrite {
  body?: string;
  mood?: Mood | null;
  prompt?: string;
}

/** Creates or changes the entry for `day`. An entry left with nothing in it is removed. */
export function saveJournalEntry(day: string, p: JournalWrite): JournalEntry | null {
  needUnlocked();
  if (!isDayKey(day)) throw new Error("That isn't a day.");
  const cur = getJournalEntry(day);
  const body = typeof p.body === "string" ? p.body.slice(0, 200_000) : (cur?.body ?? "");
  const mood = p.mood === undefined ? (cur?.mood ?? null) : isMood(p.mood) ? p.mood : null;
  const prompt = typeof p.prompt === "string" ? p.prompt.slice(0, 300) : (cur?.prompt ?? "");
  if (!body.trim() && mood === null) {
    if (cur) run(`DELETE FROM journal_entries WHERE id = ?`, [cur.id]);
    return null;
  }
  const now = Date.now();
  const id = cur?.id ?? randomUUID();
  const at = cur && now <= cur.updatedAt ? cur.updatedAt + 1 : now;
  run(
    `INSERT INTO journal_entries (id, day, body, mood, tags, prompt, words, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET body = excluded.body, mood = excluded.mood, tags = excluded.tags,
       prompt = excluded.prompt, words = excluded.words, updated_at = excluded.updated_at`,
    [
      id,
      day,
      sealJournal(body),
      mood,
      JSON.stringify(extractTags(body)),
      prompt,
      countWords(body),
      cur?.createdAt ?? now,
      at,
    ],
  );
  journalPlainCache.set(id, { at, body });
  return getJournalEntry(day);
}

export function deleteJournalEntries(days: string[]): void {
  needUnlocked();
  if (!days.length) return;
  run(`DELETE FROM journal_entries WHERE day IN (${days.map(() => "?").join(",")})`, days);
}

/** Puts entries back exactly (undo). */
export function putJournalEntries(entries: JournalEntry[]): void {
  needUnlocked();
  for (const e of entries) {
    if (!isDayKey(e.day)) continue;
    const body = String(e.body ?? "");
    run(
      `INSERT INTO journal_entries (id, day, body, mood, tags, prompt, words, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET id = excluded.id, body = excluded.body, mood = excluded.mood,
         tags = excluded.tags, prompt = excluded.prompt, words = excluded.words,
         created_at = excluded.created_at, updated_at = excluded.updated_at`,
      [
        String(e.id || randomUUID()),
        e.day,
        sealJournal(body),
        isMood(e.mood) ? e.mood : null,
        JSON.stringify(extractTags(body)),
        String(e.prompt ?? "").slice(0, 300),
        countWords(body),
        Number(e.createdAt) || Date.now(),
        Number(e.updatedAt) || Date.now(),
      ],
    );
  }
}

export function journalSettings(): JournalSettings {
  return cleanJournalSettings(getMetaJson<Partial<JournalSettings>>("journalSettings", {}));
}

export function setJournalSettings(p: Partial<JournalSettings>): void {
  setMetaJson("journalSettings", cleanJournalSettings({ ...journalSettings(), ...(p ?? {}) }));
}

let keychainReady: boolean | null = null;

export function journalMeta(): JournalMeta {
  if (keychainReady === null) {
    try {
      keychainReady = !encryptSecret("x").subarray(0, 6).toString("utf8").startsWith("plain:");
    } catch {
      keychainReady = false;
    }
  }
  return {
    settings: journalSettings(),
    hasPasscode: journalLockRecord() !== null,
    locked: isJournalLocked(),
    encrypted: keychainReady,
  };
}

/* --------------------------------------------------------------- projects -- */

function toProject(r: Row): ProjectRow {
  return {
    id: String(r.id),
    name: String(r.name),
    detail: String(r.detail ?? ""),
    status: isProjectStatus(r.status) ? r.status : "active",
    color: isPageColor(r.color) ? String(r.color) : "ink",
    targetDate: r.target_date == null || !isDayKey(r.target_date) ? null : String(r.target_date),
    sort: Number(r.sort ?? 0),
    createdAt: Number(r.created_at),
  };
}

function projectName(v: unknown): string {
  const n = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!n) throw new Error("A project needs a name.");
  return n;
}

function insertProject(name: string, p: ProjectPatch = {}): string {
  const id = randomUUID();
  const rows = all(`SELECT color, sort FROM projects`);
  const used = rows.map((r) => String(r.color));
  const sort = rows.reduce((m, r) => Math.max(m, Number(r.sort)), 0) + 1;
  run(
    `INSERT INTO projects (id, name, detail, status, color, target_date, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      String(p.detail ?? "").slice(0, 2000),
      isProjectStatus(p.status) ? p.status : "active",
      isPageColor(p.color) ? p.color : nextPageColor(used),
      p.targetDate && isDayKey(p.targetDate) ? p.targetDate : null,
      sort,
      Date.now(),
    ],
  );
  return id;
}

/** Every project, making records for names tasks and goals use but that have none yet. */
export function listProjects(): ProjectRow[] {
  const have = all(`SELECT name FROM projects`).map((r) => String(r.name));
  const used = all(
    `SELECT project AS name, MIN(created_at) AS at FROM tasks WHERE project <> '' GROUP BY lower(project)
     UNION ALL
     SELECT project AS name, MIN(created_at) AS at FROM goals WHERE project IS NOT NULL AND project <> '' GROUP BY lower(project)
     ORDER BY at`,
  ).map((r) => String(r.name).trim());
  for (const n of used) {
    if (n && !have.some((h) => sameProject(h, n))) {
      insertProject(n);
      have.push(n);
    }
  }
  return all(`SELECT * FROM projects ORDER BY sort, created_at`).map(toProject);
}

export function getProject(id: string): ProjectRow | null {
  const r = get(`SELECT * FROM projects WHERE id = ?`, [id]);
  return r ? toProject(r) : null;
}

export function findProject(name: string): ProjectRow | null {
  return listProjects().find((p) => sameProject(p.name, name)) ?? null;
}

export function createProject(name: unknown, p: ProjectPatch = {}): string {
  const n = projectName(name);
  const clash = findProject(n);
  if (clash) throw new Error(`There's already a project called “${clash.name}”.`);
  return insertProject(n, p);
}

/** Renaming also renames it on every task and goal. */
export function updateProject(id: string, p: ProjectPatch): void {
  const cur = getProject(id);
  if (!cur) throw new Error("That project is gone.");
  const cols: [string, Cell][] = [];
  if (p.name !== undefined) {
    const n = projectName(p.name);
    const clash = listProjects().find((x) => x.id !== id && sameProject(x.name, n));
    if (clash) throw new Error(`There's already a project called “${clash.name}”.`);
    if (n !== cur.name) {
      cols.push(["name", n]);
      run(`UPDATE tasks SET project = ? WHERE lower(trim(project)) = lower(?)`, [n, cur.name.trim()]);
      run(`UPDATE goals SET project = ? WHERE lower(trim(project)) = lower(?)`, [n, cur.name.trim()]);
    }
  }
  if (p.detail !== undefined) cols.push(["detail", String(p.detail).slice(0, 2000)]);
  if (p.status !== undefined && isProjectStatus(p.status)) cols.push(["status", p.status]);
  if (p.color !== undefined && isPageColor(p.color)) cols.push(["color", p.color]);
  if (p.targetDate !== undefined) cols.push(["target_date", p.targetDate && isDayKey(p.targetDate) ? p.targetDate : null]);
  if (p.sort !== undefined && Number.isFinite(p.sort)) cols.push(["sort", p.sort]);
  patch("projects", id, cols);
}

/** Deletes the project and its tasks (their steps go with them); its goals stay, without a project. */
export function deleteProject(id: string): void {
  const cur = getProject(id);
  if (!cur) return;
  run(`DELETE FROM tasks WHERE lower(trim(project)) = lower(?)`, [cur.name.trim()]);
  run(`UPDATE goals SET project = NULL WHERE lower(trim(project)) = lower(?)`, [cur.name.trim()]);
  run(`DELETE FROM projects WHERE id = ?`, [id]);
}

/** Moves a task to a board column (and position). In progress pulls it into Today. */
export function moveTask(taskId: string, col: BoardColumn, sort?: number): void {
  const t = getTask(taskId);
  if (!t) throw new Error("That task is gone.");
  if (!isColumn(col)) throw new Error("That isn't a column.");
  const p: Partial<TaskRow> = {};
  if (col === "done") p.done = true;
  else {
    p.done = false;
    p.stage = col as TaskStage;
    if (col === "doing") p.section = "today";
  }
  if (sort !== undefined && Number.isFinite(sort)) p.sort = sort;
  updateTask(taskId, p);
}

/* ----------------------------------------------------------------- study -- */

function toSubject(r: Row): StudySubject {
  return {
    id: String(r.id),
    name: String(r.name),
    color: isPageColor(r.color) ? String(r.color) : "ink",
    weeklyMinutes: Number(r.weekly_minutes ?? 0),
    archived: Number(r.archived) === 1,
    sort: Number(r.sort ?? 0),
    createdAt: Number(r.created_at),
  };
}

function toExam(r: Row): StudyExam {
  let topics: string[] = [];
  try {
    const v = JSON.parse(String(r.topics ?? "[]"));
    if (Array.isArray(v)) topics = v.map(String);
  } catch {
    /* keep empty */
  }
  return {
    id: String(r.id),
    subjectId: String(r.subject_id),
    title: String(r.title),
    day: String(r.day),
    time: isHm(r.time) ? String(r.time) : null,
    topics,
    createdAt: Number(r.created_at),
  };
}

function toSession(r: Row): StudySession {
  return {
    id: String(r.id),
    subjectId: String(r.subject_id),
    examId: r.exam_id ? String(r.exam_id) : null,
    topic: String(r.topic ?? ""),
    start: Number(r.start),
    end: Number(r.end),
    done: Number(r.done) === 1,
    studied: r.studied == null ? null : Number(r.studied),
    notes: String(r.notes ?? ""),
    createdAt: Number(r.created_at),
  };
}

export function listSubjects(): StudySubject[] {
  return all(`SELECT * FROM study_subjects ORDER BY sort, created_at`).map(toSubject);
}

export function listExams(): StudyExam[] {
  return all(`SELECT * FROM study_exams ORDER BY day, created_at`).map(toExam);
}

/** Sessions from 120 days back on (enough for stats and the week views). */
export function listSessions(): StudySession[] {
  return all(`SELECT * FROM study_sessions WHERE start >= ? ORDER BY start`, [Date.now() - 120 * 86_400_000]).map(
    toSession,
  );
}

export function getSession(id: string): StudySession | null {
  const r = get(`SELECT * FROM study_sessions WHERE id = ?`, [id]);
  return r ? toSession(r) : null;
}

export function getSubject(id: string): StudySubject | null {
  const r = get(`SELECT * FROM study_subjects WHERE id = ?`, [id]);
  return r ? toSubject(r) : null;
}

export function findSubject(name: string): StudySubject | null {
  const n = name.trim().toLowerCase();
  return listSubjects().find((s) => s.name.toLowerCase() === n) ?? null;
}

export function studySettings(): StudySettings {
  return cleanStudySettings(getMetaJson<Partial<StudySettings>>("studySettings", {}));
}

export function setStudySettings(p: Partial<StudySettings>): void {
  setMetaJson("studySettings", cleanStudySettings({ ...studySettings(), ...(p ?? {}) }));
}

function subjectName(v: unknown): string {
  const n = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!n) throw new Error("A subject needs a name.");
  return n;
}

export function createSubject(name: unknown, p: SubjectPatch = {}): string {
  const n = subjectName(name);
  const clash = findSubject(n);
  if (clash) throw new Error(`There's already a subject called “${clash.name}”.`);
  const rows = all(`SELECT color, sort FROM study_subjects`);
  const id = randomUUID();
  run(
    `INSERT INTO study_subjects (id, name, color, weekly_minutes, archived, sort, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      n,
      isPageColor(p.color) ? p.color : nextPageColor(rows.map((r) => String(r.color))),
      Math.max(0, Math.min(3000, Math.round(Number(p.weeklyMinutes ?? 0)) || 0)),
      rows.reduce((m, r) => Math.max(m, Number(r.sort)), 0) + 1,
      Date.now(),
    ],
  );
  return id;
}

export function updateSubject(id: string, p: SubjectPatch): void {
  if (!getSubject(id)) throw new Error("That subject is gone.");
  const cols: [string, Cell][] = [];
  if (p.name !== undefined) {
    const n = subjectName(p.name);
    const clash = findSubject(n);
    if (clash && clash.id !== id) throw new Error(`There's already a subject called “${clash.name}”.`);
    cols.push(["name", n]);
  }
  if (p.color !== undefined && isPageColor(p.color)) cols.push(["color", p.color]);
  if (p.weeklyMinutes !== undefined && Number.isFinite(p.weeklyMinutes))
    cols.push(["weekly_minutes", Math.max(0, Math.min(3000, Math.round(p.weeklyMinutes)))]);
  if (p.archived !== undefined) cols.push(["archived", p.archived ? 1 : 0]);
  if (p.sort !== undefined && Number.isFinite(p.sort)) cols.push(["sort", p.sort]);
  patch("study_subjects", id, cols);
}

/** Deletes the subject with its exams and sessions. */
export function deleteSubject(id: string): void {
  run(`DELETE FROM study_sessions WHERE subject_id = ?`, [id]);
  run(`DELETE FROM study_exams WHERE subject_id = ?`, [id]);
  run(`DELETE FROM study_subjects WHERE id = ?`, [id]);
}

function examFields(p: ExamPatch): [string, Cell][] {
  const cols: [string, Cell][] = [];
  if (p.subjectId !== undefined) {
    if (!getSubject(String(p.subjectId))) throw new Error("Pick a subject.");
    cols.push(["subject_id", String(p.subjectId)]);
  }
  if (p.title !== undefined) {
    const t = String(p.title).replace(/\s+/g, " ").trim().slice(0, 80);
    if (!t) throw new Error("The exam needs a name.");
    cols.push(["title", t]);
  }
  if (p.day !== undefined) {
    if (!isDayKey(p.day)) throw new Error("The exam needs a date.");
    cols.push(["day", p.day]);
  }
  if (p.time !== undefined) cols.push(["time", isHm(p.time) ? p.time : null]);
  if (p.topics !== undefined)
    cols.push(["topics", JSON.stringify(parseTopics((Array.isArray(p.topics) ? p.topics : []).join("\n")))]);
  return cols;
}

export function createExam(p: ExamPatch): string {
  if (!p.subjectId || !p.day) throw new Error("An exam needs a subject and a date.");
  const cols = examFields({ title: p.title || "Exam", topics: [], ...p });
  const id = randomUUID();
  const names = ["id", "created_at", ...cols.map(([c]) => c)];
  run(`INSERT INTO study_exams (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, [
    id,
    Date.now(),
    ...cols.map(([, v]) => v),
  ]);
  return id;
}

export function updateExam(id: string, p: ExamPatch): void {
  if (!get(`SELECT id FROM study_exams WHERE id = ?`, [id])) throw new Error("That exam is gone.");
  patch("study_exams", id, examFields(p));
}

/** Deletes the exam; its sessions stay, as ordinary sessions of the subject. */
export function deleteExam(id: string): void {
  run(`UPDATE study_sessions SET exam_id = NULL WHERE exam_id = ?`, [id]);
  run(`DELETE FROM study_exams WHERE id = ?`, [id]);
}

/** Calendar events, fixed day-plan blocks and other sessions overlapping [from, to). */
export function studyBusyBetween(from: number, to: number, exclude?: string): StudyBusy[] {
  const approved = new Set(all(`SELECT day FROM plan_days WHERE status = 'approved'`).map((r) => String(r.day)));
  const blocks = all(
    `SELECT b.id, b.day, b.locked, b.start, b.end, COALESCE(t.title, b.title) AS title
     FROM plan_blocks b LEFT JOIN tasks t ON t.id = b.task_id WHERE b.start < ? AND b.end > ? AND b.kind <> 'break'`,
    [to, from],
  )
    .filter((r) => Number(r.locked) === 1 || approved.has(String(r.day)))
    .map((r) => ({ id: String(r.id), title: String(r.title), start: Number(r.start), end: Number(r.end) }));
  const names = new Map(listSubjects().map((s) => [s.id, s.name]));
  const sessions = all(`SELECT * FROM study_sessions WHERE start < ? AND end > ?`, [to, from]).map(toSession);
  return studyBusy(
    { events: calendarBusy(from, to), blocks, sessions, subjectName: (id) => names.get(id) ?? "Study" },
    from,
    to,
    exclude,
  );
}

function checkSlot(start: number, end: number, exclude?: string): void {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 5 * 60_000)
    throw new Error("A session needs a start and an end.");
  if (end - start > 8 * 3_600_000) throw new Error("A session can be at most 8 hours.");
  const clash = clashesOf({ start, end }, studyBusyBetween(start, end, exclude))[0];
  if (clash) throw new Error(clashMessage(clash));
}

/** Adds sessions, refusing (all of them) if any would clash. */
export function addSessions(list: SessionInput[]): string[] {
  const ids: string[] = [];
  const subjects = new Set(listSubjects().map((s) => s.id));
  for (const x of list) if (!subjects.has(String(x.subjectId))) throw new Error("Pick a subject.");
  const added: { start: number; end: number }[] = [];
  for (const x of list) {
    const start = Math.round(Number(x.start));
    const end = Math.round(Number(x.end));
    checkSlot(start, end);
    if (added.some((a) => a.start < end && start < a.end)) throw new Error("Two of these sessions overlap.");
    added.push({ start, end });
  }
  for (const [i, x] of list.entries()) {
    const id = randomUUID();
    const examId = x.examId && get(`SELECT id FROM study_exams WHERE id = ?`, [x.examId]) ? x.examId : null;
    run(
      `INSERT INTO study_sessions (id, subject_id, exam_id, topic, start, end, done, studied, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        String(x.subjectId),
        examId,
        String(x.topic ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
        added[i]!.start,
        added[i]!.end,
        x.done ? 1 : 0,
        typeof x.studied === "number" ? Math.round(x.studied) : null,
        String(x.notes ?? "").slice(0, 2000),
        Date.now(),
      ],
    );
    ids.push(id);
  }
  return ids;
}

export function updateSession(id: string, p: SessionPatch): void {
  const cur = getSession(id);
  if (!cur) throw new Error("That session is gone.");
  const start = p.start !== undefined ? Math.round(p.start) : cur.start;
  const end = p.end !== undefined ? Math.round(p.end) : cur.end;
  if (start !== cur.start || end !== cur.end) checkSlot(start, end, id);
  const cols: [string, Cell][] = [];
  if (start !== cur.start) cols.push(["start", start]);
  if (end !== cur.end) cols.push(["end", end]);
  if (p.subjectId !== undefined) {
    if (!getSubject(p.subjectId)) throw new Error("Pick a subject.");
    cols.push(["subject_id", p.subjectId]);
  }
  if (p.examId !== undefined) cols.push(["exam_id", p.examId]);
  if (p.topic !== undefined) cols.push(["topic", String(p.topic).replace(/\s+/g, " ").trim().slice(0, 120)]);
  if (p.notes !== undefined) cols.push(["notes", String(p.notes).slice(0, 2000)]);
  if (p.done !== undefined) {
    cols.push(["done", p.done ? 1 : 0]);
    if (p.studied === undefined) cols.push(["studied", p.done ? Math.round((end - start) / 60_000) : null]);
  }
  if (p.studied !== undefined) cols.push(["studied", p.studied === null ? null : Math.max(0, Math.round(p.studied))]);
  patch("study_sessions", id, cols);
}

export function deleteSessions(ids: string[]): void {
  for (const id of ids) run(`DELETE FROM study_sessions WHERE id = ?`, [String(id)]);
}

/** Puts sessions back exactly as they were (for undo). */
export function putSessions(list: StudySession[]): void {
  for (const x of list) {
    run(
      `INSERT OR REPLACE INTO study_sessions (id, subject_id, exam_id, topic, start, end, done, studied, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [x.id, x.subjectId, x.examId, x.topic, x.start, x.end, x.done ? 1 : 0, x.studied, x.notes, x.createdAt],
    );
  }
}

/* -------------------------------------------------------------- briefing -- */

export function briefingSettings(): BriefingSettings {
  return cleanBriefingSettings(getMetaJson<Partial<BriefingSettings>>("briefingSettings", {}));
}

export function briefingNote(): BriefingNote | null {
  const n = getMetaJson<BriefingNote | null>("briefingNote", null);
  return n && typeof n.text === "string" && typeof n.day === "string" ? n : null;
}

/* ---------------------------------------------------------------- timers -- */

function toTimer(r: Row): TimerRow {
  let laps: number[] = [];
  try {
    const v = JSON.parse(String(r.laps ?? "[]"));
    if (Array.isArray(v)) laps = v.map(Number).filter(Number.isFinite);
  } catch {
    /* keep none */
  }
  return {
    id: String(r.id),
    kind: r.kind === "stopwatch" ? "stopwatch" : "timer",
    label: String(r.label ?? ""),
    durationMs: Number(r.duration_ms) || 0,
    startedAt: r.started_at == null ? null : Number(r.started_at),
    accumulatedMs: Number(r.accumulated_ms) || 0,
    laps,
    firedAt: r.fired_at == null ? null : Number(r.fired_at),
    createdAt: Number(r.created_at),
  };
}

export function listTimers(): TimerRow[] {
  return all(`SELECT * FROM timers ORDER BY created_at`).map(toTimer);
}

export function getTimer(id: string): TimerRow | null {
  const r = get(`SELECT * FROM timers WHERE id = ?`, [id]);
  return r ? toTimer(r) : null;
}

const timerLabel = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

/** Saves every field of a timer (new or existing). */
export function putTimer(t: TimerRow): void {
  run(
    `INSERT OR REPLACE INTO timers (id, kind, label, duration_ms, started_at, accumulated_ms, laps, fired_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      t.id,
      t.kind,
      timerLabel(t.label),
      Math.round(t.durationMs),
      t.startedAt,
      Math.round(t.accumulatedMs),
      JSON.stringify(t.laps.slice(-999)),
      t.firedAt,
      t.createdAt,
    ],
  );
}

export function createTimer(input: { kind?: TimerKind; label?: string; durationMs?: number; start?: boolean }): TimerRow {
  const kind: TimerKind = input.kind === "stopwatch" ? "stopwatch" : "timer";
  const durationMs = kind === "timer" ? Math.round(Number(input.durationMs)) : 0;
  if (kind === "timer" && (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > MAX_TIMER_MS))
    throw new Error("A timer needs a length between 1 second and 99 hours.");
  const now = Date.now();
  const t: TimerRow = {
    id: randomUUID(),
    kind,
    label: timerLabel(input.label),
    durationMs,
    startedAt: input.start ? now : null,
    accumulatedMs: 0,
    laps: [],
    firedAt: null,
    createdAt: now,
  };
  putTimer(t);
  return t;
}

export function timerActionDb(id: string, action: TimerAction): TimerRow {
  const t = getTimer(id);
  if (!t) throw new Error("That timer was deleted.");
  const next = applyAction(t, action, Date.now());
  if (next !== t) putTimer(next);
  return next;
}

/** Rename, or (when it isn't running) change a timer's length, which resets it. */
export function updateTimer(id: string, patch: { label?: string; durationMs?: number }): void {
  const t = getTimer(id);
  if (!t) throw new Error("That timer was deleted.");
  const next = { ...t };
  if (patch.label !== undefined) next.label = timerLabel(patch.label);
  if (patch.durationMs !== undefined && t.kind === "timer") {
    const ms = Math.round(Number(patch.durationMs));
    if (!Number.isFinite(ms) || ms < 1000 || ms > MAX_TIMER_MS) throw new Error("A timer needs a length between 1 second and 99 hours.");
    Object.assign(next, { durationMs: ms, accumulatedMs: 0, startedAt: null, firedAt: null });
  }
  putTimer(next);
}

export function deleteTimer(id: string): void {
  run(`DELETE FROM timers WHERE id = ?`, [id]);
}

export function markTimerFired(id: string, at: number): void {
  run(`UPDATE timers SET fired_at = ? WHERE id = ?`, [at, id]);
}

/* --------------------------------------------------------------- memories -- */

function toMemory(r: Row): MemoryRecord {
  return {
    id: String(r.id),
    text: String(r.text),
    kind: isMemoryKind(r.kind) ? r.kind : "other",
    source: r.source === "assistant" ? "assistant" : "you",
    context: String(r.context ?? ""),
    assistantCanUse: Number(r.assistant_can_use) === 1,
    pinned: Number(r.pinned) === 1,
    reviewed: Number(r.reviewed) === 1,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function listMemories(): MemoryRecord[] {
  return all(`SELECT * FROM memories ORDER BY pinned DESC, updated_at DESC`).map(toMemory);
}

export function getMemory(id: string): MemoryRecord | null {
  const r = get(`SELECT * FROM memories WHERE id = ?`, [id]);
  return r ? toMemory(r) : null;
}

/** A full id, or the 8-character one the Assistant sees. */
export function findMemoryId(idOrShort: string): string | null {
  const v = String(idOrShort ?? "").trim().replace(/^\[|\]$/g, "");
  if (!v) return null;
  if (getMemory(v)) return v;
  if (!/^[0-9a-f-]{4,}$/i.test(v)) return null;
  const hits = all(`SELECT id FROM memories WHERE id LIKE ?`, [`${v.toLowerCase()}%`]);
  return hits.length === 1 ? String(hits[0]!.id) : null;
}

/**
 * Saves a new memory, or, when the same fact is already there, refreshes that
 * one instead of keeping two. Returns the record and whether it was new.
 */
export function addMemory(input: {
  text: string;
  kind?: MemoryKind | null;
  source?: "you" | "assistant";
  context?: string;
}): { memory: MemoryRecord; created: boolean } {
  const text = cleanMemoryText(input.text);
  if (!text) throw new Error("Write what to remember.");
  const source = input.source === "assistant" ? "assistant" : "you";
  const now = Date.now();
  const dup = listMemories().find((m) => sameMemory(m.text, text));
  if (dup) {
    const kind = input.kind && isMemoryKind(input.kind) ? input.kind : dup.kind;
    // the user saying it again counts as checking it
    const reviewed = dup.reviewed || source === "you";
    // only case or punctuation differs: keep the wording that's there
    const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    run(`UPDATE memories SET text = ?, kind = ?, reviewed = ?, updated_at = ? WHERE id = ?`, [
      plain(dup.text) === plain(text) ? dup.text : text,
      kind,
      reviewed ? 1 : 0,
      now,
      dup.id,
    ]);
    return { memory: getMemory(dup.id)!, created: false };
  }
  const id = randomUUID();
  run(
    `INSERT INTO memories (id, text, kind, source, context, assistant_can_use, pinned, reviewed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
    [
      id,
      text,
      input.kind && isMemoryKind(input.kind) ? input.kind : guessKind(text),
      source,
      String(input.context ?? "").replace(/\s+/g, " ").trim().slice(0, MEMORY_CONTEXT_MAX),
      source === "you" ? 1 : 0,
      now,
      now,
    ],
  );
  return { memory: getMemory(id)!, created: true };
}

export function updateMemory(
  id: string,
  patch: Partial<Pick<MemoryRecord, "text" | "kind" | "assistantCanUse" | "pinned" | "reviewed">>,
): MemoryRecord {
  const m = getMemory(id);
  if (!m) throw new Error("That memory was deleted.");
  const next = { ...m };
  if (patch.text !== undefined) {
    const text = cleanMemoryText(patch.text);
    if (!text) throw new Error("A memory can't be empty. Delete it instead.");
    if (text !== m.text) {
      next.text = text;
      // correcting it is checking it
      next.reviewed = true;
    }
  }
  if (patch.kind !== undefined && isMemoryKind(patch.kind)) next.kind = patch.kind;
  if (patch.assistantCanUse !== undefined) next.assistantCanUse = !!patch.assistantCanUse;
  if (patch.pinned !== undefined) next.pinned = !!patch.pinned;
  if (patch.reviewed !== undefined) next.reviewed = !!patch.reviewed;
  const touched = next.text !== m.text || next.kind !== m.kind;
  run(
    `UPDATE memories SET text = ?, kind = ?, assistant_can_use = ?, pinned = ?, reviewed = ?, updated_at = ? WHERE id = ?`,
    [
      next.text,
      next.kind,
      next.assistantCanUse ? 1 : 0,
      next.pinned ? 1 : 0,
      next.reviewed ? 1 : 0,
      touched ? Date.now() : m.updatedAt,
      id,
    ],
  );
  return getMemory(id)!;
}

export function deleteMemories(ids: string[]): void {
  if (!ids.length) return;
  run(`DELETE FROM memories WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
}

/** Puts records back exactly (undo). */
export function putMemories(list: MemoryRecord[]): void {
  for (const m of list) {
    run(
      `INSERT OR REPLACE INTO memories (id, text, kind, source, context, assistant_can_use, pinned, reviewed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(m.id),
        cleanMemoryText(m.text) || "(empty)",
        isMemoryKind(m.kind) ? m.kind : "other",
        m.source === "assistant" ? "assistant" : "you",
        String(m.context ?? "").slice(0, MEMORY_CONTEXT_MAX),
        m.assistantCanUse ? 1 : 0,
        m.pinned ? 1 : 0,
        m.reviewed ? 1 : 0,
        Number(m.createdAt) || Date.now(),
        Number(m.updatedAt) || Date.now(),
      ],
    );
  }
}

export function timerSettings(): TimerSettings {
  return cleanTimerSettings(getMetaJson<Partial<TimerSettings>>("timerSettings", {}));
}

export function setTimerSettings(p: Partial<TimerSettings>): void {
  setMetaJson("timerSettings", cleanTimerSettings({ ...timerSettings(), ...(p ?? {}) }));
}
