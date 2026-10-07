import type { Snapshot } from "./types";
import type { Catalog } from "./widgetPlatform";

export const MARKET_IPC = {
  catalog: "market:catalog",
  install: "market:install",
  installFile: "market:installFile",
  linkDev: "market:linkDev",
  uninstall: "market:uninstall",
  setEnabled: "market:setEnabled",
  activateLicense: "market:activateLicense",
  addRegistry: "market:addRegistry",
  removeRegistry: "market:removeRegistry",
  bridgeFetch: "market:bridgeFetch",
  bridgeNotify: "market:bridgeNotify",
  openExternal: "market:openExternal",
  /** Pushed when a dev-linked widget's files change on disk. */
  devChanged: "market:devChanged",
  /** Pushed when a mypa://widget/<id> link is opened. */
  openWidget: "market:openWidget",
} as const;

/** Every call resolves (never rejects); failures come back as `error`. */
export type MarketResult<T = Snapshot> = { ok: true; value: T } | { ok: false; error: string };

export interface BridgeFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface MypaMarket {
  catalog: (force?: boolean) => Promise<MarketResult<Catalog>>;
  install: (id: string, registryUrl: string) => Promise<MarketResult>;
  /** Native picker for a `.mypawidget` file; `value` is null if cancelled. */
  installFile: () => Promise<MarketResult<Snapshot | null>>;
  /** Native folder picker; links an unpacked widget for development. */
  linkDev: () => Promise<MarketResult<Snapshot | null>>;
  uninstall: (id: string) => Promise<MarketResult>;
  setEnabled: (id: string, enabled: boolean) => Promise<MarketResult>;
  activateLicense: (id: string, key: string) => Promise<MarketResult>;
  addRegistry: (url: string) => Promise<MarketResult<Catalog>>;
  removeRegistry: (url: string) => Promise<MarketResult<Catalog>>;
  /** Bridge calls made on behalf of a widget; main re-checks its permissions. */
  bridgeFetch: (
    widgetId: string,
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<MarketResult<BridgeFetchResult>>;
  bridgeNotify: (widgetId: string, title: string, body: string) => Promise<MarketResult<null>>;
  openExternal: (url: string) => Promise<MarketResult<null>>;
  onDevChanged: (cb: (widgetId: string) => void) => () => void;
  onOpenWidget: (cb: (widgetId: string) => void) => () => void;
}
