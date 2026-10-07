import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";

import { app } from "electron";

import {
  BUNDLE_FORMAT,
  MAX_BUNDLE_BYTES,
  validateManifest,
  type InstallSource,
  type TrustLevel,
  type WidgetBundle,
  type WidgetManifest,
} from "../../shared/widgetPlatform";
import * as db from "../db";

/** Installed widgets live at `userData/widgets/<id>/`; dev widgets are served
 *  straight from the folder the developer picked. */
export function widgetsRoot(): string {
  return join(app.getPath("userData"), "widgets");
}

function installDir(id: string): string {
  return join(widgetsRoot(), id);
}

/** Rejects absolute paths and anything that climbs out of the bundle. */
export function safeRelative(path: string): string | null {
  const unix = path.replace(/\\/g, "/");
  if (unix.startsWith("/") || /^[a-z]:/i.test(unix)) return null;
  const clean = posix.normalize(unix);
  if (!clean || clean === "." || clean.split("/").includes("..")) return null;
  return clean;
}

export class WidgetError extends Error {}

/** Parses and checks an untrusted `.mypawidget` file. */
export function parseBundle(raw: Buffer | string): WidgetBundle {
  const size = typeof raw === "string" ? Buffer.byteLength(raw) : raw.length;
  if (size > MAX_BUNDLE_BYTES) throw new WidgetError("That widget is larger than the 8 MB limit.");
  let bundle: WidgetBundle;
  try {
    bundle = JSON.parse(raw.toString()) as WidgetBundle;
  } catch {
    throw new WidgetError("That file isn't a myPA widget.");
  }
  if (bundle?.format !== BUNDLE_FORMAT) throw new WidgetError("That file isn't a myPA widget.");
  const problems = validateManifest(bundle.manifest);
  if (problems.length) throw new WidgetError(`The widget's manifest has problems: ${problems.join("; ")}.`);
  if (!bundle.files || typeof bundle.files !== "object")
    throw new WidgetError("The widget has no files.");
  for (const path of Object.keys(bundle.files)) {
    if (!safeRelative(path)) throw new WidgetError(`The widget contains an unsafe file path: ${path}`);
  }
  const entry = safeRelative(bundle.manifest.entry);
  const paths = new Set(Object.keys(bundle.files).map((p) => safeRelative(p)));
  if (!entry || !paths.has(entry))
    throw new WidgetError(`The widget's entry file ${bundle.manifest.entry} is missing.`);
  return bundle;
}

/** Writes the files to a staging dir, then swaps it in, so a failed update
 *  never leaves a half-written widget behind. */
export async function installBundle(
  bundle: WidgetBundle,
  meta: { source: InstallSource; trust: TrustLevel; registryUrl: string | null },
): Promise<void> {
  const id = bundle.manifest.id;
  const target = installDir(id);
  const staging = `${target}.staging-${Date.now()}`;
  await mkdir(staging, { recursive: true });
  try {
    for (const [path, b64] of Object.entries(bundle.files)) {
      const rel = safeRelative(path);
      if (!rel) continue;
      const out = join(staging, rel);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, Buffer.from(b64, "base64"));
    }
    await writeFile(join(staging, "manifest.json"), JSON.stringify(bundle.manifest, null, 2));
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
  db.upsertInstalledWidget({ manifest: bundle.manifest, ...meta, devPath: null });
  db.flush();
}

/** Registers a developer's unpacked folder; its files are served live. */
export async function linkDevFolder(folder: string): Promise<WidgetManifest> {
  let manifest: WidgetManifest;
  try {
    manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8")) as WidgetManifest;
  } catch {
    throw new WidgetError("That folder has no readable manifest.json.");
  }
  const problems = validateManifest(manifest);
  if (problems.length) throw new WidgetError(`manifest.json has problems: ${problems.join("; ")}.`);
  if (!existsSync(join(folder, manifest.entry)))
    throw new WidgetError(`The entry file ${manifest.entry} isn't in that folder.`);
  db.upsertInstalledWidget({
    manifest,
    source: "dev",
    trust: "unverified",
    registryUrl: null,
    devPath: folder,
  });
  db.flush();
  return manifest;
}

export async function uninstallWidget(id: string): Promise<void> {
  const installed = db.getInstalledWidget(id);
  if (installed && installed.source !== "dev") {
    await rm(installDir(id), { recursive: true, force: true });
  }
  db.removeInstalledWidget(id);
  db.flush();
}

/** Resolves a request path to a file of an installed, enabled widget. */
export function resolveWidgetFile(id: string, path: string): string | null {
  const installed = db.getInstalledWidget(id);
  if (!installed || !installed.enabled) return null;
  const root = installed.source === "dev" && installed.devPath ? installed.devPath : installDir(id);
  const rel = safeRelative(decodeURIComponent(path) || installed.manifest.entry);
  if (!rel) return null;
  const full = join(root, rel);
  const back = relative(root, full);
  if (back.startsWith("..") || back.split(sep).includes("..")) return null;
  return full;
}
