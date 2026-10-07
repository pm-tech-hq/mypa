import { useCallback, useEffect, useState } from "react";

import {
  BarChart3,
  BookOpen,
  Calculator,
  Clock,
  CloudSun,
  Globe,
  Heart,
  Hourglass,
  Link2,
  ListChecks,
  Music,
  Puzzle,
  Quote,
  Repeat,
  Sparkles,
  Target,
  Timer,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { MarketResult } from "../../../shared/marketApi";
import type {
  Catalog,
  CatalogWidget,
  InstalledWidget,
  TrustLevel,
} from "../../../shared/widgetPlatform";

const ICONS: Record<string, LucideIcon> = {
  timer: Timer,
  repeat: Repeat,
  link: Link2,
  hourglass: Hourglass,
  globe: Globe,
  "cloud-sun": CloudSun,
  target: Target,
  quote: Quote,
  calculator: Calculator,
  music: Music,
  "book-open": BookOpen,
  "bar-chart": BarChart3,
  heart: Heart,
  zap: Zap,
  puzzle: Puzzle,
  sparkles: Sparkles,
  clock: Clock,
  "list-checks": ListChecks,
};

export function widgetIcon(key: string | undefined): LucideIcon {
  return (key && ICONS[key]) || Puzzle;
}

export const TRUST: Record<TrustLevel, { label: string; detail: string }> = {
  official: {
    label: "Official",
    detail: "Made by myPA. Reviewed and signed by the myPA team.",
  },
  verified: {
    label: "Verified publisher",
    detail: "The publisher's identity was checked by the registry, and every download is signed.",
  },
  community: {
    label: "Community",
    detail: "Listed in a registry, but the publisher's identity hasn't been checked.",
  },
  unverified: {
    label: "Unverified",
    detail: "Installed from a file or a folder. myPA can't tell who made it.",
  },
};

/** Unwraps a marketplace result into the value, or throws its message. */
export async function unwrap<T>(p: Promise<MarketResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/* ---- catalog: one shared, lazily loaded copy for every consumer ---------- */

let cached: Catalog | null = null;
let inflight: Promise<Catalog> | null = null;
const subscribers = new Set<(c: Catalog | null, error: string | null) => void>();

function publish(c: Catalog | null, error: string | null) {
  for (const s of subscribers) s(c, error);
}

export async function loadCatalog(force = false): Promise<Catalog> {
  if (cached && !force) return cached;
  inflight ??= unwrap(window.mypa.market.catalog(force))
    .then((c) => {
      cached = c;
      publish(c, null);
      return c;
    })
    .catch((err: Error) => {
      publish(cached, err.message);
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function setCatalog(c: Catalog): void {
  cached = c;
  publish(c, null);
}

export function useCatalog() {
  const [catalog, setLocal] = useState<Catalog | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    const sub = (c: Catalog | null, e: string | null) => {
      setLocal(c);
      setError(e);
      setLoading(false);
    };
    subscribers.add(sub);
    if (!cached) void loadCatalog().catch(() => undefined);
    return () => {
      subscribers.delete(sub);
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await loadCatalog(true).catch(() => undefined);
  }, []);

  return { catalog, error, loading, refresh };
}

/** Catalog entry with a newer version than what's installed. */
export function updateFor(
  installed: InstalledWidget,
  catalog: Catalog | null,
): CatalogWidget | null {
  if (!catalog || installed.source !== "registry") return null;
  const item = catalog.widgets.find(
    (w) => w.entry.manifest.id === installed.manifest.id && w.registryUrl === installed.registryUrl,
  );
  if (!item) return null;
  return compare(item.entry.manifest.version, installed.manifest.version) > 0 ? item : null;
}

function compare(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}
