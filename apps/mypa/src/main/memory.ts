/**
 * Personal Memory in the main process: the widget's add / correct / hide /
 * delete. The Assistant reaches the same records through its own tools,
 * gated by the "Personal Memory" permission.
 */
import { ipcMain } from "electron";

import { IPC } from "../shared/api";
import type { MemoryKind, MemoryRecord } from "../shared/memory";
import * as db from "./db";

export function registerMemoryHandlers(snap: () => unknown): void {
  const write = (fn: () => void) => {
    fn();
    db.flush();
    return snap();
  };
  ipcMain.handle(IPC.memoryAdd, (_e, input: { text?: string; kind?: MemoryKind | null }) => {
    const r = db.addMemory({ text: String(input?.text ?? ""), kind: input?.kind ?? null, source: "you" });
    db.flush();
    return { id: r.memory.id, created: r.created, snapshot: snap() };
  });
  ipcMain.handle(IPC.memoryUpdate, (_e, id: string, patch: Parameters<typeof db.updateMemory>[1]) =>
    write(() => void db.updateMemory(String(id), patch ?? {})),
  );
  ipcMain.handle(IPC.memoryDelete, (_e, ids: string[]) =>
    write(() => db.deleteMemories(Array.isArray(ids) ? ids.map(String) : [])),
  );
  ipcMain.handle(IPC.memoryPut, (_e, list: MemoryRecord[]) => write(() => db.putMemories(Array.isArray(list) ? list : [])));
}
