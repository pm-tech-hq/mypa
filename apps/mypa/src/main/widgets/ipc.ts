import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";

import { BrowserWindow, dialog, ipcMain, Notification, shell } from "electron";

import { MARKET_IPC, type BridgeFetchResult, type MarketResult } from "../../shared/marketApi";
import { hostAllowed } from "../../shared/widgetPlatform";
import * as db from "../db";
import {
  addRegistry,
  downloadBundle,
  findCatalogWidget,
  getCatalog,
  removeRegistry,
} from "./registry";
import { installBundle, linkDevFolder, parseBundle, uninstallWidget, WidgetError } from "./store";
import { verifyLicense } from "./trust";

const MAX_FETCH_BYTES = 2 * 1024 * 1024;

async function wrap<T>(fn: () => Promise<T> | T): Promise<MarketResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const message =
      err instanceof WidgetError ? err.message : "Something went wrong. Please try again.";
    if (!(err instanceof WidgetError)) console.error("[widgets]", err);
    return { ok: false, error: message };
  }
}

const snap = () => db.getSnapshot();

function requireInstalled(id: string) {
  const installed = db.getInstalledWidget(id);
  if (!installed || !installed.enabled) throw new WidgetError("That widget isn't installed.");
  return installed;
}

/* ---- dev folders: reload the widget whenever its files change ----------- */

const watchers = new Map<string, FSWatcher>();

function broadcastDevChange(id: string): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(MARKET_IPC.devChanged, id);
}

function watchDev(id: string, folder: string): void {
  watchers.get(id)?.close();
  let timer: NodeJS.Timeout | null = null;
  try {
    const w = watch(folder, { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // A changed manifest (new permission, size...) is re-read too.
        void linkDevFolder(folder)
          .catch(() => undefined)
          .then(() => broadcastDevChange(id));
      }, 150);
    });
    watchers.set(id, w);
  } catch {
    /* watching is a convenience; the widget still works without it */
  }
}

export function registerMarketHandlers(): void {
  for (const w of db.listInstalledWidgets())
    if (w.source === "dev" && w.devPath) watchDev(w.manifest.id, w.devPath);

  ipcMain.handle(MARKET_IPC.catalog, (_e, force?: boolean) => wrap(() => getCatalog(Boolean(force))));

  ipcMain.handle(MARKET_IPC.install, (_e, id: string, registryUrl: string) =>
    wrap(async () => {
      const item = await findCatalogWidget(id, registryUrl);
      if (!item) throw new WidgetError("That widget is no longer in the catalog.");
      const bundle = await downloadBundle(item);
      await installBundle(bundle, { source: "registry", trust: item.trust, registryUrl });
      return snap();
    }),
  );

  ipcMain.handle(MARKET_IPC.installFile, (e) =>
    wrap(async () => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const picked = await dialog.showOpenDialog(win!, {
        title: "Install a widget",
        filters: [{ name: "myPA widget", extensions: ["mypawidget"] }],
        properties: ["openFile"],
      });
      if (picked.canceled || !picked.filePaths[0]) return null;
      const bundle = parseBundle(await readFile(picked.filePaths[0]));
      const existing = db.getInstalledWidget(bundle.manifest.id);
      if (existing && existing.source === "registry" && existing.trust !== "unverified")
        throw new WidgetError(
          `${bundle.manifest.name} is already installed from ${existing.trust === "official" ? "myPA" : "a registry"}. Uninstall it first to replace it with a file.`,
        );
      await installBundle(bundle, { source: "file", trust: "unverified", registryUrl: null });
      return snap();
    }),
  );

  ipcMain.handle(MARKET_IPC.linkDev, (e) =>
    wrap(async () => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const picked = await dialog.showOpenDialog(win!, {
        title: "Load an unpacked widget folder",
        properties: ["openDirectory"],
      });
      if (picked.canceled || !picked.filePaths[0]) return null;
      const manifest = await linkDevFolder(picked.filePaths[0]);
      watchDev(manifest.id, picked.filePaths[0]);
      return snap();
    }),
  );

  ipcMain.handle(MARKET_IPC.uninstall, (_e, id: string) =>
    wrap(async () => {
      watchers.get(id)?.close();
      watchers.delete(id);
      await uninstallWidget(id);
      return snap();
    }),
  );

  ipcMain.handle(MARKET_IPC.setEnabled, (_e, id: string, enabled: boolean) =>
    wrap(() => {
      db.setInstalledWidgetEnabled(id, enabled);
      db.flush();
      return snap();
    }),
  );

  ipcMain.handle(MARKET_IPC.activateLicense, (_e, id: string, key: string) =>
    wrap(async () => {
      const installed = db.getInstalledWidget(id);
      if (!installed) throw new WidgetError("Install the widget first, then add its license key.");
      const item = await findCatalogWidget(id, installed.registryUrl);
      const payload = verifyLicense(key, id, item?.publisher.licenseKey);
      if (!payload)
        throw new WidgetError(
          "That license key isn't valid for this widget. Check it was copied in full.",
        );
      db.setInstalledWidgetLicense(id, key.trim(), payload.licensee);
      db.flush();
      return snap();
    }),
  );

  ipcMain.handle(MARKET_IPC.addRegistry, (_e, url: string) =>
    wrap(async () => {
      addRegistry(url);
      return getCatalog(true);
    }),
  );

  ipcMain.handle(MARKET_IPC.removeRegistry, (_e, url: string) =>
    wrap(async () => {
      removeRegistry(url);
      return getCatalog(true);
    }),
  );

  ipcMain.handle(
    MARKET_IPC.bridgeFetch,
    (
      _e,
      widgetId: string,
      url: string,
      init: { method?: string; headers?: Record<string, string>; body?: string },
    ) =>
      wrap(async (): Promise<BridgeFetchResult> => {
        const installed = requireInstalled(widgetId);
        if (!hostAllowed(installed.manifest.permissions, url))
          throw new WidgetError(`This widget isn't allowed to connect to ${url}.`);
        const method = (init.method ?? "GET").toUpperCase();
        if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
          throw new WidgetError(`Unsupported method ${method}.`);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20_000);
        try {
          const res = await fetch(url, {
            method,
            headers: init.headers,
            body: method === "GET" ? undefined : init.body,
            signal: ctrl.signal,
            redirect: "error",
            credentials: "omit",
          });
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > MAX_FETCH_BYTES) throw new WidgetError("The response was larger than 2 MB.");
          const headers: Record<string, string> = {};
          for (const k of ["content-type", "etag", "last-modified", "cache-control"]) {
            const v = res.headers.get(k);
            if (v) headers[k] = v;
          }
          return { status: res.status, headers, body: buf.toString("utf8") };
        } catch (err) {
          if (err instanceof WidgetError) throw err;
          throw new WidgetError(`Couldn't reach ${new URL(url).hostname}.`);
        } finally {
          clearTimeout(timer);
        }
      }),
  );

  ipcMain.handle(MARKET_IPC.bridgeNotify, (_e, widgetId: string, title: string, body: string) =>
    wrap(() => {
      const installed = requireInstalled(widgetId);
      if (!installed.manifest.permissions.includes("notify"))
        throw new WidgetError("This widget isn't allowed to show notifications.");
      new Notification({
        title: title.slice(0, 80) || installed.manifest.name,
        body: body.slice(0, 240),
        subtitle: installed.manifest.name,
      }).show();
      return null;
    }),
  );

  ipcMain.handle(MARKET_IPC.openExternal, (_e, url: string) =>
    wrap(async () => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new WidgetError("That isn't a valid link.");
      }
      if (parsed.protocol !== "https:") throw new WidgetError("Only https links can be opened.");
      await shell.openExternal(parsed.href);
      return null;
    }),
  );
}
