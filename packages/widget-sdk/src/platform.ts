/**
 * The custom-widget platform contract, shared by main, renderer and the
 * `@repo/widget-sdk` CLI.
 *
 * A widget is a folder of plain web files plus a `manifest.json`. It is
 * distributed as a single `.mypawidget` file (JSON, files base64-encoded) and
 * listed in a signed registry. At runtime it lives in a sandboxed iframe with
 * an opaque origin; the only way it reaches myPA data is the postMessage
 * bridge, and every bridge call is checked against the permissions the user
 * approved at install time.
 */

export const MANIFEST_SCHEMA = 1;
export const BUNDLE_FORMAT = "mypa-widget@1";
export const REGISTRY_FORMAT = "mypa-registry@1";
export const WIDGET_SCHEME = "mypa-widget";

/* ------------------------------------------------------------ permissions -- */

/** Fixed capabilities. Network access is declared per host as `net:<host>`. */
export const PERMISSIONS = {
  "tasks:read": "See your tasks and goals",
  "tasks:write": "Add tasks to your to-do list and tick them off",
  "calendar:read": "See your calendar events",
  notify: "Show desktop notifications",
} as const;

export type FixedPermission = keyof typeof PERMISSIONS;
export type Permission = FixedPermission | `net:${string}`;

const HOST_RE = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/;

export function isPermission(value: unknown): value is Permission {
  if (typeof value !== "string") return false;
  if (value in PERMISSIONS) return true;
  return value.startsWith("net:") && HOST_RE.test(value.slice(4));
}

/** Plain-language line for the install sheet. */
export function describePermission(p: Permission): string {
  if (p.startsWith("net:")) return `Connect to ${p.slice(4)}`;
  return PERMISSIONS[p as FixedPermission];
}

/** Does `url` fall under a declared `net:` permission? `*.x.com` covers subdomains. */
export function hostAllowed(permissions: readonly string[], url: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return permissions.some((p) => {
    if (!p.startsWith("net:")) return false;
    const rule = p.slice(4);
    if (rule.startsWith("*.")) return host === rule.slice(2) || host.endsWith(rule.slice(1));
    return host === rule;
  });
}

/* --------------------------------------------------------------- manifest -- */

export type SettingField =
  | { key: string; label: string; type: "text"; default?: string; placeholder?: string }
  | { key: string; label: string; type: "number"; default?: number; min?: number; max?: number }
  | { key: string; label: string; type: "toggle"; default?: boolean }
  | {
      key: string;
      label: string;
      type: "select";
      default?: string;
      options: { value: string; label: string }[];
    };

export const WIDGET_CATEGORIES = [
  "productivity",
  "focus",
  "planning",
  "tracking",
  "information",
  "fun",
] as const;
export type WidgetCategory = (typeof WIDGET_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<WidgetCategory, string> = {
  productivity: "Productivity",
  focus: "Focus",
  planning: "Planning",
  tracking: "Tracking",
  information: "Information",
  fun: "Fun",
};

export interface WidgetPrice {
  /** Minor units, e.g. 499 = 4.99. */
  amount: number;
  currency: string;
  /** Publisher-hosted checkout (Stripe Payment Link, Lemon Squeezy, Gumroad...). */
  checkoutUrl: string;
}

export interface WidgetManifest {
  schema: typeof MANIFEST_SCHEMA;
  /** `<publisher-id>.<widget-name>`, lowercase, e.g. `mypa.pomodoro`. */
  id: string;
  name: string;
  version: string;
  /** One line, shown on cards and in the add menu. */
  summary: string;
  /** Longer text for the detail page; blank lines separate paragraphs. */
  description?: string;
  publisher: { id: string; name: string; url?: string };
  /** A lucide icon name from `WIDGET_ICON_KEYS`. */
  icon: string;
  category: WidgetCategory;
  /** HTML entry file inside the bundle. */
  entry: string;
  size: { w: number; h: number; minW?: number; minH?: number };
  permissions: Permission[];
  settings?: SettingField[];
  price?: WidgetPrice;
  homepage?: string;
  changelog?: string;
}

/** Icons a manifest may name (rendered by the host, so widgets can't smuggle SVG). */
export const WIDGET_ICON_KEYS = [
  "timer",
  "repeat",
  "link",
  "hourglass",
  "globe",
  "cloud-sun",
  "target",
  "quote",
  "calculator",
  "music",
  "book-open",
  "bar-chart",
  "heart",
  "zap",
  "puzzle",
  "sparkles",
  "clock",
  "list-checks",
] as const;

const ID_RE = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9a-z.-]+)?$/i;

/** Validates untrusted manifest JSON. Returns a list of problems (empty = ok). */
export function validateManifest(m: unknown): string[] {
  const errors: string[] = [];
  if (!m || typeof m !== "object") return ["manifest is not an object"];
  const o = m as Record<string, unknown>;
  const str = (k: string, max = 200) => {
    if (typeof o[k] !== "string" || !(o[k] as string).trim()) errors.push(`${k} is required`);
    else if ((o[k] as string).length > max) errors.push(`${k} is longer than ${max} characters`);
  };
  if (o.schema !== MANIFEST_SCHEMA) errors.push(`schema must be ${MANIFEST_SCHEMA}`);
  if (typeof o.id !== "string" || !ID_RE.test(o.id))
    errors.push("id must look like publisher.widget-name (lowercase)");
  str("name", 40);
  if (typeof o.version !== "string" || !SEMVER_RE.test(o.version))
    errors.push("version must be semver, e.g. 1.0.0");
  str("summary", 90);
  if (o.description !== undefined && typeof o.description !== "string")
    errors.push("description must be text");
  const pub = o.publisher as Record<string, unknown> | undefined;
  if (!pub || typeof pub.id !== "string" || typeof pub.name !== "string")
    errors.push("publisher needs an id and a name");
  else if (typeof o.id === "string" && !o.id.startsWith(`${pub.id}.`))
    errors.push("id must start with the publisher id");
  if (!WIDGET_ICON_KEYS.includes(o.icon as (typeof WIDGET_ICON_KEYS)[number]))
    errors.push(`icon must be one of: ${WIDGET_ICON_KEYS.join(", ")}`);
  if (!WIDGET_CATEGORIES.includes(o.category as WidgetCategory))
    errors.push(`category must be one of: ${WIDGET_CATEGORIES.join(", ")}`);
  if (typeof o.entry !== "string" || !/\.html?$/.test(o.entry)) errors.push("entry must be an .html file");
  const size = o.size as Record<string, unknown> | undefined;
  if (!size || typeof size.w !== "number" || typeof size.h !== "number")
    errors.push("size needs w and h");
  else if (size.w < 200 || size.h < 120 || size.w > 1600 || size.h > 1200)
    errors.push("size must be between 200x120 and 1600x1200");
  if (!Array.isArray(o.permissions)) errors.push("permissions must be a list (can be empty)");
  else
    for (const p of o.permissions)
      if (!isPermission(p)) errors.push(`unknown permission: ${String(p)}`);
  if (o.settings !== undefined) {
    if (!Array.isArray(o.settings)) errors.push("settings must be a list");
    else
      for (const f of o.settings as Record<string, unknown>[]) {
        if (!f || typeof f.key !== "string" || typeof f.label !== "string")
          errors.push("each setting needs a key and a label");
        else if (!["text", "number", "toggle", "select"].includes(String(f.type)))
          errors.push(`setting ${f.key}: unknown type ${String(f.type)}`);
      }
  }
  if (o.price !== undefined) {
    const p = o.price as Record<string, unknown>;
    if (typeof p.amount !== "number" || p.amount <= 0 || !Number.isInteger(p.amount))
      errors.push("price.amount must be a positive whole number of minor units");
    if (typeof p.currency !== "string" || !/^[A-Z]{3}$/.test(p.currency))
      errors.push("price.currency must be a 3-letter code like USD");
    if (typeof p.checkoutUrl !== "string" || !p.checkoutUrl.startsWith("https://"))
      errors.push("price.checkoutUrl must be an https link");
  }
  return errors;
}

export function formatPrice(price: WidgetPrice | undefined): string {
  if (!price) return "Free";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).format(
      price.amount / 100,
    );
  } catch {
    return `${(price.amount / 100).toFixed(2)} ${price.currency}`;
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/* ------------------------------------------------------ bundle / registry -- */

/** A `.mypawidget` file. */
export interface WidgetBundle {
  format: typeof BUNDLE_FORMAT;
  manifest: WidgetManifest;
  /** Relative path -> base64 file content. */
  files: Record<string, string>;
}

export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

export interface RegistryPublisher {
  name: string;
  url?: string;
  /** Vouched for by the registry operator (identity checked). */
  verified: boolean;
  /** myPA itself. Only honoured in a registry signed by the myPA root key. */
  official?: boolean;
  /** SPKI PEM of the key this publisher signs licenses with. */
  licenseKey?: string;
}

export interface RegistryEntry {
  manifest: WidgetManifest;
  /** Absolute, or relative to the registry URL. */
  bundleUrl: string;
  /** Hex sha256 of the bundle file. The app refuses a download that doesn't match. */
  sha256: string;
  bytes: number;
  updatedAt: string;
  featured?: boolean;
}

export interface RegistryIndex {
  format: typeof REGISTRY_FORMAT;
  name: string;
  generatedAt: string;
  publishers: Record<string, RegistryPublisher>;
  widgets: RegistryEntry[];
}

/** What a registry URL serves: the index plus a detached ed25519 signature. */
export interface SignedRegistry {
  index: RegistryIndex;
  /** base64 ed25519 signature over `canonicalJson(index)`. */
  signature: string;
  /** SPKI PEM of the signing key; trust is decided by the app, not by this field. */
  publicKey: string;
}

/** Deterministic JSON (sorted keys) so signatures survive re-serialisation. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/* ----------------------------------------------------------------- license -- */

/** Payload of a license key: `base64url(json(payload)).base64url(signature)`. */
export interface LicensePayload {
  widgetId: string;
  licensee: string;
  issuedAt: string;
}

/* ------------------------------------------------------------------- trust -- */

/**
 * - official: made by myPA (built-ins, and widgets from a root-signed registry
 *   whose publisher is marked official)
 * - verified: publisher vouched for by a root-signed registry
 * - community: listed in a registry, identity not checked
 * - unverified: installed from a file or a developer folder
 */
export type TrustLevel = "official" | "verified" | "community" | "unverified";

export type InstallSource = "registry" | "file" | "dev";

export interface InstalledWidget {
  manifest: WidgetManifest;
  source: InstallSource;
  trust: TrustLevel;
  registryUrl: string | null;
  enabled: boolean;
  /** Paid widgets only: licensee of a valid key, or null when unlicensed. */
  licensee: string | null;
  devPath: string | null;
  installedAt: number;
  updatedAt: number;
}

/** A catalog row as the renderer sees it: registry data + trust already decided by main. */
export interface CatalogWidget {
  entry: RegistryEntry;
  publisher: RegistryPublisher;
  trust: TrustLevel;
  registryUrl: string;
  registryName: string;
}

export interface RegistryStatus {
  url: string;
  name: string;
  builtIn: boolean;
  /** Signed by the myPA root key. */
  trusted: boolean;
  ok: boolean;
  error: string | null;
  widgetCount: number;
  fetchedAt: number | null;
}

export interface Catalog {
  widgets: CatalogWidget[];
  registries: RegistryStatus[];
}

/* ------------------------------------------------------------------ bridge -- */

/** Messages between a widget iframe and its host. */
export interface BridgeRequest {
  mypa: 1;
  id: number;
  method: BridgeMethod;
  params?: unknown;
}

export interface BridgeResponse {
  mypa: 1;
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface BridgeEvent {
  mypa: 1;
  event: "init" | "settings" | "theme" | "tasks" | "calendar";
  data: unknown;
}

export type BridgeMethod =
  | "ready"
  | "storage.get"
  | "storage.set"
  | "storage.remove"
  | "tasks.list"
  | "tasks.create"
  | "tasks.setDone"
  | "calendar.list"
  | "net.fetch"
  | "notify"
  | "openUrl";

/** A bundle path that stays inside the bundle, normalised to forward slashes. */
export function safeBundlePath(path: string): string | null {
  const unix = path.replace(/\\/g, "/");
  if (!unix || unix.startsWith("/") || /^[a-z]:/i.test(unix)) return null;
  const parts: string[] = [];
  for (const seg of unix.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}

/**
 * Parses and checks an untrusted `.mypawidget` file's text without touching
 * the filesystem. Used by the hosted marketplace on upload; the desktop app
 * applies the same rules before installing.
 */
export function checkBundle(
  text: string,
): { ok: true; bundle: WidgetBundle } | { ok: false; errors: string[] } {
  if (text.length > MAX_BUNDLE_BYTES) return { ok: false, errors: ["The file is larger than 8 MB."] };
  let bundle: WidgetBundle;
  try {
    bundle = JSON.parse(text) as WidgetBundle;
  } catch {
    return { ok: false, errors: ["That isn't a .mypawidget file (it isn't valid JSON)."] };
  }
  if (bundle?.format !== BUNDLE_FORMAT)
    return { ok: false, errors: ["That isn't a .mypawidget file. Pack it with `mypa-widget pack`."] };
  const errors = validateManifest(bundle.manifest);
  if (!bundle.files || typeof bundle.files !== "object") errors.push("The bundle has no files.");
  else {
    const paths = new Set<string>();
    for (const p of Object.keys(bundle.files)) {
      const safe = safeBundlePath(p);
      if (!safe) errors.push(`Unsafe file path: ${p}`);
      else paths.add(safe);
    }
    const entry = safeBundlePath(String(bundle.manifest?.entry ?? ""));
    if (!entry || !paths.has(entry)) errors.push(`The entry file ${String(bundle.manifest?.entry)} is missing.`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, bundle };
}
