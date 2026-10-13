import { randomUUID } from "node:crypto";
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
  DEFAULT_TODO_SETTINGS,
  DEFAULT_TRANSCRIBE_SETTINGS,
  type CalendarAccountRow,
  type CalendarAccountStatus,
  type CalendarEventRow,
  type CalendarProvider,
  type CalendarRemoteEventRow,
  type GoalRow,
  type NewCalendarEvent,
  type NewGoal,
  type NewPage,
  type NewStep,
  type NewTask,
  type NewWidget,
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

/** Public shape only — omits every secret/token column. */
function toCalendarAccount(r: Row): CalendarAccountRow {
  return {
    id: String(r.id),
    provider: String(r.provider) as CalendarProvider,
    label: String(r.label),
    accountEmail: r.account_email == null ? null : String(r.account_email),
    status: String(r.status) as CalendarAccountStatus,
    errorMessage: r.error_message == null ? null : String(r.error_message),
    lastSyncedAt: r.last_synced_at == null ? null : Number(r.last_synced_at),
    sort: Number(r.sort),
    createdAt: Number(r.created_at),
  };
}

function toCalendarRemoteEvent(r: Row): CalendarRemoteEventRow {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    title: String(r.title),
    location: String(r.location ?? ""),
    notes: String(r.notes ?? ""),
    start: Number(r.start),
    end: Number(r.end),
    allDay: Number(r.all_day) === 1,
    htmlLink: r.html_link == null ? null : String(r.html_link),
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

/* ------------------------------------------------------------------- meta --- */

function getMetaRaw(key: string): string | null {
  const row = get(`SELECT value FROM meta WHERE key = ?`, [key]);
  return row ? String(row.value) : null;
}

function setMetaRaw(key: string, value: string): void {
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
  removeOrphans();
  carryOver();
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
    meta: {
      carryOver: getMetaRaw("carryOver") === "1",
      currentPageId: getMetaRaw("currentPageId"),
    },
  };
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
            ? { title: "Typing", w: 560, h: 520, settings: "{}" }
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

export function updateWidgetSettings(id: string, settings: WidgetSettings): void {
  const row = get(`SELECT settings FROM widgets WHERE id = ?`, [id]);
  let current: WidgetSettings = {};
  try {
    current = row ? (JSON.parse(String(row.settings)) as WidgetSettings) : {};
  } catch {
    /* keep {} */
  }
  patch("widgets", id, [["settings", JSON.stringify({ ...current, ...settings })]]);
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
  const sort = Number(get(`SELECT COALESCE(MIN(sort), 0) m FROM tasks`)?.m ?? 0) - 1;
  run(
    `INSERT INTO tasks (id, goal_id, title, project, importance, section, done, due, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
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
  if (p.done !== undefined) cols.push(["done", bool(p.done)]);
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
  clientId: string | null;
  clientSecret: string | null;
  feedUrl: string | null;
  refreshToken: string | null;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
}

export function getCalendarAccountSecrets(id: string): CalendarAccountSecrets | undefined {
  const r = get(`SELECT * FROM calendar_accounts WHERE id = ?`, [id]);
  if (!r) return undefined;
  return {
    id: String(r.id),
    provider: String(r.provider) as CalendarProvider,
    clientId: r.client_id == null ? null : String(r.client_id),
    clientSecret: decryptSecret(r.client_secret_enc as Uint8Array | null),
    feedUrl: decryptSecret(r.feed_url_enc as Uint8Array | null),
    refreshToken: decryptSecret(r.refresh_token_enc as Uint8Array | null),
    accessToken: decryptSecret(r.access_token_enc as Uint8Array | null),
    accessTokenExpiresAt:
      r.access_token_expires_at == null ? null : Number(r.access_token_expires_at),
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

export function completeOAuthAccount(
  id: string,
  p: {
    accountEmail: string | null;
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: number;
  },
): void {
  run(
    `UPDATE calendar_accounts SET status = 'connected', error_message = NULL, account_email = ?,
       refresh_token_enc = ?, access_token_enc = ?, access_token_expires_at = ?
     WHERE id = ?`,
    [
      p.accountEmail,
      encryptSecret(p.refreshToken),
      encryptSecret(p.accessToken),
      p.accessTokenExpiresAt,
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
  run(`DELETE FROM calendar_accounts WHERE id = ?`, [id]);
}

export function replaceRemoteEvents(accountId: string, events: NormalizedEvent[]): void {
  run(`DELETE FROM calendar_remote_events WHERE account_id = ?`, [accountId]);
  for (const e of events) {
    run(
      `INSERT INTO calendar_remote_events (id, account_id, title, location, notes, start, end, all_day, html_link)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        accountId,
        e.title,
        e.location,
        e.notes,
        e.start,
        e.end,
        bool(e.allDay),
        e.htmlLink,
      ],
    );
  }
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

/* ------------------------------------------------- raw rows (assistant undo) -- */

/** Tables the assistant can change; undo restores their rows exactly. */
export type UndoTable = "tasks" | "steps" | "goals" | "calendar_events" | "widgets";

const UNDO_TABLES = new Set<UndoTable>(["tasks", "steps", "goals", "calendar_events", "widgets"]);

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
