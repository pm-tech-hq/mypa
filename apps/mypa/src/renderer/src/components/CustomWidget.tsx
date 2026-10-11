import { useEffect, useMemo, useRef, useState } from "react";

import { KeyRound, Lock, PackageX, PowerOff, ShoppingBag } from "lucide-react";

import type { WidgetRow } from "../../../shared/types";
import {
  WIDGET_SCHEME,
  formatPrice,
  type BridgeEvent,
  type BridgeRequest,
  type BridgeResponse,
  type InstalledWidget,
  type Permission,
} from "../../../shared/widgetPlatform";
import { mergeEvents } from "../lib/calendar";
import { unwrap } from "../lib/market";
import { openMarket } from "../lib/marketBus";
import { useReadyStore } from "../lib/store";
import { Button } from "./ui/button";

/** Tokens a widget's theme.css can pick up live from the host. */
const THEME_VARS = [
  "--ds-bg",
  "--ds-surface",
  "--ds-sunken",
  "--ds-fg",
  "--ds-fg-2",
  "--ds-muted",
  "--ds-faint",
  "--ds-border",
  "--ds-border-strong",
  "--ds-hover",
  "--ds-press",
  "--ds-accent",
  "--ds-accent-hover",
  "--ds-accent-ink",
  "--ds-accent-fg",
  "--ds-accent-soft",
  "--ds-danger",
];

const MAX_STORAGE_BYTES = 512 * 1024;

function themeVars(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(THEME_VARS.map((v) => [v, cs.getPropertyValue(v).trim()]));
}

/** Manifest defaults overlaid with the user's values. */
function resolvedSettings(installed: InstalledWidget, config: Record<string, unknown> | undefined) {
  const out: Record<string, unknown> = {};
  for (const f of installed.manifest.settings ?? []) if (f.default !== undefined) out[f.key] = f.default;
  return { ...out, ...(config ?? {}) };
}

export function CustomWidget({ widget }: { widget: WidgetRow }) {
  const { snapshot } = useReadyStore();
  const pluginId = widget.settings.pluginId ?? "";
  const installed = snapshot.installedWidgets.find((w) => w.manifest.id === pluginId);

  if (!installed) {
    return (
      <div className="blankstate">
        <span className="blankstate__icon">
          <PackageX size={16} />
        </span>
        <p className="blankstate__title">This widget isn't installed</p>
        <p className="blankstate__text">It was removed, or this board came from another computer.</p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => openMarket({ view: "widget", id: pluginId })}
        >
          Find it in the marketplace
        </Button>
      </div>
    );
  }

  if (!installed.enabled) return <TurnedOff installed={installed} />;
  if (installed.manifest.price && !installed.licensee && installed.source === "registry")
    return <Locked installed={installed} />;

  return <WidgetFrame widget={widget} installed={installed} />;
}

function TurnedOff({ installed }: { installed: InstalledWidget }) {
  const { actions } = useReadyStore();
  return (
    <div className="blankstate">
      <span className="blankstate__icon">
        <PowerOff size={16} />
      </span>
      <p className="blankstate__title">{installed.manifest.name} is turned off</p>
      <p className="blankstate__text">It keeps its data while it's off.</p>
      <Button
        size="sm"
        className="mt-3"
        onClick={() =>
          void unwrap(window.mypa.market.setEnabled(installed.manifest.id, true)).then(
            actions.applySnapshot,
          )
        }
      >
        Turn on
      </Button>
    </div>
  );
}

function Locked({ installed }: { installed: InstalledWidget }) {
  const price = installed.manifest.price!;
  return (
    <div className="blankstate">
      <span className="blankstate__icon">
        <Lock size={16} />
      </span>
      <p className="blankstate__title">Unlock {installed.manifest.name}</p>
      <p className="blankstate__text">
        {formatPrice(price)} from {installed.manifest.publisher.name}. Buy it, then paste the
        license key you receive.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => void window.mypa.market.openExternal(price.checkoutUrl)}>
          <ShoppingBag />
          Buy
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => openMarket({ view: "widget", id: installed.manifest.id })}
        >
          <KeyRound />
          Enter key
        </Button>
      </div>
    </div>
  );
}

function WidgetFrame({ widget, installed }: { widget: WidgetRow; installed: InstalledWidget }) {
  const { snapshot, actions } = useReadyStore();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [reloads, setReloads] = useState(0);
  const [connected, setConnected] = useState(false);
  const id = installed.manifest.id;
  const permissions = installed.manifest.permissions;
  const can = (p: Permission) => permissions.includes(p);

  const settings = useMemo(
    () => resolvedSettings(installed, widget.settings.config),
    [installed, widget.settings.config],
  );

  // Handlers read the latest values through a ref so the listener is stable.
  const live = useRef({ widget, installed, settings, snapshot });
  live.current = { widget, installed, settings, snapshot };
  // The host's own copy of the widget's storage, updated before the DB round
  // trip so back-to-back writes never read a stale snapshot and drop data.
  const storage = useRef<Record<string, unknown>>({ ...(widget.settings.storage ?? {}) });
  /** Storage states this host wrote recently, so their DB echoes aren't
   *  mistaken for someone else (the Assistant, an undo) changing the data. */
  const written = useRef<string[]>([]);

  const post = (msg: BridgeResponse | BridgeEvent) =>
    frameRef.current?.contentWindow?.postMessage(msg, "*");

  const taskView = () =>
    live.current.snapshot.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      project: t.project,
      importance: t.importance,
      section: t.section,
      done: t.done,
      due: t.due,
    }));

  useEffect(() => {
    async function handle(req: BridgeRequest): Promise<unknown> {
      const { widget: w, settings: s, snapshot: snap } = live.current;
      const params = (req.params ?? {}) as Record<string, unknown>;
      const deny = (p: string) => {
        throw new Error(`This widget doesn't have the "${p}" permission.`);
      };
      switch (req.method) {
        case "ready":
          setConnected(true);
          return {
            widget: {
              id,
              name: installed.manifest.name,
              version: installed.manifest.version,
            },
            instanceId: w.id,
            settings: s,
            permissions,
            theme: { vars: themeVars() },
          };
        case "storage.get":
          return storage.current[String(params.key)] ?? null;
        case "storage.set":
        case "storage.remove": {
          const next = { ...storage.current };
          if (req.method === "storage.set") next[String(params.key)] = params.value;
          else delete next[String(params.key)];
          if (JSON.stringify(next).length > MAX_STORAGE_BYTES)
            throw new Error("Storage is full (512 KB per widget).");
          storage.current = next;
          written.current = [...written.current.slice(-15), JSON.stringify(next)];
          await actions.updateWidgetSettings(w.id, { storage: next });
          return true;
        }
        case "tasks.list":
          if (!can("tasks:read")) deny("tasks:read");
          return taskView();
        case "tasks.create": {
          if (!can("tasks:write")) deny("tasks:write");
          const title = String(params.title ?? "").trim().slice(0, 300);
          if (!title) throw new Error("A task needs a title.");
          const importance = ["high", "medium", "low"].includes(String(params.importance))
            ? (params.importance as "high" | "medium" | "low")
            : "medium";
          await actions.createTask({ title, importance, section: "today", project: "myPA" });
          return true;
        }
        case "tasks.setDone": {
          // The only change a widget can make to an existing task: tick it off or back on.
          if (!can("tasks:write")) deny("tasks:write");
          const id = String(params.id ?? "");
          if (!snap.tasks.some((t) => t.id === id)) throw new Error("That task doesn't exist.");
          await actions.updateTask(id, { done: params.done !== false });
          return true;
        }
        case "calendar.list": {
          if (!can("calendar:read")) deny("calendar:read");
          const days = Math.min(90, Math.max(1, Number(params.days) || 14));
          const from = Date.now() - 86_400_000;
          const to = Date.now() + days * 86_400_000;
          return mergeEvents(snap.calendarEvents, snap.calendarRemoteEvents, snap.calendarAccounts)
            .filter((e) => e.end >= from && e.start <= to)
            .map((e) => ({
              id: e.id,
              title: e.title,
              location: e.location,
              start: e.start,
              end: e.end,
              allDay: e.allDay,
              source: e.source,
            }));
        }
        case "net.fetch":
          return unwrap(
            window.mypa.market.bridgeFetch(
              id,
              String(params.url),
              (params.init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string },
            ),
          );
        case "notify":
          if (!can("notify")) deny("notify");
          return unwrap(
            window.mypa.market.bridgeNotify(id, String(params.title ?? ""), String(params.body ?? "")),
          );
        case "openUrl":
          return unwrap(window.mypa.market.openExternal(String(params.url)));
        default:
          throw new Error(`Unknown request: ${String(req.method)}`);
      }
    }

    const onMessage = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const req = e.data as BridgeRequest;
      if (!req || req.mypa !== 1 || typeof req.id !== "number") return;
      handle(req).then(
        (result) => post({ mypa: 1, id: req.id, ok: true, result }),
        (err: Error) => post({ mypa: 1, id: req.id, ok: false, error: err.message }),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // Stable for the life of the frame; everything live is read from `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Push changes the widget has permission to see. Every snapshot rebuilds the
  // settings object (a storage write included), so compare values: a widget
  // that refetches on onSettings and saves to storage would otherwise loop.
  const sentSettings = useRef<string | null>(null);
  useEffect(() => {
    if (!connected) {
      sentSettings.current = null;
      return;
    }
    const json = JSON.stringify(settings);
    if (json === sentSettings.current) return;
    sentSettings.current = json;
    post({ mypa: 1, event: "settings", data: settings });
  }, [settings, connected]);

  const tasksKey = can("tasks:read") ? snapshot.tasks : null;
  useEffect(() => {
    if (connected && tasksKey) post({ mypa: 1, event: "tasks", data: taskView() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksKey, connected]);

  // Data changed from outside the widget (the Assistant, an undo): adopt it and
  // reload the frame so the widget reads it fresh.
  const storedJson = JSON.stringify(widget.settings.storage ?? {});
  useEffect(() => {
    if (storedJson === JSON.stringify(storage.current)) {
      written.current = [];
      return;
    }
    if (written.current.includes(storedJson)) return;
    storage.current = JSON.parse(storedJson) as Record<string, unknown>;
    written.current = [];
    setConnected(false);
    setReloads((n) => n + 1);
  }, [storedJson]);

  // Dev-linked widgets reload whenever their files change on disk.
  useEffect(() => {
    if (installed.source !== "dev") return;
    return window.mypa.market.onDevChanged((changed) => {
      if (changed === id) {
        setConnected(false);
        setReloads((n) => n + 1);
      }
    });
  }, [id, installed.source]);

  const src = `${WIDGET_SCHEME}://${id}/${installed.manifest.entry}?v=${installed.updatedAt}-${reloads}`;

  return (
    <iframe
      ref={frameRef}
      key={src}
      className={`custom-frame${connected ? " is-ready" : ""}`}
      src={src}
      title={widget.title}
      sandbox="allow-scripts allow-forms"
      referrerPolicy="no-referrer"
      onLoad={() => {
        // A widget that never includes the SDK still gets shown.
        window.setTimeout(() => setConnected(true), 400);
      }}
    />
  );
}
