/**
 * First-run seed: a short getting-started list that teaches the board.
 * Plain data — the main process turns it into rows (ids, due dates).
 * Keep it generic: it ships to every new install.
 */

import type { GoalHorizon, Importance, Project, TaskSection } from "./types";

export interface SeedGoal {
  key: string;
  title: string;
  horizon: GoalHorizon;
  project: Project;
  detail: string;
  targetDate?: string;
}

export interface SeedStep {
  t: string;
  done?: boolean;
}

export interface SeedTask {
  t: string;
  p: Project;
  imp: Importance;
  section: TaskSection;
  /** days from first run — Today section only */
  dueDays?: number;
  done?: boolean;
  goal?: string;
  steps?: SeedStep[];
}

export const SEED_GOALS: SeedGoal[] = [
  {
    key: "get-started",
    title: "Get set up in myPA",
    horizon: "week",
    project: "myPA",
    detail: "Make the board yours: add the widgets you use, set your goals, and plan your first day here.",
  },
];

export const SEED_TASKS: SeedTask[] = [
  /* ================= TODAY ================= */
  {
    t: "Tick off a step, then the whole task",
    p: "myPA",
    imp: "high",
    section: "today",
    dueDays: 1,
    goal: "get-started",
    steps: [
      { t: "Tick this step" },
      { t: "Tick this one too, then tick the task itself" },
    ],
  },
  {
    t: "Add your first real task for today",
    p: "myPA",
    imp: "medium",
    section: "today",
    dueDays: 1,
    goal: "get-started",
    steps: [
      { t: "Type it in “Add a task for today” at the top of this list" },
      { t: "Pick how important it is and when it's due" },
    ],
  },
  {
    t: "Set up your board",
    p: "myPA",
    imp: "medium",
    section: "today",
    dueDays: 2,
    goal: "get-started",
    steps: [
      { t: "Add a widget from Add widget (Calendar, Transcribe, Tutor…)" },
      { t: "Drag widgets by their title bar and resize from the corner" },
      { t: "Create a second page from the sidebar for another area of your work" },
    ],
  },
  {
    t: "Write down a goal and link tasks to it",
    p: "myPA",
    imp: "low",
    section: "today",
    dueDays: 3,
    goal: "get-started",
  },

  /* ================= BACKLOG ================= */
  { t: "Browse the widget marketplace", p: "myPA", imp: "low", section: "backlog", goal: "get-started" },
  { t: "Connect a calendar", p: "myPA", imp: "low", section: "backlog", goal: "get-started" },
  { t: "Open the app", p: "myPA", imp: "low", section: "backlog", done: true, goal: "get-started" },
];
