#!/usr/bin/env node
/**
 * mypa-widget: the creator toolchain for myPA custom widgets.
 *
 *   mypa-widget init <dir> --id you.my-widget --name "My widget"
 *   mypa-widget validate <dir>
 *   mypa-widget pack <dir> [--out file.mypawidget]
 *   mypa-widget keygen --out keys/publisher
 *   mypa-widget registry --src widgets/ --out public/ --key keys/root.pem --name "My registry"
 *                        [--publishers publishers.json]
 *   mypa-widget license --key keys/publisher.pem --widget you.my-widget --to buyer@example.com
 *
 * Runs directly on Node 24+ (type stripping); no build step.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile, cp } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUNDLE_FORMAT,
  MAX_BUNDLE_BYTES,
  REGISTRY_FORMAT,
  canonicalJson,
  validateManifest,
  type RegistryEntry,
  type RegistryIndex,
  type RegistryPublisher,
  type SignedRegistry,
  type WidgetBundle,
  type WidgetManifest,
} from "../src/platform.ts";

const here = dirname(fileURLToPath(import.meta.url));

function die(message: string): never {
  console.error(`\u2716 ${message}`);
  process.exit(1);
}

function args(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[a.slice(2)] = "true";
      else {
        flags[a.slice(2)] = next;
        i++;
      }
    } else positional.push(a);
  }
  return { positional, flags };
}

async function readManifest(dir: string): Promise<WidgetManifest> {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) die(`No manifest.json in ${dir}`);
  let manifest: WidgetManifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8")) as WidgetManifest;
  } catch (err) {
    die(`manifest.json isn't valid JSON: ${(err as Error).message}`);
  }
  const problems = validateManifest(manifest);
  if (problems.length) die(`manifest.json has problems:\n  - ${problems.join("\n  - ")}`);
  if (!existsSync(join(dir, manifest.entry))) die(`Entry file ${manifest.entry} not found`);
  return manifest;
}

const SKIP = new Set(["manifest.json", "node_modules", ".git", ".DS_Store"]);

async function collectFiles(dir: string, root = dir, out: Record<string, string> = {}) {
  for (const name of await readdir(dir)) {
    if (SKIP.has(name) || name.startsWith(".") || name.endsWith(".mypawidget")) continue;
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) await collectFiles(full, root, out);
    else out[relative(root, full).split("\\").join("/")] = (await readFile(full)).toString("base64");
  }
  return out;
}

async function packDir(dir: string): Promise<{ bundle: WidgetBundle; json: string }> {
  const manifest = await readManifest(dir);
  const bundle: WidgetBundle = { format: BUNDLE_FORMAT, manifest, files: await collectFiles(dir) };
  const json = JSON.stringify(bundle);
  if (Buffer.byteLength(json) > MAX_BUNDLE_BYTES) die(`${manifest.id} is over the 8 MB limit`);
  return { bundle, json };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function loadPrivateKey(path: string | undefined) {
  if (!path) die("--key <private.pem> is required");
  if (!existsSync(path)) die(`Key not found: ${path}`);
  return createPrivateKey(await readFile(path, "utf8"));
}

/* -------------------------------------------------------------- commands -- */

async function init(dir: string | undefined, flags: Record<string, string>) {
  if (!dir) die("Usage: mypa-widget init <dir> --id publisher.widget --name \"Name\"");
  const target = resolve(dir);
  if (existsSync(target) && (await readdir(target)).length) die(`${dir} isn't empty`);
  const id = flags.id ?? `me.${basename(target).toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
  const name = flags.name ?? basename(target);
  await cp(join(here, "../template"), target, { recursive: true });
  const manifestPath = join(target, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as WidgetManifest;
  manifest.id = id;
  manifest.name = name;
  manifest.publisher = { id: id.split(".")[0]!, name: flags.publisher ?? id.split(".")[0]! };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\u2714 Created ${name} in ${dir}

Next:
  1. In myPA, open Marketplace \u2192 Developer \u2192 Load unpacked folder, and pick ${dir}.
     It reloads every time you save.
  2. When it's ready: mypa-widget pack ${dir}`);
}

async function validate(dir: string | undefined) {
  if (!dir) die("Usage: mypa-widget validate <dir>");
  const m = await readManifest(resolve(dir));
  console.log(`\u2714 ${m.name} ${m.version} (${m.id}) is valid`);
}

async function pack(dir: string | undefined, flags: Record<string, string>) {
  if (!dir) die("Usage: mypa-widget pack <dir> [--out file]");
  const { bundle, json } = await packDir(resolve(dir));
  const out = flags.out ?? `${bundle.manifest.id}-${bundle.manifest.version}.mypawidget`;
  await writeFile(out, json);
  console.log(`\u2714 Packed ${out} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB, sha256 ${sha256(json)})`);
}

async function keygen(flags: Record<string, string>) {
  const out = flags.out ?? "publisher";
  if (existsSync(`${out}.pem`)) die(`${out}.pem already exists; refusing to overwrite a key`);
  await mkdir(dirname(resolve(out)), { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  await writeFile(`${out}.pem`, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  await writeFile(`${out}.pub.pem`, publicKey.export({ type: "spki", format: "pem" }));
  console.log(`\u2714 Wrote ${out}.pem (keep secret, back it up) and ${out}.pub.pem`);
}

interface PublisherFile {
  [id: string]: Omit<RegistryPublisher, "licenseKey"> & { licenseKeyFile?: string };
}

async function registry(flags: Record<string, string>) {
  const src = flags.src ? resolve(flags.src) : die("--src <folder of widget folders> is required");
  const out = flags.out ? resolve(flags.out) : die("--out <folder> is required");
  const key = await loadPrivateKey(flags.key);
  const publisherFile: PublisherFile = flags.publishers
    ? (JSON.parse(await readFile(flags.publishers, "utf8")) as PublisherFile)
    : {};

  await mkdir(join(out, "bundles"), { recursive: true });
  const widgets: RegistryEntry[] = [];
  const publishers: Record<string, RegistryPublisher> = {};
  for (const name of (await readdir(src)).sort()) {
    const dir = join(src, name);
    if (!(await stat(dir)).isDirectory() || !existsSync(join(dir, "manifest.json"))) continue;
    const { bundle, json } = await packDir(dir);
    const m = bundle.manifest;
    const file = `${m.id}-${m.version}.mypawidget`;
    await writeFile(join(out, "bundles", file), json);
    const meta = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as { featured?: boolean };
    widgets.push({
      manifest: m,
      bundleUrl: `bundles/${file}`,
      sha256: sha256(json),
      bytes: Buffer.byteLength(json),
      updatedAt: new Date().toISOString(),
      ...(meta.featured ? { featured: true } : {}),
    });
    if (!publishers[m.publisher.id]) {
      const declared = publisherFile[m.publisher.id];
      let licenseKey: string | undefined;
      if (declared?.licenseKeyFile) {
        licenseKey = createPublicKey(
          await readFile(resolve(dirname(flags.publishers!), declared.licenseKeyFile), "utf8"),
        )
          .export({ type: "spki", format: "pem" })
          .toString();
      }
      publishers[m.publisher.id] = {
        name: declared?.name ?? m.publisher.name,
        verified: Boolean(declared?.verified),
        ...(declared?.official ? { official: true } : {}),
        ...(declared?.url ? { url: declared.url } : {}),
        ...(licenseKey ? { licenseKey } : {}),
      };
    }
    if (m.price && !publishers[m.publisher.id]!.licenseKey)
      console.warn(`! ${m.id} is paid but its publisher has no licenseKeyFile; licenses can't be verified`);
    console.log(`  + ${m.id} ${m.version}`);
  }

  const index: RegistryIndex = {
    format: REGISTRY_FORMAT,
    name: flags.name ?? "Widget registry",
    generatedAt: new Date().toISOString(),
    publishers,
    widgets,
  };
  const signed: SignedRegistry = {
    index,
    signature: sign(null, Buffer.from(canonicalJson(index)), key).toString("base64"),
    publicKey: createPublicKey(key).export({ type: "spki", format: "pem" }).toString(),
  };
  await writeFile(join(out, "registry.json"), `${JSON.stringify(signed, null, 2)}\n`);
  console.log(`\u2714 Signed ${widgets.length} widget(s) into ${join(out, "registry.json")}`);
}

async function license(flags: Record<string, string>) {
  const key = await loadPrivateKey(flags.key);
  if (!flags.widget || !flags.to) die("--widget <id> and --to <licensee> are required");
  const payload = JSON.stringify({
    widgetId: flags.widget,
    licensee: flags.to,
    issuedAt: new Date().toISOString(),
  });
  const sig = sign(null, Buffer.from(payload), key);
  console.log(`${b64url(Buffer.from(payload))}.${b64url(sig)}`);
}

const { positional, flags } = args(process.argv.slice(2));
const [command, target] = positional;
const commands: Record<string, () => Promise<void>> = {
  init: () => init(target, flags),
  validate: () => validate(target),
  pack: () => pack(target, flags),
  keygen: () => keygen(flags),
  registry: () => registry(flags),
  license: () => license(flags),
};
const run = command ? commands[command] : undefined;
if (!run) {
  console.log(`mypa-widget <command>

  init <dir> --id you.name --name "Name"   start a widget from the template
  validate <dir>                          check manifest.json
  pack <dir> [--out file]                 bundle into a .mypawidget file
  keygen --out keys/name                  make an ed25519 signing key pair
  registry --src dir --out dir --key pem  pack every widget folder and sign a registry
           [--name "Name"] [--publishers publishers.json]
  license --key pem --widget id --to who  issue a license key for a paid widget`);
  process.exit(command ? 1 : 0);
}
await run();
