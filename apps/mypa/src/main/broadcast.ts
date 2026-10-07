/** Pushes a fresh snapshot to every window — for state that changes from a
 *  background task (calendar sync, transcription progress), not a direct
 *  IPC request/response. */
import { BrowserWindow } from "electron";

import { IPC } from "../shared/api";
import * as db from "./db";

export function pushSnapshot(): void {
  const snapshot = db.getSnapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.snapshotChanged, snapshot);
  }
}
