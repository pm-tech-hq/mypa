/**
 * Builds a custom widget from a description: the code model writes the
 * manifest and files, the SDK's own validation checks them, and the result is
 * installed like a widget from a file (Unverified, sandboxed as usual).
 */
import {
  BUNDLE_FORMAT,
  CATEGORY_LABEL,
  MANIFEST_SCHEMA,
  WIDGET_ICON_KEYS,
  validateManifest,
  type WidgetBundle,
  type WidgetManifest,
} from "../../shared/widgetPlatform";
import * as db from "../db";
import { installBundle } from "../widgets/store";
import { runModel, type AgentMsg, type Target } from "./models";

const GUIDE = `You write widgets for myPA, a desktop app where widgets are small sandboxed web pages in an iframe.

Return ONLY one JSON object, no prose, no code fences:
{
  "name": "Short name",
  "summary": "One line, under 90 characters",
  "icon": one of ${JSON.stringify(WIDGET_ICON_KEYS)},
  "category": one of ${JSON.stringify(Object.keys(CATEGORY_LABEL))},
  "size": { "w": 360, "h": 300, "minW": 240, "minH": 180 },
  "permissions": [],
  "settings": [],
  "files": { "index.html": "...", "widget.js": "..." }
}

Rules for the code:
- index.html must link the host theme and runtime in <head>:
  <link rel="stylesheet" href="/__mypa/theme.css" />
  <script src="/__mypa/sdk.js"></script>
  and load widget.js at the end of <body>. Inline <style> is fine.
- No external scripts, fonts, images or CDNs. No network unless the user asked for live data; then add "net:<host>" to permissions and use mypa.fetch(url) (https only).
- Persist everything with the async storage API; it survives restarts:
  await mypa.storage.get(key)   await mypa.storage.set(key, value)   await mypa.storage.remove(key)
  Load saved data inside mypa.ready.then(async () => { ... }).
- Optional settings fields (the host draws the form): {"key","label","type": "text"|"number"|"toggle"|"select", "default", ...}. Read with mypa.settings, react with mypa.onSettings(cb).
- Optional, only if needed (and listed in permissions): mypa.tasks.list() / mypa.tasks.onChange(cb) ("tasks:read"), mypa.tasks.create({title, importance}) / mypa.tasks.setDone(id, done) ("tasks:write"), mypa.calendar.list({days}) ("calendar:read"), mypa.notify(title, body) ("notify"). mypa.openUrl(url) needs no permission.
- Style: use the theme's CSS variables (--ds-fg, --ds-muted, --ds-border, --ds-surface, --ds-sunken, --ds-accent, --ds-accent-soft, --ds-radius-md) and classes (.btn, .btn.primary, .btn.ghost, .field, .muted, .num). Font is inherited. Calm, monochrome, one accent colour. 13px base text.
- Layout must work from about 240px to 800px wide and fill the height (html, body { height: 100% }). Scroll inside the widget if content grows.
- Every control works with mouse and keyboard; buttons have clear labels. Show a friendly empty state.
- Keep it small and finished: no placeholders, no TODOs, no console errors.`;

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "widget"
  );
}

function uniqueId(name: string): string {
  const base = `me.${slug(name)}`;
  let id = base;
  for (let n = 2; db.getInstalledWidget(id); n++) id = `${base}-${n}`;
  return id;
}

/** Pulls the first JSON object out of a reply, tolerating code fences. */
function extractJson(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model didn't return a widget.");
  return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
}

function toBundle(spec: Record<string, unknown>, id: string, fallbackName: string): WidgetBundle {
  const files = (spec.files ?? {}) as Record<string, unknown>;
  const encoded: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (typeof content === "string")
      encoded[path] = Buffer.from(content, "utf8").toString("base64");
  }
  const size = (spec.size ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : d));
  const manifest: WidgetManifest = {
    schema: MANIFEST_SCHEMA,
    id,
    name: String(spec.name ?? fallbackName).slice(0, 40) || fallbackName,
    version: "1.0.0",
    summary: String(spec.summary ?? "Made with the Assistant").slice(0, 90),
    description: "Built by the myPA Assistant from your description.",
    publisher: { id: "me", name: "Made with Assistant" },
    icon: WIDGET_ICON_KEYS.includes(spec.icon as (typeof WIDGET_ICON_KEYS)[number])
      ? String(spec.icon)
      : "sparkles",
    category: (Object.keys(CATEGORY_LABEL).includes(String(spec.category))
      ? spec.category
      : "productivity") as WidgetManifest["category"],
    entry: "index.html",
    size: {
      w: num(size.w, 360, 200, 1200),
      h: num(size.h, 300, 140, 1000),
      minW: num(size.minW, 240, 160, 800),
      minH: num(size.minH, 160, 100, 800),
    },
    permissions: Array.isArray(spec.permissions)
      ? (spec.permissions as WidgetManifest["permissions"])
      : [],
    ...(Array.isArray(spec.settings) && spec.settings.length
      ? { settings: spec.settings as WidgetManifest["settings"] }
      : {}),
  };
  return { format: BUNDLE_FORMAT, manifest, files: encoded };
}

export async function buildWidget(
  target: Target,
  spec: { name: string; description: string },
  signal: AbortSignal,
  onStatus: (t: string) => void,
  jobId: string,
): Promise<{ pluginId: string; name: string }> {
  const id = uniqueId(spec.name || "widget");
  const messages: AgentMsg[] = [
    { role: "system", content: GUIDE },
    {
      role: "user",
      content: `Build this widget.\nName: ${spec.name}\nWhat it does: ${spec.description}`,
    },
  ];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    onStatus(
      attempt === 0 ? `Writing the “${spec.name}” widget…` : "Fixing a problem in the widget…",
    );
    if (lastError) {
      messages.push({
        role: "user",
        content: `That didn't work: ${lastError}\nReturn the corrected JSON object only.`,
      });
    }
    let text = "";
    const reply = await runModel(
      target,
      messages,
      [],
      signal,
      (t) => (text += t),
      onStatus,
      `${jobId}-build-${attempt}`,
    );
    text = text || reply.text;
    try {
      const bundle = toBundle(extractJson(text), id, spec.name || "Widget");
      const problems = validateManifest(bundle.manifest);
      const html = bundle.files["index.html"]
        ? Buffer.from(bundle.files["index.html"], "base64").toString("utf8")
        : "";
      if (!html) problems.push("index.html is missing");
      else if (!html.includes("/__mypa/sdk.js"))
        problems.push("index.html must load /__mypa/sdk.js");
      if (problems.length) throw new Error(problems.join("; "));
      await installBundle(bundle, { source: "file", trust: "unverified", registryUrl: null });
      return { pluginId: id, name: bundle.manifest.name };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      messages.push({ role: "assistant", content: text.slice(0, 20_000) });
    }
  }
  throw new Error(`Couldn't build a working widget: ${lastError}`);
}
