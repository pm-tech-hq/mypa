/**
 * What the assistant can do. Every tool declares the data it touches; the
 * agent checks access before running it, writes record an exact undo, and
 * risky ones (deleting, installing code) wait for the user's approval.
 */
import type { ScopeId } from "../../shared/assistant";
import type { GoalHorizon, Importance, TaskSection, WidgetKind } from "../../shared/types";
import * as db from "../db";
import { allows } from "./settings";

/** JSON Schema subset understood by OpenAI, Anthropic and local models alike. */
export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export interface ToolContext {
  /** The page the user is looking at. */
  pageId: string | null;
  /** Builds a widget from a description (provided by the agent; needs a model). */
  buildWidget: (spec: {
    name: string;
    description: string;
  }) => Promise<{ pluginId: string; name: string }>;
}

export interface ToolResult {
  /** Sent back to the model. Keep it small. */
  result: unknown;
  /** Reverses exactly what the tool changed. */
  undo?: () => void | Promise<void>;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Core scope this tool needs; widget tools check their own scope inside run. */
  scope: ScopeId | null;
  need: "read" | "write";
  /** Asks first when "ask before risky actions" is on. */
  risky?: boolean;
  /** One line for the action card. */
  label: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}

export class ToolError extends Error {}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.trim() : fallback);
const quote = (v: unknown) => `“${str(v).slice(0, 60)}”`;

function require(scope: ScopeId, need: "read" | "write"): void {
  if (!allows(scope, need))
    throw new ToolError(
      `Not allowed: this needs ${need === "write" ? "permission to change" : "permission to see"} ${scope.replace("widget:", "the widget ")}. The user can allow it in Assistant settings.`,
    );
}

/** Local ISO-ish date/time → ms. Date-only means the end of that day. */
function parseWhen(v: unknown, endOfDay: boolean): number | null {
  const s = str(v);
  if (!s) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(dateOnly ? `${s}T${endOfDay ? "23:59" : "00:00"}:00` : s);
  if (Number.isNaN(d.getTime()))
    throw new ToolError(`“${s}” isn't a date I understand. Use YYYY-MM-DD or YYYY-MM-DDTHH:MM.`);
  return d.getTime();
}

function iso(ms: number | null): string | null {
  if (ms == null) return null;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function restoreRowsUndo(table: db.UndoTable, ids: string[]): () => void {
  const before = db.rawRows(table, ids);
  return () => db.restoreRows(table, before);
}

function defaultPage(ctx: ToolContext, pageId: unknown): string {
  const snap = db.getSnapshot();
  const wanted = str(pageId);
  if (wanted && snap.pages.some((p) => p.id === wanted)) return wanted;
  if (ctx.pageId && snap.pages.some((p) => p.id === ctx.pageId)) return ctx.pageId;
  const first = snap.pages[0];
  if (!first) throw new ToolError("There's no page to put it on.");
  return first.id;
}

/** Moves a freshly created widget to the first free spot on its page, so the
 *  assistant never stacks a widget on top of another. Scans left to right,
 *  top to bottom within the area the page already uses (at least 1280×800). */
function placeFree(widgetId: string): void {
  const snap = db.getSnapshot();
  const me = snap.widgets.find((w) => w.id === widgetId);
  if (!me) return;
  const others = snap.widgets.filter((w) => w.pageId === me.pageId && w.id !== me.id);
  const gap = 16;
  const width = Math.max(1280, ...others.map((o) => o.x + o.w + gap));
  const height = Math.max(800, ...others.map((o) => o.y + o.h + gap));
  const hits = (x: number, y: number) =>
    others.some(
      (o) =>
        x < o.x + o.w + gap && x + me.w + gap > o.x && y < o.y + o.h + gap && y + me.h + gap > o.y,
    );
  for (let y = gap; y <= height; y += 24) {
    for (let x = gap; x + me.w <= width; x += 24) {
      if (!hits(x, y)) {
        db.updateWidget(widgetId, { x, y });
        return;
      }
    }
  }
  // Page full: put it below everything.
  db.updateWidget(widgetId, { x: gap, y: height });
}

const IMPORTANCE = ["high", "medium", "low"];
const HORIZONS = ["week", "month", "quarter", "year", "someday"];

/* ================================================================ TASKS ==== */

const taskTools: ToolDef[] = [
  {
    name: "list_tasks",
    description:
      "List to-do tasks. Returns id, title, section (today/backlog), done, importance, project, due, goal and step count.",
    parameters: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: ["today", "backlog", "all"],
          description: "Default: all.",
        },
        include_done: { type: "boolean", description: "Include finished tasks. Default false." },
        query: { type: "string", description: "Only tasks whose title contains this text." },
      },
    },
    scope: "tasks",
    need: "read",
    label: () => "Looked at your tasks",
    run: (a) => {
      const snap = db.getSnapshot();
      const goals = new Map(snap.goals.map((g) => [g.id, g.title]));
      const q = str(a.query).toLowerCase();
      const section = str(a.section, "all");
      const tasks = snap.tasks
        .filter(
          (t) =>
            (section === "all" || t.section === section) && (a.include_done === true || !t.done),
        )
        .filter((t) => !q || t.title.toLowerCase().includes(q))
        .slice(0, 60)
        .map((t) => ({
          id: t.id,
          title: t.title,
          section: t.section,
          done: t.done,
          importance: t.importance,
          project: t.project,
          due: iso(t.due),
          goal: t.goalId ? (goals.get(t.goalId) ?? null) : null,
          steps: snap.steps.filter((s) => s.taskId === t.id).length,
        }));
      return { result: { tasks } };
    },
  },
  {
    name: "add_task",
    description:
      "Add a task. Due accepts YYYY-MM-DD (end of that day) or YYYY-MM-DDTHH:MM, in the user's local time.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        section: { type: "string", enum: ["today", "backlog"], description: "Default: today." },
        importance: { type: "string", enum: IMPORTANCE, description: "Default: medium." },
        project: { type: "string" },
        due: { type: "string" },
        goal_id: { type: "string", description: "Link to a goal from list_goals." },
        steps: { type: "array", items: { type: "string" }, description: "Optional sub-steps." },
      },
      required: ["title"],
    },
    scope: "tasks",
    need: "write",
    label: (a) => `Add task ${quote(a.title)}`,
    run: (a) => {
      const title = str(a.title);
      if (!title) throw new ToolError("A task needs a title.");
      const id = db.createTask({
        title,
        section: (str(a.section) === "backlog" ? "backlog" : "today") as TaskSection,
        importance: (IMPORTANCE.includes(str(a.importance))
          ? str(a.importance)
          : "medium") as Importance,
        project: str(a.project) || "myPA",
        due: parseWhen(a.due, true),
        goalId: str(a.goal_id) || null,
      });
      const steps = Array.isArray(a.steps)
        ? a.steps
            .map((s) => str(s))
            .filter(Boolean)
            .slice(0, 20)
        : [];
      for (const s of steps) db.createStep({ taskId: id, title: s });
      return { result: { id, steps: steps.length }, undo: () => db.deleteRows("tasks", [id]) };
    },
  },
  {
    name: "update_task",
    description:
      "Change a task: title, done, importance, section, due (null clears it), project or goal.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        done: { type: "boolean" },
        importance: { type: "string", enum: IMPORTANCE },
        section: { type: "string", enum: ["today", "backlog"] },
        due: { type: ["string", "null"] },
        project: { type: "string" },
        goal_id: { type: ["string", "null"] },
      },
      required: ["id"],
    },
    scope: "tasks",
    need: "write",
    label: (a) =>
      a.done === true ? "Complete a task" : a.done === false ? "Reopen a task" : "Update a task",
    run: (a) => {
      const id = str(a.id);
      const task = db.getSnapshot().tasks.find((t) => t.id === id);
      if (!task) throw new ToolError("No task with that id. Call list_tasks first.");
      const undo = restoreRowsUndo("tasks", [id]);
      db.updateTask(id, {
        ...(a.title !== undefined ? { title: str(a.title) || task.title } : {}),
        ...(typeof a.done === "boolean" ? { done: a.done } : {}),
        ...(IMPORTANCE.includes(str(a.importance))
          ? { importance: str(a.importance) as Importance }
          : {}),
        ...(str(a.section) === "today" || str(a.section) === "backlog"
          ? { section: str(a.section) as TaskSection }
          : {}),
        ...(a.due === null
          ? { due: null }
          : a.due !== undefined
            ? { due: parseWhen(a.due, true) }
            : {}),
        ...(a.project !== undefined ? { project: str(a.project) || task.project } : {}),
        ...(a.goal_id === null
          ? { goalId: null }
          : a.goal_id !== undefined
            ? { goalId: str(a.goal_id) }
            : {}),
      });
      return { result: { ok: true, title: task.title }, undo };
    },
  },
  {
    name: "delete_task",
    description: "Delete a task and its steps.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    scope: "tasks",
    need: "write",
    risky: true,
    label: (a) => {
      const t = db.getSnapshot().tasks.find((x) => x.id === str(a.id));
      return `Delete task ${quote(t?.title ?? "?")}`;
    },
    run: (a) => {
      const id = str(a.id);
      const rows = db.rawRows("tasks", [id]);
      if (!rows.length) throw new ToolError("No task with that id.");
      const steps = db.rawStepsForTasks([id]);
      db.deleteTask(id);
      return {
        result: { ok: true },
        undo: () => {
          db.restoreRows("tasks", rows);
          db.restoreRows("steps", steps);
        },
      };
    },
  },
  {
    name: "add_steps",
    description: "Add sub-steps to an existing task.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
      },
      required: ["task_id", "steps"],
    },
    scope: "tasks",
    need: "write",
    label: (a) => `Add ${Array.isArray(a.steps) ? a.steps.length : ""} steps`,
    run: (a) => {
      const taskId = str(a.task_id);
      if (!db.getSnapshot().tasks.some((t) => t.id === taskId))
        throw new ToolError("No task with that id.");
      const ids = (Array.isArray(a.steps) ? a.steps : [])
        .map((s) => str(s))
        .filter(Boolean)
        .slice(0, 20)
        .map((title) => db.createStep({ taskId, title }));
      return { result: { added: ids.length }, undo: () => db.deleteRows("steps", ids) };
    },
  },
  {
    name: "list_goals",
    description: "List goals with their timeline, status and task progress.",
    parameters: { type: "object", properties: {} },
    scope: "tasks",
    need: "read",
    label: () => "Looked at your goals",
    run: () => {
      const snap = db.getSnapshot();
      return {
        result: {
          goals: snap.goals.map((g) => {
            const tasks = snap.tasks.filter((t) => t.goalId === g.id);
            return {
              id: g.id,
              title: g.title,
              horizon: g.horizon,
              status: g.status,
              target_date: g.targetDate,
              detail: g.detail.slice(0, 200),
              tasks: tasks.length,
              done: tasks.filter((t) => t.done).length,
            };
          }),
        },
      };
    },
  },
  {
    name: "add_goal",
    description:
      "Add a goal. Horizon: week, month, quarter, year or someday. target_date: YYYY-MM-DD.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        horizon: { type: "string", enum: HORIZONS },
        detail: { type: "string" },
        target_date: { type: "string" },
      },
      required: ["title"],
    },
    scope: "tasks",
    need: "write",
    label: (a) => `Add goal ${quote(a.title)}`,
    run: (a) => {
      const title = str(a.title);
      if (!title) throw new ToolError("A goal needs a title.");
      const target = str(a.target_date);
      const id = db.createGoal({
        title,
        horizon: (HORIZONS.includes(str(a.horizon)) ? str(a.horizon) : "month") as GoalHorizon,
        detail: str(a.detail),
        targetDate: /^\d{4}-\d{2}-\d{2}$/.test(target) ? target : null,
      });
      return { result: { id }, undo: () => db.deleteRows("goals", [id]) };
    },
  },
];

/* ============================================================= CALENDAR ==== */

const calendarTools: ToolDef[] = [
  {
    name: "list_events",
    description:
      "List calendar events between two dates (local time). Includes the user's own events (editable) and connected calendars (read only).",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD. Default: today." },
        to: { type: "string", description: "YYYY-MM-DD, inclusive. Default: 7 days from now." },
      },
    },
    scope: "calendar",
    need: "read",
    label: () => "Looked at your calendar",
    run: (a) => {
      const snap = db.getSnapshot();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const from = a.from ? parseWhen(a.from, false)! : start.getTime();
      const to = a.to ? parseWhen(a.to, true)! : from + 8 * 86_400_000;
      const accounts = new Map(snap.calendarAccounts.map((c) => [c.id, c]));
      const own = snap.calendarEvents.map((e) => ({ ...e, source: "mine", editable: true }));
      const remote = snap.calendarRemoteEvents
        .filter((e) => accounts.get(e.accountId)?.status === "connected")
        .map((e) => ({
          ...e,
          source: accounts.get(e.accountId)?.label ?? "calendar",
          editable: false,
        }));
      const events = [...own, ...remote]
        .filter((e) => e.end >= from && e.start <= to)
        .sort((x, y) => x.start - y.start)
        .slice(0, 80)
        .map((e) => ({
          id: e.id,
          title: e.title,
          start: iso(e.start),
          end: iso(e.end),
          all_day: e.allDay,
          location: e.location || undefined,
          source: e.source,
          editable: e.editable,
        }));
      return { result: { events } };
    },
  },
  {
    name: "add_event",
    description:
      "Add an event to the user's own calendar. Times are local: YYYY-MM-DDTHH:MM. For all-day use YYYY-MM-DD and all_day true.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string", description: "Default: one hour after start." },
        all_day: { type: "boolean" },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title", "start"],
    },
    scope: "calendar",
    need: "write",
    label: (a) => `Add event ${quote(a.title)}`,
    run: (a) => {
      const title = str(a.title);
      if (!title) throw new ToolError("An event needs a title.");
      const allDay = a.all_day === true;
      const start = parseWhen(a.start, false);
      if (start == null) throw new ToolError("An event needs a start.");
      let end = a.end ? parseWhen(a.end, allDay) : null;
      if (allDay) {
        const d = new Date(start);
        d.setHours(0, 0, 0, 0);
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        end = Math.max(end ?? 0, next.getTime());
      }
      end ??= start + 3_600_000;
      if (end <= start) throw new ToolError("The end has to be after the start.");
      const id = db.createCalendarEvent({
        title,
        start,
        end,
        allDay,
        location: str(a.location),
        notes: str(a.notes),
      });
      return { result: { id }, undo: () => db.deleteRows("calendar_events", [id]) };
    },
  },
  {
    name: "update_event",
    description: "Change one of the user's own events (not connected-calendar events).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["id"],
    },
    scope: "calendar",
    need: "write",
    label: () => "Update an event",
    run: (a) => {
      const id = str(a.id);
      const ev = db.getSnapshot().calendarEvents.find((e) => e.id === id);
      if (!ev)
        throw new ToolError("No editable event with that id. Connected calendars are read only.");
      const undo = restoreRowsUndo("calendar_events", [id]);
      const start = a.start ? parseWhen(a.start, false)! : ev.start;
      const end = a.end ? parseWhen(a.end, false)! : a.start ? start + (ev.end - ev.start) : ev.end;
      if (end <= start) throw new ToolError("The end has to be after the start.");
      db.updateCalendarEvent(id, {
        ...(a.title !== undefined ? { title: str(a.title) || ev.title } : {}),
        start,
        end,
        ...(a.location !== undefined ? { location: str(a.location) } : {}),
        ...(a.notes !== undefined ? { notes: str(a.notes) } : {}),
      });
      return { result: { ok: true }, undo };
    },
  },
  {
    name: "delete_event",
    description: "Delete one of the user's own events.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    scope: "calendar",
    need: "write",
    risky: true,
    label: (a) => {
      const e = db.getSnapshot().calendarEvents.find((x) => x.id === str(a.id));
      return `Delete event ${quote(e?.title ?? "?")}`;
    },
    run: (a) => {
      const id = str(a.id);
      const rows = db.rawRows("calendar_events", [id]);
      if (!rows.length) throw new ToolError("No editable event with that id.");
      db.deleteCalendarEvent(id);
      return { result: { ok: true }, undo: () => db.restoreRows("calendar_events", rows) };
    },
  },
];

/* ================================================================ NOTES ==== */

function noteWidgets() {
  const snap = db.getSnapshot();
  const pages = new Map(snap.pages.map((p) => [p.id, p.title]));
  return snap.widgets
    .filter((w) => w.kind === "blank")
    .map((w) => ({ w, page: pages.get(w.pageId) ?? "" }));
}

const noteTools: ToolDef[] = [
  {
    name: "list_notes",
    description: "List Note widgets with their page and the start of their text.",
    parameters: { type: "object", properties: {} },
    scope: "notes",
    need: "read",
    label: () => "Looked at your notes",
    run: () => ({
      result: {
        notes: noteWidgets().map(({ w, page }) => ({
          id: w.id,
          title: w.title,
          page,
          preview: String(w.settings.note ?? "").slice(0, 160),
        })),
      },
    }),
  },
  {
    name: "read_note",
    description: "Read the full markdown text of a Note widget.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    scope: "notes",
    need: "read",
    label: () => "Read a note",
    run: (a) => {
      const n = noteWidgets().find(({ w }) => w.id === str(a.id));
      if (!n) throw new ToolError("No note with that id.");
      return {
        result: { title: n.w.title, text: String(n.w.settings.note ?? "").slice(0, 12_000) },
      };
    },
  },
  {
    name: "create_note",
    description:
      "Create a Note widget with markdown text (headings, lists, - [ ] checklists) on a page. Defaults to the current page.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        text: { type: "string" },
        page_id: { type: "string" },
      },
      required: ["text"],
    },
    scope: "notes",
    need: "write",
    label: (a) => `Create note ${quote(a.title || "Note")}`,
    run: (a, ctx) => {
      require("board", "write");
      const pageId = defaultPage(ctx, a.page_id);
      const id = db.createWidget({ kind: "blank", pageId });
      if (!id) throw new ToolError("Couldn't create the note.");
      placeFree(id);
      db.updateWidgetSettings(id, { note: String(a.text ?? "").slice(0, 50_000) });
      db.updateWidget(id, { title: str(a.title).slice(0, 60) || "Note" });
      return { result: { id }, undo: () => db.deleteRows("widgets", [id]) };
    },
  },
  {
    name: "update_note",
    description: "Replace a note's text, append to it, or rename it.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        text: { type: "string", description: "New full text (replaces)." },
        append: { type: "string", description: "Text to add at the end." },
        title: { type: "string" },
      },
      required: ["id"],
    },
    scope: "notes",
    need: "write",
    label: () => "Update a note",
    run: (a) => {
      const n = noteWidgets().find(({ w }) => w.id === str(a.id));
      if (!n) throw new ToolError("No note with that id.");
      const undo = restoreRowsUndo("widgets", [n.w.id]);
      const current = String(n.w.settings.note ?? "");
      const next =
        typeof a.text === "string"
          ? a.text
          : typeof a.append === "string"
            ? `${current.replace(/\s+$/, "")}${current ? "\n" : ""}${a.append}`
            : current;
      db.updateWidgetSettings(n.w.id, { note: next.slice(0, 50_000) });
      if (str(a.title)) db.updateWidget(n.w.id, { title: str(a.title).slice(0, 60) });
      return { result: { ok: true }, undo };
    },
  },
];

/* ========================================================== TRANSCRIPTS ==== */

const transcriptTools: ToolDef[] = [
  {
    name: "search_transcripts",
    description:
      "Search the user's transcripts (videos, audio, web pages). Returns matching titles with a short excerpt.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    scope: "transcripts",
    need: "read",
    label: (a) => `Searched transcripts for ${quote(a.query)}`,
    run: (a) => {
      const q = str(a.query).toLowerCase();
      const done = db.getSnapshot().transcripts.filter((t) => t.status === "done");
      const hits = done
        .map((t) => {
          const at = t.text.toLowerCase().indexOf(q);
          const inTitle = t.title.toLowerCase().includes(q);
          return { t, at, inTitle };
        })
        .filter((h) => !q || h.inTitle || h.at >= 0)
        .slice(0, 10)
        .map(({ t, at }) => ({
          id: t.id,
          title: t.title,
          words: t.wordCount,
          excerpt: at >= 0 ? t.text.slice(Math.max(0, at - 160), at + 240) : t.text.slice(0, 240),
        }));
      return { result: { transcripts: hits } };
    },
  },
  {
    name: "read_transcript",
    description: "Read a transcript's text (up to max_chars, default 8000).",
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, max_chars: { type: "number" } },
      required: ["id"],
    },
    scope: "transcripts",
    need: "read",
    label: () => "Read a transcript",
    run: (a) => {
      const t = db.getSnapshot().transcripts.find((x) => x.id === str(a.id));
      if (!t) throw new ToolError("No transcript with that id.");
      const max = Math.min(30_000, Math.max(500, Number(a.max_chars) || 8000));
      return {
        result: {
          title: t.title,
          source: t.source,
          text: t.text.slice(0, max),
          truncated: t.text.length > max,
        },
      };
    },
  },
];

/* ================================================================ BOARD ==== */

const KINDS: Record<string, WidgetKind> = {
  todo: "todo",
  calendar: "calendar",
  transcribe: "transcribe",
  tutor: "tutor",
  typing: "typing",
  flashcards: "flashcards",
  note: "blank",
};

const boardTools: ToolDef[] = [
  {
    name: "list_pages_and_widgets",
    description:
      "List pages and the widgets on each, plus installed marketplace widgets that can be added (plugin_id). Marks the page the user is on.",
    parameters: { type: "object", properties: {} },
    scope: "board",
    need: "read",
    label: () => "Looked at your pages",
    run: (_a, ctx) => {
      const snap = db.getSnapshot();
      const installed = new Map(snap.installedWidgets.map((w) => [w.manifest.id, w]));
      return {
        result: {
          current_page_id: ctx.pageId,
          pages: snap.pages.map((p) => ({
            id: p.id,
            title: p.title,
            widgets: snap.widgets
              .filter((w) => w.pageId === p.id)
              .map((w) => ({
                id: w.id,
                kind: w.kind === "blank" ? "note" : w.kind,
                title: w.title,
                ...(w.kind === "custom"
                  ? {
                      plugin_id: w.settings.pluginId,
                      plugin: installed.get(String(w.settings.pluginId))?.manifest.name,
                    }
                  : {}),
              })),
          })),
          installable: snap.installedWidgets
            .filter((w) => w.enabled)
            .map((w) => ({
              plugin_id: w.manifest.id,
              name: w.manifest.name,
              summary: w.manifest.summary,
            })),
        },
      };
    },
  },
  {
    name: "open_page",
    description: "Switch the board to another page.",
    parameters: {
      type: "object",
      properties: { page_id: { type: "string" } },
      required: ["page_id"],
    },
    scope: "board",
    need: "write",
    label: (a) => {
      const p = db.getSnapshot().pages.find((x) => x.id === str(a.page_id));
      return `Open page ${quote(p?.title ?? "?")}`;
    },
    run: (a) => {
      const id = str(a.page_id);
      const snap = db.getSnapshot();
      if (!snap.pages.some((p) => p.id === id)) throw new ToolError("No page with that id.");
      const previous = snap.meta.currentPageId;
      db.setCurrentPage(id);
      return {
        result: { ok: true },
        undo: () => {
          if (previous) db.setCurrentPage(previous);
        },
      };
    },
  },
  {
    name: "add_widget",
    description:
      "Add a widget to a page (default: current page). kind is one of todo, calendar, transcribe, tutor, typing (a typing trainer over transcripts and notes), flashcards (spaced-repetition flashcards made from transcripts and notes), note, or custom with a plugin_id from list_pages_and_widgets.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["todo", "calendar", "transcribe", "tutor", "typing", "flashcards", "note", "custom"],
        },
        plugin_id: { type: "string" },
        page_id: { type: "string" },
      },
      required: ["kind"],
    },
    scope: "board",
    need: "write",
    label: (a) => {
      const name =
        str(a.kind) === "custom"
          ? (db.getInstalledWidget(str(a.plugin_id))?.manifest.name ?? "widget")
          : str(a.kind);
      return `Add a ${name} widget`;
    },
    run: (a, ctx) => {
      const pageId = defaultPage(ctx, a.page_id);
      const kind = str(a.kind);
      const id =
        kind === "custom"
          ? db.createWidget({ kind: "custom", pageId, pluginId: str(a.plugin_id) })
          : KINDS[kind]
            ? db.createWidget({ kind: KINDS[kind]!, pageId })
            : null;
      if (!id)
        throw new ToolError(
          kind === "custom" ? "That widget isn't installed." : "Unknown widget kind.",
        );
      placeFree(id);
      return { result: { id, page_id: pageId }, undo: () => db.deleteRows("widgets", [id]) };
    },
  },
  {
    name: "build_widget",
    description:
      "Create a brand-new custom widget from a description (e.g. 'a water intake tracker with a daily goal'), install it and add it to the current page. Use when no existing widget fits.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short widget name." },
        description: { type: "string", description: "What it should do and show, in detail." },
      },
      required: ["name", "description"],
    },
    scope: "board",
    need: "write",
    risky: true,
    label: (a) => `Build and install a widget ${quote(a.name)}`,
    run: async (a, ctx) => {
      const pageId = defaultPage(ctx, null);
      const built = await ctx.buildWidget({ name: str(a.name), description: str(a.description) });
      const id = db.createWidget({ kind: "custom", pageId, pluginId: built.pluginId });
      if (!id) throw new ToolError("The widget was built but couldn't be placed.");
      placeFree(id);
      return {
        result: { ok: true, widget_id: id, plugin_id: built.pluginId, name: built.name },
        undo: () => db.deleteRows("widgets", [id]),
      };
    },
  },
];

/* ================================================== MARKETPLACE WIDGETS ==== */

function customInstance(id: string) {
  const w = db.getSnapshot().widgets.find((x) => x.id === id && x.kind === "custom");
  if (!w) throw new ToolError("No custom widget with that id. Call list_pages_and_widgets first.");
  const pluginId = String(w.settings.pluginId ?? "");
  return {
    w,
    pluginId,
    scope: `widget:${pluginId}` as ScopeId,
    installed: db.getInstalledWidget(pluginId),
  };
}

const widgetDataTools: ToolDef[] = [
  {
    name: "get_widget_data",
    description:
      "Read a marketplace widget's saved data (its storage, e.g. the Habits list) and settings, plus what the widget is for. Use before changing it, to learn the data format.",
    parameters: {
      type: "object",
      properties: { widget_id: { type: "string" } },
      required: ["widget_id"],
    },
    scope: null,
    need: "read",
    label: (a) => {
      try {
        return `Looked at ${customInstance(str(a.widget_id)).installed?.manifest.name ?? "a widget"}`;
      } catch {
        return "Looked at a widget";
      }
    },
    run: (a) => {
      const { w, scope, installed } = customInstance(str(a.widget_id));
      require(scope, "read");
      const storage = JSON.stringify(w.settings.storage ?? {});
      return {
        result: {
          widget: installed?.manifest.name,
          about: installed?.manifest.description ?? installed?.manifest.summary,
          settings_fields:
            installed?.manifest.settings?.map((f) => ({
              key: f.key,
              label: f.label,
              type: f.type,
            })) ?? [],
          settings: w.settings.config ?? {},
          storage:
            storage.length > 20_000
              ? `${storage.slice(0, 20_000)}… (truncated)`
              : (w.settings.storage ?? {}),
          today: iso(Date.now())?.slice(0, 10),
        },
      };
    },
  },
  {
    name: "set_widget_data",
    description:
      "Change a marketplace widget's saved data and/or settings. `storage` keys you pass replace those keys entirely (keep the same shape you read with get_widget_data); `settings` merges. The widget reloads to show the change.",
    parameters: {
      type: "object",
      properties: {
        widget_id: { type: "string" },
        storage: { type: "object", description: "Keys to replace in the widget's storage." },
        settings: { type: "object", description: "Settings values to change." },
        summary: {
          type: "string",
          description: "What you changed, in a few words, e.g. 'add habit Meditate'.",
        },
      },
      required: ["widget_id", "summary"],
    },
    scope: null,
    need: "write",
    label: (a) => {
      let name = "a widget";
      try {
        name = customInstance(str(a.widget_id)).installed?.manifest.name ?? name;
      } catch {
        /* fall through */
      }
      return `${name}: ${str(a.summary) || "update"}`;
    },
    run: (a) => {
      const { w, scope } = customInstance(str(a.widget_id));
      require(scope, "write");
      const undo = restoreRowsUndo("widgets", [w.id]);
      const patch: Record<string, unknown> = {};
      if (a.storage && typeof a.storage === "object")
        patch.storage = {
          ...(w.settings.storage ?? {}),
          ...(a.storage as Record<string, unknown>),
        };
      if (a.settings && typeof a.settings === "object")
        patch.config = { ...(w.settings.config ?? {}), ...(a.settings as Record<string, unknown>) };
      if (!Object.keys(patch).length)
        throw new ToolError("Nothing to change: pass storage and/or settings.");
      if (JSON.stringify(patch.storage ?? {}).length > 512 * 1024)
        throw new ToolError("That's more than the widget's 512 KB storage.");
      db.updateWidgetSettings(w.id, patch);
      return { result: { ok: true }, undo };
    },
  },
];

const ALL = [
  ...taskTools,
  ...calendarTools,
  ...noteTools,
  ...transcriptTools,
  ...boardTools,
  ...widgetDataTools,
];

/** Tools the model may see right now: those whose data the user allowed at all. */
export function availableTools(): ToolDef[] {
  const anyWidget = db
    .listInstalledWidgets()
    .some((w) => allows(`widget:${w.manifest.id}`, "read"));
  return ALL.filter((t) => {
    if (t.scope) return allows(t.scope, "read");
    return anyWidget && allows("board", "read");
  });
}

export function findTool(name: string): ToolDef | undefined {
  return ALL.find((t) => t.name === name);
}

/** Throws a ToolError when the tool's core scope doesn't allow this. */
export function checkAccess(tool: ToolDef): void {
  if (tool.scope) require(tool.scope, tool.need);
}
