/**
 * First-run seed for goals and tasks (currently empty).
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

/* Fresh installs start empty: the To-do widget's empty state asks for the
 * first task instead of shipping sample tasks the user has to clear away.
 * The seeding plumbing stays so a future starter pack can fill these. */
export const SEED_GOALS: SeedGoal[] = [];

export const SEED_TASKS: SeedTask[] = [];
