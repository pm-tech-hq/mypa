/**
 * Project Tracker: projects are the names tasks and goals already carry
 * (`TaskRow.project`), given a record of their own (status, colour, target
 * date, notes). Tasks move across a board: to do → in progress → waiting →
 * done. Everything here is pure so the widget and the Assistant agree.
 */

import type { GoalRow, StepRow, TaskRow } from "./types";

export type ProjectStatus = "active" | "paused" | "done" | "archived";
/** Where an open task sits on the board; finished tasks are in Done. */
export type TaskStage = "todo" | "doing" | "waiting";
export type BoardColumn = TaskStage | "done";

export const PROJECT_STATUSES: { id: ProjectStatus; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "done", label: "Finished" },
  { id: "archived", label: "Archived" },
];
export const isProjectStatus = (v: unknown): v is ProjectStatus =>
  v === "active" || v === "paused" || v === "done" || v === "archived";
export const statusLabel = (s: ProjectStatus) => PROJECT_STATUSES.find((x) => x.id === s)?.label ?? s;

export const COLUMNS: { id: BoardColumn; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "waiting", label: "Waiting" },
  { id: "done", label: "Done" },
];
export const isStage = (v: unknown): v is TaskStage => v === "todo" || v === "doing" || v === "waiting";
export const isColumn = (v: unknown): v is BoardColumn => isStage(v) || v === "done";
export const columnLabel = (c: BoardColumn) => COLUMNS.find((x) => x.id === c)?.label ?? c;

export interface ProjectRow {
  id: string;
  name: string;
  detail: string;
  status: ProjectStatus;
  /** A page colour key (see pageColors.ts). */
  color: string;
  /** YYYY-MM-DD, or null for no target. */
  targetDate: string | null;
  sort: number;
  createdAt: number;
}

export interface ProjectPatch {
  name?: string;
  detail?: string;
  status?: ProjectStatus;
  color?: string;
  targetDate?: string | null;
  sort?: number;
}

/** Per widget: which project is open (null = the overview) and how. */
export interface ProjectsWidgetSettings {
  projOpen: string | null;
  projView: "board" | "list";
  /** The overview shows finished and archived projects too. */
  projShowAll: boolean;
}

export const sameProject = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function columnOf(t: Pick<TaskRow, "done" | "stage">): BoardColumn {
  return t.done ? "done" : t.stage;
}

export function tasksOf(p: ProjectRow, tasks: TaskRow[]): TaskRow[] {
  return tasks.filter((t) => sameProject(t.project, p.name));
}

export function goalsOf(p: ProjectRow, goals: GoalRow[]): GoalRow[] {
  return goals.filter((g) => g.project !== null && sameProject(g.project, p.name) && g.status !== "archived");
}

/** Board order: by `sort`, finished tasks newest first. */
export function columnTasks(tasks: TaskRow[], col: BoardColumn): TaskRow[] {
  const list = tasks.filter((t) => columnOf(t) === col);
  return col === "done"
    ? list.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0) || a.sort - b.sort)
    : list.sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt);
}

/** A `sort` that lands a task between `before` and `after` (either may be missing). */
export function sortBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

/* ---------------------------------------------------------------- health -- */

export type Health = "on-track" | "at-risk" | "behind" | "done" | "paused" | "empty";

export const HEALTH_LABEL: Record<Health, string> = {
  "on-track": "On track",
  "at-risk": "At risk",
  behind: "Behind",
  done: "Finished",
  paused: "Paused",
  empty: "No tasks yet",
};

export interface ProjectSummary {
  total: number;
  done: number;
  byColumn: Record<BoardColumn, number>;
  /** 0–1: finished tasks, with steps counting toward open ones. */
  progress: number;
  overdue: number;
  /** The open task due soonest. */
  next: TaskRow | null;
  doneThisWeek: number;
  /** Whole days until the target date (negative = past it), or null. */
  daysLeft: number | null;
  health: Health;
  /** Why, in a few words ("2 overdue", "target in 3 days, 40% done"). */
  reason: string;
}

const DAY = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function daysUntil(ymd: string, now: number): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return Math.round((new Date(y, m - 1, d).getTime() - startOfDay(now)) / DAY);
}

export function summarize(
  p: ProjectRow,
  allTasks: TaskRow[],
  steps: StepRow[],
  now: number,
): ProjectSummary {
  const tasks = tasksOf(p, allTasks);
  const byColumn: Record<BoardColumn, number> = { todo: 0, doing: 0, waiting: 0, done: 0 };
  for (const t of tasks) byColumn[columnOf(t)]++;
  const open = tasks.filter((t) => !t.done);
  const done = tasks.length - open.length;

  // an open task with 2 of 4 steps done counts as half a task
  let credit = done;
  for (const t of open) {
    const s = steps.filter((x) => x.taskId === t.id);
    if (s.length) credit += s.filter((x) => x.done).length / s.length / 2;
  }
  const progress = tasks.length ? Math.min(1, credit / tasks.length) : 0;

  const overdue = open.filter((t) => t.due !== null && t.due < now).length;
  const next = open.filter((t) => t.due !== null).sort((a, b) => a.due! - b.due!)[0] ?? null;
  const weekAgo = now - 7 * DAY;
  const doneThisWeek = tasks.filter((t) => t.done && (t.doneAt ?? 0) >= weekAgo).length;
  const daysLeft = p.targetDate ? daysUntil(p.targetDate, now) : null;

  let health: Health;
  let reason = "";
  if (p.status === "done" || p.status === "archived") {
    health = "done";
  } else if (p.status === "paused") {
    health = "paused";
  } else if (!tasks.length) {
    health = "empty";
  } else if (!open.length) {
    health = "on-track";
    reason = "Everything's done";
  } else if (daysLeft !== null && daysLeft < 0) {
    health = "behind";
    reason = `Target passed ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago`;
  } else if (overdue > 0) {
    health = overdue >= 3 || overdue / open.length > 0.3 ? "behind" : "at-risk";
    reason = `${overdue} overdue`;
  } else if (daysLeft !== null && daysLeft <= 14) {
    // the share of work left should fit the time left (with a little slack)
    const expected = 1 - daysLeft / 30;
    if (progress + 0.15 < expected || (daysLeft <= 3 && progress < 0.8)) {
      health = "at-risk";
      reason = `${daysLeft === 0 ? "Due today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}, ${Math.round(progress * 100)}% done`;
    } else health = "on-track";
  } else if (byColumn.waiting > 0 && byColumn.waiting >= open.length / 2) {
    health = "at-risk";
    reason = `${byColumn.waiting} waiting on others`;
  } else {
    health = "on-track";
  }
  return { total: tasks.length, done, byColumn, progress, overdue, next, doneThisWeek, daysLeft, health, reason };
}

/** "Due Fri", "Due today", "2 days late". */
export function dueLabel(due: number, now: number): { text: string; late: boolean; soon: boolean } {
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (due < now && days <= 0) {
    const late = Math.max(0, -days);
    return { text: late === 0 ? "Due today" : `${late} day${late === 1 ? "" : "s"} late`, late: true, soon: false };
  }
  if (days === 0) return { text: "Due today", late: false, soon: true };
  if (days === 1) return { text: "Due tomorrow", late: false, soon: true };
  if (days < 7)
    return { text: `Due ${new Date(due).toLocaleDateString(undefined, { weekday: "short" })}`, late: false, soon: days <= 2 };
  return {
    text: `Due ${new Date(due).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    late: false,
    soon: false,
  };
}

export function targetLabel(ymd: string, now: number): string {
  const days = daysUntil(ymd, now);
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: y !== new Date(now).getFullYear() ? "numeric" : undefined,
  });
  if (days < 0) return `Target ${date} · ${-days} day${days === -1 ? "" : "s"} past`;
  if (days === 0) return `Target today`;
  return `Target ${date} · ${days} day${days === 1 ? "" : "s"} left`;
}

/** The prompt that asks the Assistant to break a project into tasks. */
export function breakdownPrompt(p: ProjectRow, existing: TaskRow[]): string {
  const open = existing.filter((t) => !t.done).map((t) => `- ${t.title}`);
  return [
    `Break my project “${p.name}” down into concrete next tasks.`,
    p.detail ? `What it's about: ${p.detail}` : "",
    p.targetDate ? `Target date: ${p.targetDate}.` : "",
    open.length ? `Tasks it already has:\n${open.join("\n")}` : "",
    `Suggest 5 to 8 tasks that aren't there yet, each small enough to finish in a sitting, in a sensible order. Show me the list first; when I say yes, add them with add_task, project “${p.name}”, section backlog.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
