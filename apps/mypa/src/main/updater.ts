/**
 * App updates through electron-updater. Release builds publish an installer
 * plus `latest.yml` to GitHub Releases (see electron-builder.yml `publish`);
 * the installed app polls that feed, downloads a newer build in the
 * background and installs it on the next restart (or right away on request).
 * Dev builds have no feed, so everything here is a no-op there.
 */
import { app } from "electron";
import { autoUpdater } from "electron-updater";

import type { UpdateStatus } from "../shared/system";

const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60_000;

let status: UpdateStatus = { state: "idle" };
let onChange: (status: UpdateStatus) => void = () => {};
let automatic = true;
let timer: NodeJS.Timeout | null = null;
let checking: Promise<void> | null = null;

function set(next: UpdateStatus): void {
  status = next;
  onChange(status);
}

export function updateStatus(): UpdateStatus {
  return status;
}

/** Short, readable reason. electron-updater errors can carry whole HTTP bodies. */
function describe(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR_/i.test(text))
    return "Couldn't reach the update server. Check your connection.";
  if (/\b404\b|latest\.yml/i.test(text)) return "No published release was found to update from.";
  return text.split("\n")[0]!.slice(0, 160);
}

export function initUpdater(opts: {
  automatic: boolean;
  onStatus: (status: UpdateStatus) => void;
}): void {
  onChange = opts.onStatus;
  if (!app.isPackaged) {
    set({ state: "unsupported", reason: "Updates work in the installed app, not in dev." });
    return;
  }

  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => set({ state: "checking" }));
  autoUpdater.on("update-not-available", () => set({ state: "none", checkedAt: Date.now() }));
  autoUpdater.on("update-available", (info) => set({ state: "available", version: info.version }));
  autoUpdater.on("download-progress", (p) => {
    const version = "version" in status ? status.version : "";
    set({ state: "downloading", version, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => set({ state: "ready", version: info.version }));
  autoUpdater.on("error", (err) => {
    // A failed background check shouldn't hide an update that's already downloaded.
    if (status.state !== "ready") set({ state: "error", message: describe(err) });
  });

  setAutomatic(opts.automatic);
}

/** Turns background checks (and automatic downloads) on or off. */
export function setAutomatic(on: boolean): void {
  automatic = on;
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = on;
  if (timer) clearInterval(timer);
  timer = null;
  if (!on) return;
  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_DELAY_MS);
  timer = setInterval(() => void checkForUpdates(false), CHECK_INTERVAL_MS);
}

/** A manual check always downloads what it finds; background checks only
 *  when automatic updates are on. Concurrent calls share one check. */
export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!app.isPackaged || status.state === "ready" || status.state === "downloading") return;
  if (!manual && !automatic) return;
  checking ??= (async () => {
    autoUpdater.autoDownload = manual || automatic;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      if (updateStatus().state !== "ready") set({ state: "error", message: describe(err) });
    } finally {
      autoUpdater.autoDownload = automatic;
      checking = null;
    }
  })();
  await checking;
}

/** Quit, install and relaunch. Callers must let windows close first. */
export function installUpdate(): void {
  if (status.state !== "ready") return;
  autoUpdater.quitAndInstall(false, true);
}
