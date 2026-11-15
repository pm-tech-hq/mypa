/**
 * App-level behaviour that lives outside any widget: launching at sign-in,
 * the tray icon, what closing the window does, desktop notifications and
 * app updates. Preferences are stored in the DB's meta table; whether the app
 * launches at sign-in is read back from the OS, so turning it off in Task
 * Manager shows up here too.
 */
import { execFile } from "node:child_process";

import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, Tray } from "electron";

import { DEFAULT_PREFS, SYSTEM_IPC, type AppPrefs, type SystemState } from "../shared/system";
import { hotkeyLabel } from "../shared/capture";
import { toggleCapture } from "./capture";
import * as db from "./db";
import { mainWindow } from "./windows";
import { checkForUpdates, initUpdater, installUpdate, setAutomatic, updateStatus } from "./updater";

/** Passed on the command line by the sign-in entry, so we know how we started. */
const LOGIN_FLAG = "--launched-at-login";
const PREFS_KEY = "appPrefs";

let prefs: AppPrefs = DEFAULT_PREFS;
let tray: Tray | null = null;
let trayIcon = "";
let quitting = false;
let openWindow: () => BrowserWindow = () => {
  throw new Error("initSystem() hasn't run");
};
/** Notifications are kept referenced until dismissed, or GC drops their click handler. */
const live = new Set<Notification>();

function loginItemOpen(): boolean {
  if (!app.isPackaged) return false;
  const s = app.getLoginItemSettings({ args: [LOGIN_FLAG] });
  return s.executableWillLaunchAtLogin ?? s.openAtLogin;
}

function state(): SystemState {
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    notificationsSupported: Notification.isSupported(),
    prefs,
    update: updateStatus(),
  };
}

function broadcast(): void {
  const s = state();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(SYSTEM_IPC.stateChanged, s);
  refreshTray();
}

/* ------------------------------------------------------------------ window --- */

/** Shows the main window, creating it if it was never made or was destroyed. */
export function showMainWindow(): void {
  const win = mainWindow() ?? openWindow();
  if (win.isMinimized()) win.restore();
  if (win.webContents.isLoading()) win.once("ready-to-show", () => (win.show(), win.focus()));
  else {
    win.show();
    win.focus();
  }
}

/** True when this launch came from the sign-in entry and should stay in the tray. */
export function startHidden(): boolean {
  return app.isPackaged && prefs.openAtLogin && prefs.startHidden && process.argv.includes(LOGIN_FLAG);
}

/** With "keep running in the tray", closing hides the window instead of quitting. */
export function attachWindow(win: BrowserWindow): void {
  win.on("close", (e) => {
    if (quitting || !prefs.closeToTray || !tray) return;
    e.preventDefault();
    win.hide();
  });
}

/** Whether the app should keep running once its last window is gone. */
export function keepRunningInTray(): boolean {
  return tray !== null && prefs.closeToTray && !quitting;
}

function quit(): void {
  quitting = true;
  app.quit();
}

/* -------------------------------------------------------------------- tray --- */

function trayWanted(): boolean {
  return prefs.closeToTray || startHidden();
}

function refreshTray(): void {
  if (!trayWanted()) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    const image = nativeImage.createFromPath(trayIcon).resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip("myPA");
    tray.on("click", showMainWindow);
  }
  const update = updateStatus();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open myPA", click: showMainWindow },
      {
        label: "Quick capture",
        accelerator: db.captureSettings().hotkeyOn ? db.captureSettings().hotkey : undefined,
        registerAccelerator: false,
        click: toggleCapture,
      },
      { type: "separator" },
      update.state === "ready"
        ? { label: `Restart to update to ${update.version}`, click: restartToUpdate }
        : {
            label: update.state === "downloading" ? "Downloading update…" : "Check for updates",
            enabled: app.isPackaged && update.state !== "checking" && update.state !== "downloading",
            click: () => void checkForUpdates(true),
          },
      { type: "separator" },
      { label: "Quit myPA", click: quit },
    ]),
  );
}

/* ----------------------------------------------------------- notifications --- */

/** Shows a desktop notification; clicking it brings myPA forward (then runs
 *  `onClick`). Returns false when notifications are switched off or unsupported. */
export interface NotifyAction {
  label: string;
  /** A mypa:// link the OS opens when the button is pressed (Windows). */
  url: string;
}

const xmlEscape = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A Windows toast with buttons. Buttons and the toast itself open mypa://
 *  links, which reach the running app through the single-instance handoff. */
function toastXml(input: {
  title: string;
  body: string;
  subtitle?: string;
  launchUrl: string;
  actions: NotifyAction[];
  persistent?: boolean;
}): string {
  const lines = [input.title, input.body, input.subtitle].filter(Boolean) as string[];
  return [
    `<toast launch="${xmlEscape(input.launchUrl)}" activationType="protocol"${input.persistent ? ' scenario="reminder"' : ""}>`,
    `<visual><binding template="ToastGeneric">`,
    ...lines.map((l) => `<text>${xmlEscape(l)}</text>`),
    `</binding></visual>`,
    `<actions>`,
    ...input.actions.map(
      (a) =>
        `<action content="${xmlEscape(a.label)}" arguments="${xmlEscape(a.url)}" activationType="protocol"/>`,
    ),
    `</actions>`,
    `<audio src="ms-winsoundevent:Notification.Reminder"/>`,
    `</toast>`,
  ].join("");
}

/** Shows a desktop notification; clicking it brings myPA forward (then runs
 *  `onClick`). On Windows, `actions` adds buttons and `launchUrl` replaces the
 *  click with a mypa:// link; `persistent` keeps it on screen until answered.
 *  Returns false when notifications are switched off or unsupported. */
export function notify(input: {
  title: string;
  body: string;
  subtitle?: string;
  onClick?: () => void;
  actions?: NotifyAction[];
  launchUrl?: string;
  persistent?: boolean;
  /** Gets the shown notification, e.g. to close it once it no longer applies. */
  onShown?: (n: Notification) => void;
}): boolean {
  if (!prefs.notifications || !Notification.isSupported()) return false;
  const plain = () => {
    const n = new Notification({
      title: input.title,
      body: input.body,
      subtitle: input.subtitle,
      icon: trayIcon || undefined,
    });
    live.add(n);
    const release = () => live.delete(n);
    n.on("click", () => {
      release();
      showMainWindow();
      input.onClick?.();
    });
    n.on("close", release);
    n.on("failed", release);
    n.show();
    input.onShown?.(n);
  };
  if (process.platform === "win32" && input.actions?.length && input.launchUrl) {
    const n = new Notification({
      toastXml: toastXml({
        title: input.title,
        body: input.body,
        subtitle: input.subtitle,
        launchUrl: input.launchUrl,
        actions: input.actions,
        persistent: input.persistent,
      }),
    });
    live.add(n);
    const release = () => live.delete(n);
    n.on("close", release);
    // a toast the OS rejects falls back to the plain kind
    n.on("failed", () => {
      release();
      plain();
    });
    n.show();
    input.onShown?.(n);
    return true;
  }
  plain();
  return true;
}

/**
 * Takes this app's Windows toasts whose launch link contains one of `needles`
 * off the screen and out of the notification centre. Electron's close() can't
 * remove a custom (toastXml) toast, and toasts from before a restart have no
 * handle at all, so this goes through the toast history instead.
 */
export function removeToasts(needles: string[]): void {
  if (process.platform !== "win32" || !needles.length) return;
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const appId = app.isPackaged ? "com.mypa.desktop" : process.execPath;
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "$h=[Windows.UI.Notifications.ToastNotificationManager]::History",
    `$app=${q(appId)}`,
    `$n=@(${needles.map(q).join(",")})`,
    "foreach($t in $h.GetHistory($app)){$x=$t.Content.GetXml();foreach($s in $n){if($x.Contains($s)){$h.Remove($t.Tag,$t.Group,$app);break}}}",
  ].join(";");
  execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true, timeout: 20_000 },
    () => {},
  );
}

/* ----------------------------------------------------------------- updates --- */

function restartToUpdate(): void {
  quitting = true;
  db.flush();
  installUpdate();
}

/* -------------------------------------------------------------------- prefs --- */

function applyPrefs(prev: AppPrefs | null): void {
  if (app.isPackaged && prev?.openAtLogin !== prefs.openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: prefs.openAtLogin, args: [LOGIN_FLAG] });
  }
  if (prev && prev.autoUpdate !== prefs.autoUpdate) setAutomatic(prefs.autoUpdate);
}

function setPrefs(patch: Partial<AppPrefs>): void {
  const prev = prefs;
  const next = { ...prefs };
  for (const key of Object.keys(DEFAULT_PREFS) as (keyof AppPrefs)[]) {
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  }
  prefs = next;
  db.setMetaJson(PREFS_KEY, prefs);
  applyPrefs(prev);
  broadcast();
}

/**
 * Call after the DB is open and before the first window. `createWindow` must
 * return the new main window; it's used when the tray or a notification
 * needs a window that doesn't exist yet.
 */
export function initSystem(opts: { createWindow: () => BrowserWindow; icon: string }): void {
  openWindow = opts.createWindow;
  trayIcon = opts.icon;
  prefs = { ...DEFAULT_PREFS, ...db.getMetaJson<Partial<AppPrefs>>(PREFS_KEY, {}) };
  // The OS is the source of truth for sign-in launch.
  if (app.isPackaged) prefs.openAtLogin = loginItemOpen();
  applyPrefs(null);

  app.on("before-quit", () => {
    quitting = true;
  });

  ipcMain.handle(SYSTEM_IPC.getState, () => state());
  ipcMain.handle(SYSTEM_IPC.setPrefs, (_e, patch: Partial<AppPrefs>) => {
    setPrefs(patch ?? {});
    return state();
  });
  ipcMain.handle(SYSTEM_IPC.testNotification, () =>
    notify({ title: "Notifications are on", body: "myPA can reach you here." }),
  );
  ipcMain.handle(SYSTEM_IPC.checkForUpdates, async () => {
    await checkForUpdates(true);
    return state();
  });
  ipcMain.on(SYSTEM_IPC.installUpdate, restartToUpdate);

  let announced = "";
  initUpdater({
    automatic: prefs.autoUpdate,
    onStatus: (status) => {
      if (status.state === "ready" && announced !== status.version) {
        announced = status.version;
        notify({
          title: `myPA ${status.version} is ready`,
          body: "Restart myPA to finish updating. It will also install the next time you quit.",
        });
      }
      broadcast();
    },
  });
  refreshTray();
}
