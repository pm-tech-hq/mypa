import {
  compareVersions,
  MAX_BUNDLE_BYTES,
  REGISTRY_FORMAT,
  type Catalog,
  type CatalogWidget,
  type RegistryPublisher,
  type RegistryStatus,
  type SignedRegistry,
  type TrustLevel,
  type WidgetBundle,
} from "../../shared/widgetPlatform";
import * as db from "../db";
import { parseBundle, WidgetError } from "./store";
import { sha256Hex, verifyRegistry } from "./trust";

/**
 * The official catalog ships inside the app (built by
 * `pnpm --filter mypa widgets:build`), so the marketplace works offline and
 * on first launch. Further registries are plain https URLs the user adds.
 */
import builtinRegistryRaw from "../../../resources/registry/registry.json?raw";

const builtinBundles = import.meta.glob("../../../resources/registry/bundles/*.mypawidget", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const BUILTIN_REGISTRY = "builtin:official";
/** The hosted marketplace (apps/market). Always listed; can't be removed. */
export const MARKETPLACE_REGISTRY = "https://mypa-market.vercel.app/registry.json";
const USER_REGISTRIES_KEY = "widgetRegistries";
const FETCH_TIMEOUT_MS = 15_000;

interface LoadedRegistry {
  status: RegistryStatus;
  signed: SignedRegistry | null;
}

let cache: { at: number; loaded: LoadedRegistry[] } | null = null;
const CACHE_MS = 5 * 60_000;

export function userRegistries(): string[] {
  return db.getMetaJson<string[]>(USER_REGISTRIES_KEY, []);
}

export function addRegistry(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new WidgetError("That isn't a valid URL.");
  }
  if (parsed.protocol !== "https:") throw new WidgetError("Registries must use https.");
  const list = userRegistries();
  if (!list.includes(parsed.href)) db.setMetaJson(USER_REGISTRIES_KEY, [...list, parsed.href]);
  cache = null;
}

export function removeRegistry(url: string): void {
  db.setMetaJson(
    USER_REGISTRIES_KEY,
    userRegistries().filter((u) => u !== url),
  );
  cache = null;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

async function loadOne(url: string): Promise<LoadedRegistry> {
  const builtIn = url === BUILTIN_REGISTRY || url === MARKETPLACE_REGISTRY;
  const status: RegistryStatus = {
    url,
    name: url === BUILTIN_REGISTRY ? "myPA Official" : url === MARKETPLACE_REGISTRY ? "myPA Marketplace" : url,
    builtIn,
    trusted: false,
    ok: false,
    error: null,
    widgetCount: 0,
    fetchedAt: Date.now(),
  };
  try {
    let text: string;
    if (url === BUILTIN_REGISTRY) {
      text = builtinRegistryRaw;
    } else {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new WidgetError(`The registry answered ${res.status}.`);
      text = await res.text();
    }
    const signed = JSON.parse(text) as SignedRegistry;
    if (signed?.index?.format !== REGISTRY_FORMAT)
      throw new WidgetError("That URL isn't a myPA widget registry.");
    const verdict = verifyRegistry(signed);
    if (!verdict.intact)
      throw new WidgetError("The registry's signature doesn't match its contents. It may have been tampered with.");
    status.name = signed.index.name || status.name;
    status.trusted = verdict.rootSigned;
    status.ok = true;
    status.widgetCount = signed.index.widgets.length;
    return { status, signed };
  } catch (err) {
    status.error =
      err instanceof WidgetError
        ? err.message
        : url === BUILTIN_REGISTRY
          ? "The built-in catalog is missing. Run the widgets build."
          : "Couldn't reach the registry.";
    return { status, signed: null };
  }
}

function trustFor(publisher: RegistryPublisher | undefined, rootSigned: boolean): TrustLevel {
  if (!rootSigned || !publisher) return "community";
  if (publisher.official) return "official";
  return publisher.verified ? "verified" : "community";
}

async function loadAll(force: boolean): Promise<LoadedRegistry[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.loaded;
  const loaded = await Promise.all(
    [BUILTIN_REGISTRY, MARKETPLACE_REGISTRY, ...userRegistries().filter((u) => u !== MARKETPLACE_REGISTRY)].map(
      loadOne,
    ),
  );
  cache = { at: Date.now(), loaded };
  return loaded;
}

/** Every valid entry from every registry, in registry order, duplicates included. */
function candidates(loaded: LoadedRegistry[]): CatalogWidget[] {
  const out: CatalogWidget[] = [];
  for (const { status, signed } of loaded) {
    if (!signed) continue;
    for (const entry of signed.index.widgets) {
      // A manifest must belong to the publisher it claims.
      if (!entry.manifest.id.startsWith(`${entry.manifest.publisher.id}.`)) continue;
      const publisher = signed.index.publishers[entry.manifest.publisher.id] ?? {
        name: entry.manifest.publisher.name,
        verified: false,
      };
      out.push({
        entry,
        publisher,
        trust: trustFor(signed.index.publishers[entry.manifest.publisher.id], status.trusted),
        registryUrl: status.url,
        registryName: status.name,
      });
    }
  }
  return out;
}

/** Every registry's widgets, trust decided here (never by the registry's say-so alone). */
export async function getCatalog(force = false): Promise<Catalog> {
  const loaded = await loadAll(force);
  const byId = new Map<string, CatalogWidget>();
  for (const item of candidates(loaded)) {
    const id = item.entry.manifest.id;
    const current = byId.get(id);
    // First registry wins on duplicate ids, so a community registry can't
    // shadow an official widget. The exception: a trusted registry may carry a
    // newer version of a trusted widget from the same publisher, which is how
    // official widgets published on the hosted marketplace reach the app
    // after the built-in catalog was frozen into a release.
    const newer =
      current !== undefined &&
      item.trust !== "community" &&
      current.trust !== "community" &&
      item.entry.manifest.publisher.id === current.entry.manifest.publisher.id &&
      compareVersions(item.entry.manifest.version, current.entry.manifest.version) > 0;
    if (!current || newer) byId.set(id, item);
  }
  return { widgets: [...byId.values()], registries: loaded.map((l) => l.status) };
}

/** With a registry URL, finds that registry's copy even when another
 *  registry's copy is the one the catalog shows. */
export async function findCatalogWidget(
  id: string,
  registryUrl?: string | null,
): Promise<CatalogWidget | null> {
  if (!registryUrl) return (await getCatalog()).widgets.find((w) => w.entry.manifest.id === id) ?? null;
  return (
    candidates(await loadAll(false)).find((w) => w.entry.manifest.id === id && w.registryUrl === registryUrl) ?? null
  );
}

/** Downloads a bundle and checks it against the signed index's hash and manifest. */
export async function downloadBundle(item: CatalogWidget): Promise<WidgetBundle> {
  let raw: string;
  if (item.registryUrl === BUILTIN_REGISTRY) {
    const name = item.entry.bundleUrl.split("/").pop() ?? "";
    const key = Object.keys(builtinBundles).find((k) => k.endsWith(`/${name}`));
    if (!key) throw new WidgetError("This widget's files are missing from the built-in catalog.");
    raw = builtinBundles[key]!;
  } else {
    const url = new URL(item.entry.bundleUrl, item.registryUrl);
    if (url.protocol !== "https:") throw new WidgetError("Widget downloads must use https.");
    const res = await fetchWithTimeout(url.href);
    if (!res.ok) throw new WidgetError(`The download failed (${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BUNDLE_BYTES) throw new WidgetError("That widget is larger than the 8 MB limit.");
    raw = buf.toString("utf8");
  }
  if (sha256Hex(raw) !== item.entry.sha256)
    throw new WidgetError("The download doesn't match the registry's fingerprint, so it wasn't installed.");
  const bundle = parseBundle(raw);
  const m = bundle.manifest;
  if (m.id !== item.entry.manifest.id || m.version !== item.entry.manifest.version)
    throw new WidgetError("The download doesn't match the widget listed in the registry.");
  // The signed registry, not the bundle, decides the price: the hosted
  // marketplace sets prices outside the manifest and runs the checkout.
  const price = item.entry.manifest.price;
  return { ...bundle, manifest: { ...m, price } };
}
