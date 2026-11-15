/**
 * Journal in the main process: saving entries, the passcode lock (and locking
 * again after a while without use), and exporting to Markdown.
 */
import { writeFile } from "node:fs/promises";

import { BrowserWindow, dialog, ipcMain, powerMonitor } from "electron";

import { IPC } from "../shared/api";
import { journalMarkdown, type JournalEntry, type JournalSettings } from "../shared/journal";
import { pushSnapshot } from "./broadcast";
import * as db from "./db";
import { verifyMethod, verifyUser } from "./osVerify";

let lastUse = Date.now();
const touch = () => {
  lastUse = Date.now();
};

/** Locks a passcode-protected journal and tells every window. */
function lockNow(): void {
  if (db.isJournalLocked() || !db.journalMeta().hasPasscode) return;
  db.lockJournal();
  pushSnapshot();
}

/** Wrong passcodes slow down after a few tries. */
let failures = 0;
let blockedUntil = 0;

export function registerJournalHandlers(snap: () => unknown): void {
  const write = (fn: () => void) => {
    touch();
    fn();
    db.flush();
    return snap();
  };

  ipcMain.handle(IPC.journalSave, (_e, day: string, patch: db.JournalWrite) =>
    write(() => void db.saveJournalEntry(String(day), patch ?? {})),
  );
  ipcMain.handle(IPC.journalDelete, (_e, days: string[]) =>
    write(() => db.deleteJournalEntries(Array.isArray(days) ? days.map(String) : [])),
  );
  ipcMain.handle(IPC.journalPut, (_e, entries: JournalEntry[]) =>
    write(() => db.putJournalEntries(Array.isArray(entries) ? entries : [])),
  );
  ipcMain.handle(IPC.journalUnlock, async (_e, code: string) => {
    const now = Date.now();
    if (now < blockedUntil) {
      await new Promise((r) => setTimeout(r, blockedUntil - now));
    }
    const ok = db.unlockJournal(String(code ?? ""));
    if (ok) {
      failures = 0;
      touch();
    } else {
      failures++;
      if (failures >= 3) blockedUntil = Date.now() + Math.min(30_000, 1000 * 2 ** (failures - 3));
    }
    return { ok, snapshot: snap() };
  });
  ipcMain.handle(IPC.journalLock, () => {
    db.lockJournal();
    return snap();
  });
  ipcMain.handle(IPC.journalPasscode, (_e, current: string, next: string) =>
    write(() => db.setJournalPasscode(String(current ?? ""), String(next ?? ""))),
  );
  ipcMain.handle(IPC.journalErase, () => write(() => db.eraseJournal()));
  ipcMain.handle(IPC.journalVerifyMethod, () => verifyMethod());
  ipcMain.handle(IPC.journalResetWithOs, async () => {
    if (!db.journalMeta().hasPasscode) return { ok: true, snapshot: snap() };
    // main asks the OS itself; the window can't skip this step
    const ok = await verifyUser("Confirm it's you to remove your myPA journal passcode");
    if (ok) {
      db.resetJournalPasscode();
      failures = 0;
      blockedUntil = 0;
      touch();
    }
    return { ok, snapshot: snap() };
  });
  ipcMain.handle(IPC.journalSettings, (_e, patch: Partial<JournalSettings>) =>
    write(() => db.setJournalSettings(patch ?? {})),
  );
  ipcMain.handle(IPC.journalExport, async (e) => {
    if (db.isJournalLocked()) throw new Error("The journal is locked.");
    touch();
    const md = journalMarkdown(db.listJournalEntries());
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.SaveDialogOptions = {
      title: "Export journal",
      defaultPath: `Journal ${new Date().toISOString().slice(0, 10)}.md`,
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "Text", extensions: ["txt"] },
      ],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, md, "utf8");
    return true;
  });
  ipcMain.on(IPC.journalTouch, touch);

  // Lock again after the chosen time without use, and whenever the computer
  // locks or sleeps.
  setInterval(() => {
    const mins = db.journalSettings().lockAfter;
    if (mins > 0 && Date.now() - lastUse > mins * 60_000) lockNow();
  }, 20_000);
  powerMonitor.on("lock-screen", lockNow);
  powerMonitor.on("suspend", lockNow);
}
