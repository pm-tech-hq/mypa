/** App-level behaviour: startup, tray, notifications and app updates. */

export const SYSTEM_IPC = {
  getState: "system:getState",
  setPrefs: "system:setPrefs",
  testNotification: "system:testNotification",
  checkForUpdates: "system:checkForUpdates",
  installUpdate: "system:installUpdate",
  /** Pushed by main whenever the state changes (update progress, tray toggles). */
  stateChanged: "system:stateChanged",
} as const;

export interface AppPrefs {
  /** Start myPA when the user signs in to the computer. */
  openAtLogin: boolean;
  /** When started at sign-in, stay in the tray instead of opening the window. */
  startHidden: boolean;
  /** Closing the window keeps myPA running in the tray. */
  closeToTray: boolean;
  /** Master switch for desktop notifications from widgets. */
  notifications: boolean;
  /** Check for, download and offer app updates automatically. */
  autoUpdate: boolean;
}

export const DEFAULT_PREFS: AppPrefs = {
  openAtLogin: false,
  startHidden: true,
  closeToTray: false,
  notifications: true,
  autoUpdate: true,
};

export type UpdateStatus =
  | { state: "idle" }
  | { state: "unsupported"; reason: string }
  | { state: "checking" }
  | { state: "none"; checkedAt: number }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

export interface SystemState {
  version: string;
  /** False in dev (`electron-vite dev`): login items and updates need the installed app. */
  packaged: boolean;
  /** False where the OS has no notification support. */
  notificationsSupported: boolean;
  prefs: AppPrefs;
  update: UpdateStatus;
}

export interface MypaSystem {
  getState: () => Promise<SystemState>;
  setPrefs: (patch: Partial<AppPrefs>) => Promise<SystemState>;
  /** Resolves false if notifications are off or unsupported. */
  testNotification: () => Promise<boolean>;
  checkForUpdates: () => Promise<SystemState>;
  /** Quits, installs the downloaded update and relaunches. */
  installUpdate: () => void;
  onStateChanged: (cb: (state: SystemState) => void) => () => void;
}
