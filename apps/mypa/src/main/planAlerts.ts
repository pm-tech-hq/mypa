/**
 * Desktop alerts for the Daily Planner: once today's plan is approved, each
 * block (that isn't done) announces itself when it starts. The timer is set to
 * the next start, with a one-minute safety tick; an alert more than two minutes
 * late is skipped rather than shown out of the blue.
 */
import { powerMonitor } from "electron";

import { clock, dayKey, MIN, type PlanBlock } from "../shared/planner";
import * as db from "./db";
import { notify } from "./system";

const LATE_MS = 2 * MIN;
const SAFETY_TICK_MS = 60_000;

let timer: NodeJS.Timeout | undefined;
/** "id@start" of blocks already announced this run. */
const announced = new Set<string>();

function title(b: PlanBlock): string {
  if (b.taskId) return db.getTask(b.taskId)?.title ?? b.title;
  return b.title;
}

function isDone(b: PlanBlock): boolean {
  if (b.taskId) return db.getTask(b.taskId)?.done ?? b.done;
  return b.done;
}

function check(): void {
  clearTimeout(timer);
  const now = Date.now();
  let next: number | null = null;
  try {
    const settings = db.plannerSettings();
    const today = dayKey(now);
    if (settings.alerts && db.planDay(today).status === "approved") {
      const blocks = db.planBlocksFor(today).sort((a, b) => a.start - b.start);
      for (const [i, b] of blocks.entries()) {
        const key = `${b.id}@${b.start}`;
        if (b.start > now) {
          next = next === null ? b.start : Math.min(next, b.start);
          continue;
        }
        if (announced.has(key) || now - b.start > LATE_MS || b.end <= now || isDone(b)) continue;
        announced.add(key);
        const after = blocks.slice(i + 1).find((x) => x.start >= b.end - MIN && !isDone(x));
        const what = b.kind === "break" ? "Break" : b.kind === "focus" ? "Focus" : "Now";
        notify({
          title: `${what}: ${title(b)}`,
          body: `Until ${clock(b.end)}${after ? ` · then ${title(after)} at ${clock(after.start)}` : ""}`,
          subtitle: "Daily Planner",
        });
      }
    }
  } catch {
    /* database not ready yet */
  }
  const wait = next === null ? SAFETY_TICK_MS : Math.min(SAFETY_TICK_MS, next - Date.now() + 250);
  timer = setTimeout(check, Math.max(1000, wait));
}

/** Call after any change to the plan or its settings. */
export function reschedulePlanAlerts(): void {
  clearTimeout(timer);
  timer = setTimeout(check, 300);
}

export function startPlanAlerts(): void {
  powerMonitor.on("resume", reschedulePlanAlerts);
  check();
}
