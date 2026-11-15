/**
 * Study Planner in the main process: subjects, exams and sessions (every
 * session write is checked for clashes in db.ts), plus a desktop alert when
 * a session starts.
 */
import { ipcMain, powerMonitor } from "electron";

import { IPC } from "../shared/api";
import { clock, MIN } from "../shared/planner";
import type { ExamPatch, SessionInput, SessionPatch, StudySession, StudySettings, SubjectPatch } from "../shared/study";
import * as db from "./db";
import { notify } from "./system";

export function registerStudyHandlers(snap: () => unknown): void {
  const write = (fn: () => void) => {
    fn();
    db.flush();
    rescheduleStudyAlerts();
    return snap();
  };
  ipcMain.handle(IPC.studySubject, (_e, id: string | null, patch: SubjectPatch & { name?: string }) => {
    let out = id ? String(id) : "";
    write(() => {
      if (out) db.updateSubject(out, patch ?? {});
      else out = db.createSubject(patch?.name, patch ?? {});
    });
    return { id: out, snapshot: snap() };
  });
  ipcMain.handle(IPC.studySubjectDelete, (_e, id: string) => write(() => db.deleteSubject(String(id))));
  ipcMain.handle(IPC.studyExam, (_e, id: string | null, patch: ExamPatch) => {
    let out = id ? String(id) : "";
    write(() => {
      if (out) db.updateExam(out, patch ?? {});
      else out = db.createExam(patch ?? {});
    });
    return { id: out, snapshot: snap() };
  });
  ipcMain.handle(IPC.studyExamDelete, (_e, id: string) => write(() => db.deleteExam(String(id))));
  ipcMain.handle(IPC.studyAdd, (_e, list: SessionInput[]) => {
    let ids: string[] = [];
    write(() => {
      ids = db.addSessions(Array.isArray(list) ? list : []);
    });
    return { ids, snapshot: snap() };
  });
  ipcMain.handle(IPC.studyUpdate, (_e, id: string, patch: SessionPatch) =>
    write(() => db.updateSession(String(id), patch ?? {})),
  );
  ipcMain.handle(IPC.studyDelete, (_e, ids: string[]) =>
    write(() => db.deleteSessions(Array.isArray(ids) ? ids.map(String) : [])),
  );
  ipcMain.handle(IPC.studyPut, (_e, list: StudySession[]) => write(() => db.putSessions(Array.isArray(list) ? list : [])));
  ipcMain.handle(IPC.studySettings, (_e, patch: Partial<StudySettings>) => write(() => db.setStudySettings(patch ?? {})));
}

/* ---------------------------------------------------------------- alerts -- */

const LATE_MS = 2 * MIN;
const SAFETY_TICK_MS = 60_000;
let timer: NodeJS.Timeout | undefined;
const announced = new Set<string>();

function check(): void {
  clearTimeout(timer);
  const now = Date.now();
  let next: number | null = null;
  try {
    if (db.studySettings().alerts) {
      const names = new Map(db.listSubjects().map((s) => [s.id, s.name]));
      const soon = db.listSessions().filter((x) => !x.done && x.end > now && x.start < now + 2 * 86_400_000);
      for (const x of soon) {
        const key = `${x.id}@${x.start}`;
        if (x.start > now) {
          next = next === null ? x.start : Math.min(next, x.start);
          continue;
        }
        if (announced.has(key) || now - x.start > LATE_MS) continue;
        announced.add(key);
        const name = names.get(x.subjectId) ?? "Study";
        notify({
          title: `Study: ${name}`,
          body: `${x.topic ? `${x.topic} · ` : ""}until ${clock(x.end)}`,
          subtitle: "Study Planner",
        });
      }
    }
  } catch {
    /* database not ready yet */
  }
  const wait = next === null ? SAFETY_TICK_MS : Math.min(SAFETY_TICK_MS, next - Date.now() + 250);
  timer = setTimeout(check, Math.max(1000, wait));
}

export function rescheduleStudyAlerts(): void {
  clearTimeout(timer);
  timer = setTimeout(check, 300);
}

export function startStudyAlerts(): void {
  powerMonitor.on("resume", rescheduleStudyAlerts);
  check();
}
