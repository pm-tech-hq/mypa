/**
 * myPA can have small helper windows (the Quick Capture box) next to its main
 * window. Anything that means "the main window" goes through here, so a
 * helper window is never focused, sent deep links or counted by mistake.
 */
import { BrowserWindow } from "electron";

const helpers = new WeakSet<BrowserWindow>();

export function markHelperWindow(win: BrowserWindow): void {
  helpers.add(win);
}

export function isHelperWindow(win: BrowserWindow | null | undefined): boolean {
  return !!win && helpers.has(win);
}

/** The main myPA window, if one is open (hidden in the tray counts). */
export function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !helpers.has(w));
}
