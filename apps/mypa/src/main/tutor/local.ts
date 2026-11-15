/** Main-thread handle to the on-device LLM worker. */
import path from "node:path";
import { Worker } from "node:worker_threads";

import { app } from "electron";

import { LOCAL_MODELS, type ChatMessage, type LocalModelId } from "../../shared/tutor";
import type { LocalRequest, LocalResponse } from "./local-worker";
import { isDownloading } from "./modelSetup";

/**
 * Each generation leaves roughly half a gigabyte behind in the worker
 * (transformers.js), and once its heap nears Electron's ~4 GB cap, garbage
 * collection pins a core and the worker stops answering. So a worker serves a
 * few jobs and is replaced, and is let go when idle; reloading the cached
 * model takes about ten seconds.
 */
const JOBS_PER_WORKER = 3;
const IDLE_MS = 3 * 60_000;

let worker: Worker | null = null;
let active = 0;
let served = 0;
let idleTimer: NodeJS.Timeout | undefined;

function getWorker(): Worker {
  clearTimeout(idleTimer);
  if (worker) return worker;
  const w = new Worker(path.join(__dirname, "tutor", "local-worker.js"));
  w.on("exit", () => {
    if (worker === w) worker = null;
  });
  worker = w;
  served = 0;
  return w;
}

function release(): void {
  if (!worker || active > 0) return;
  void worker.terminate();
  worker = null;
}

function jobFinished(heavy: boolean): void {
  active -= 1;
  served += heavy ? JOBS_PER_WORKER : 1;
  if (active > 0) return;
  if (served >= JOBS_PER_WORKER) release();
  else idleTimer = setTimeout(release, IDLE_MS);
}

/**
 * `heavy`: a long prompt (a meeting transcript) leaves far more behind than
 * a chat turn — measured at several GB, enough that the next job on the same
 * worker never finishes. So a heavy job gets a worker of its own, which is
 * let go as soon as it's done.
 */
export function streamLocal(
  jobId: string,
  model: LocalModelId,
  messages: ChatMessage[],
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onStatus: (text: string) => void,
  heavy = false,
): Promise<void> {
  const repo = LOCAL_MODELS.find((m) => m.id === model)?.repo ?? LOCAL_MODELS[1]!.repo;
  if (isDownloading(model)) {
    // the Assistant's setup is writing these files; two writers would corrupt them
    return Promise.reject(
      new Error("The built-in model is still downloading. Try again once it has finished."),
    );
  }
  if (heavy && served > 0) release();
  return new Promise<void>((resolve, reject) => {
    const w = getWorker();
    active += 1;
    const onMessage = (msg: LocalResponse) => {
      if (msg.jobId !== jobId) return;
      if (msg.type === "delta") onDelta(msg.text);
      else if (msg.type === "status") onStatus(msg.text);
      else if (msg.type === "done") finish(resolve);
      else finish(() => reject(new Error(msg.message)));
    };
    const onError = (err: Error) => finish(() => reject(err));
    const onExit = (code: number) =>
      finish(() => reject(new Error(`Local model worker exited (code ${code}).`)));
    const onAbort = () => {
      const cancel: LocalRequest = { type: "cancel", jobId };
      w.postMessage(cancel);
      // don't make the UI wait for a download / generation step to notice
      finish(resolve);
    };
    function finish(settle: () => void): void {
      w.off("message", onMessage);
      w.off("error", onError);
      w.off("exit", onExit);
      signal.removeEventListener("abort", onAbort);
      jobFinished(heavy);
      settle();
    }
    w.on("message", onMessage);
    w.on("error", onError);
    w.on("exit", onExit);
    signal.addEventListener("abort", onAbort);

    const req: LocalRequest = {
      type: "generate",
      jobId,
      cacheDir: path.join(app.getPath("userData"), "models"),
      repo,
      messages,
    };
    w.postMessage(req);
  });
}
