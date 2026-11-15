/** Project Tracker in the main process: project records and moving tasks across the board. */
import { ipcMain } from "electron";

import { IPC } from "../shared/api";
import type { BoardColumn, ProjectPatch } from "../shared/projects";
import * as db from "./db";

export function registerProjectHandlers(snap: () => unknown): void {
  const write = (fn: () => void) => {
    fn();
    db.flush();
    return snap();
  };
  ipcMain.handle(IPC.projCreate, (_e, name: string, patch: ProjectPatch) => {
    const id = db.createProject(String(name ?? ""), patch ?? {});
    db.flush();
    return { id, snapshot: snap() };
  });
  ipcMain.handle(IPC.projUpdate, (_e, id: string, patch: ProjectPatch) =>
    write(() => db.updateProject(String(id), patch ?? {})),
  );
  ipcMain.handle(IPC.projDelete, (_e, id: string) => write(() => db.deleteProject(String(id))));
  ipcMain.handle(IPC.projMoveTask, (_e, taskId: string, col: BoardColumn, sort?: number) =>
    write(() => db.moveTask(String(taskId), col, typeof sort === "number" ? sort : undefined)),
  );
}
