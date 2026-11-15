/**
 * The built-in model's one-time download, started on purpose from the
 * Assistant's setup card rather than as a side effect of the first message.
 *
 * Pausing stops between chunks and keeps the `.part` files (download.ts
 * resumes from them); cancelling also deletes them. Files land exactly where
 * transformers.js looks, so the worker loads them without fetching again.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { app, BrowserWindow } from "electron";

import { ASSISTANT_IPC, type LocalModelStatus } from "../../shared/assistant";
import { LOCAL_MODELS, type LocalModelId } from "../../shared/tutor";
import { download, friendlyDownloadError, listRepoFiles, probe, type RemoteFile } from "./download";

const repoOf = (model: LocalModelId): string =>
  LOCAL_MODELS.find((m) => m.id === model)?.repo ?? LOCAL_MODELS[1]!.repo;

const cacheDir = (): string => path.join(app.getPath("userData"), "models");
const repoDir = (model: LocalModelId): string => path.join(cacheDir(), repoOf(model));

/** The weights plus the small root files (config, tokenizer) the pipeline reads. */
const wanted = (name: string): boolean =>
  name.startsWith("onnx/model_q4.onnx") || (!name.includes("/") && name.endsWith(".json"));

interface Job {
  model: LocalModelId;
  stop: boolean;
  done: number;
  total: number;
  promise: Promise<void>;
}

let job: Job | null = null;
/** Last failure per model, cleared on the next attempt. */
const errors = new Map<LocalModelId, string>();
/** The full download size, remembered beside the files so a paused
 *  download still shows "x of y MB" after a restart. */
const TOTAL_FILE = ".mypa-download-size";

function savedTotal(model: LocalModelId): number {
  try {
    return Number(readFileSync(path.join(repoDir(model), TOTAL_FILE), "utf8")) || 0;
  } catch {
    return 0;
  }
}

function saveTotal(model: LocalModelId, total: number): void {
  try {
    mkdirSync(repoDir(model), { recursive: true });
    writeFileSync(path.join(repoDir(model), TOTAL_FILE), String(total));
  } catch {
    /* only cosmetic */
  }
}

function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/** Bytes on disk for this model, finished files and partial ones alike. */
function bytesOnDisk(dir: string): { bytes: number; partial: boolean } {
  let bytes = 0;
  let partial = false;
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        bytes += sizeOf(p);
        if (e.name.endsWith(".part")) partial = true;
      }
    }
  };
  walk(dir);
  return { bytes, partial };
}

/** Ready when the weights and the tokenizer are on disk with nothing half-written. */
export function isModelReady(model: LocalModelId): boolean {
  const dir = repoDir(model);
  const weights = path.join(dir, "onnx", "model_q4.onnx");
  if (!existsSync(weights) || !existsSync(path.join(dir, "tokenizer.json"))) return false;
  if (!existsSync(path.join(dir, "config.json"))) return false;
  return !bytesOnDisk(path.join(dir, "onnx")).partial;
}

/** True while the setup card is fetching this model (the worker must not write the same files). */
export function isDownloading(model: LocalModelId): boolean {
  return job?.model === model;
}

export function modelStatus(model: LocalModelId): LocalModelStatus {
  if (job?.model === model) {
    return { model, state: job.stop ? "pausing" : "downloading", done: job.done, total: job.total };
  }
  if (isModelReady(model)) {
    const { bytes } = bytesOnDisk(repoDir(model));
    return { model, state: "ready", done: bytes, total: bytes };
  }
  const error = errors.get(model);
  const { bytes } = bytesOnDisk(repoDir(model));
  const total = savedTotal(model);
  if (error) return { model, state: "error", done: bytes, total, error };
  return { model, state: bytes > 0 ? "paused" : "missing", done: bytes, total };
}

let lastSent = 0;
function broadcast(model: LocalModelId, force = false): void {
  const now = Date.now();
  if (!force && now - lastSent < 200) return;
  lastSent = now;
  const status = modelStatus(model);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(ASSISTANT_IPC.modelEvent, status);
  }
}

async function run(j: Job): Promise<void> {
  const repo = repoOf(j.model);
  const names = (await listRepoFiles(repo, "")).filter(wanted);
  const files: RemoteFile[] = await Promise.all(
    names.map((n) =>
      probe(`https://huggingface.co/${repo}/resolve/main/${n}`, path.join(cacheDir(), repo, n)),
    ),
  );
  j.total = files.reduce((n, f) => n + f.total, 0);
  saveTotal(j.model, j.total);
  broadcast(j.model, true);
  // Big files last: the small ones finish at once and the bar then tracks the weights.
  files.sort((a, b) => a.total - b.total);
  // download() re-reports what's already on disk, so count from zero again
  j.done = 0;
  for (const f of files) {
    if (j.stop) return;
    await download(
      f,
      (n) => {
        j.done += n;
        broadcast(j.model);
      },
      () => j.stop,
    );
  }
}

/** Starts or resumes the download. Resolves once it has begun. */
export async function startDownload(model: LocalModelId): Promise<void> {
  if (job?.model === model && !job.stop) return;
  // a pause still finishing its last chunk (or another model) — let it settle first
  if (job) {
    job.stop = true;
    await job.promise.catch(() => undefined);
  }
  errors.delete(model);
  const j: Job = {
    model,
    stop: false,
    // until the file sizes are known, show what's already on disk rather than 0
    done: bytesOnDisk(repoDir(model)).bytes,
    total: savedTotal(model),
    promise: Promise.resolve(),
  };
  job = j;
  j.promise = run(j)
    .catch((err: unknown) => {
      if (!j.stop) errors.set(model, friendlyDownloadError(err));
    })
    .finally(() => {
      if (job === j) job = null;
      broadcast(model, true);
    });
  broadcast(model, true);
}

/** Stops after the chunk in flight; what's downloaded is kept for Resume. */
export function pauseDownload(): void {
  if (!job) return;
  job.stop = true;
  broadcast(job.model, true);
}

/** Stops and deletes everything downloaded for this model so far. Keeps a finished model. */
export async function cancelDownload(model: LocalModelId): Promise<void> {
  if (job?.model === model) {
    job.stop = true;
    await job.promise.catch(() => undefined);
  }
  errors.delete(model);
  if (!isModelReady(model)) rmSync(repoDir(model), { recursive: true, force: true });
  broadcast(model, true);
}
