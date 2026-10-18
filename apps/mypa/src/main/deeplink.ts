import { resolve } from "node:path";

import { app, BrowserWindow } from "electron";

import { MARKET_IPC } from "../shared/marketApi";

/**
 * `mypa://widget/<id>` links from the marketplace website open the widget's
 * page in the in-app Marketplace. The OS hands the URL to a new process, so
 * this also makes the app single-instance and forwards the link to the
 * window that's already open.
 */
const SCHEME = "mypa";
let pending: string | null = null;

function widgetIdFrom(argv: string[]): string | null {
  const url = argv.find((a) => a.startsWith(`${SCHEME}://`));
  if (!url) return null;
  const match = /^mypa:\/\/widget\/([a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*)\/?$/i.exec(url);
  return match ? decodeURIComponent(match[1]!).toLowerCase() : null;
}

function deliver(id: string): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    pending = id;
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  const send = () => win.webContents.send(MARKET_IPC.openWidget, id);
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
}

/** Returns false if another instance already owns the app (this one should quit). */
export function setupDeepLinks(): boolean {
  if (!app.requestSingleInstanceLock()) return false;

  if (process.defaultApp && process.argv[1]) {
    // Dev: `electron .` needs the app path so the OS can relaunch it.
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }

  pending = widgetIdFrom(process.argv);
  app.on("second-instance", (_e, argv) => {
    const id = widgetIdFrom(argv);
    const win = BrowserWindow.getAllWindows()[0];
    if (id) deliver(id);
    else if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  // macOS delivers links through open-url instead of argv.
  app.on("open-url", (e, url) => {
    e.preventDefault();
    const id = widgetIdFrom([url]);
    if (id) deliver(id);
  });
  return true;
}

/** Call once the first window exists. */
export function flushPendingDeepLink(): void {
  if (pending) {
    const id = pending;
    pending = null;
    deliver(id);
  }
}
