/**
 * Main-thread-side handle to the Whisper worker_thread — same public API
 * (`transcribeAudio`) as when this ran inline, so `run.ts` didn't need to
 * change. See `whisper-worker.ts` for why this is a worker in the first
 * place (it measurably starves the main process's event loop otherwise).
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { app } from "electron";

import type { WhisperModelSize } from "../../shared/types";
import type { Utterance } from "./segments";
import type { MeetingRequest, TranscribeRequest, WorkerResponse } from "./whisper-worker";

function workerPath(): string {
  // Compiled sibling of this file — see electron.vite.config.ts's extra
  // `main` rollup entry ("transcribe/whisper-worker"). Same relative layout
  // whether running unpacked (dev) or from inside app.asar (packaged): a
  // worker_thread loads its script like any other JS file, no asar unpacking
  // needed (that's only required for native addons / spawned binaries).
  return path.join(__dirname, "transcribe", "whisper-worker.js");
}

let worker: Worker | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(workerPath());
  w.on("exit", () => {
    if (worker === w) worker = null;
  });
  worker = w;
  return w;
}

// Only one job in flight at a time — ONNX inference is the bottleneck either
// way, and this keeps behavior identical to before the worker split.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function transcribeAudio(
  audio: Float32Array,
  modelSize: WhisperModelSize,
  onProgress: (pct: number) => void,
): Promise<string> {
  return runJob(
    (jobId) => ({
      type: "transcribe",
      jobId,
      cacheDir: cacheDir(),
      audio,
      modelSize,
    }),
    // Transfer the underlying buffer — the main thread doesn't need this
    // copy of the audio again, so hand it over zero-copy. Always a real
    // ArrayBuffer here (constructed straight from a Node Buffer in
    // ffmpeg.ts), never a SharedArrayBuffer.
    [audio.buffer as ArrayBuffer],
    onProgress,
    (msg) => (msg.type === "done" ? msg.text : undefined),
  );
}

/** A meeting's two tracks, transcribed separately and labelled by speaker. */
export function transcribeMeeting(
  tracks: { me: Float32Array | null; them: Float32Array | null },
  modelSize: WhisperModelSize,
  speakers: boolean,
  onProgress: (pct: number) => void,
): Promise<Utterance[]> {
  // A short track can sit in Node's shared Buffer pool; transferring that
  // would detach the pool, so such a track goes over as its own copy.
  const own = (a: Float32Array | null) =>
    a && (a.byteOffset !== 0 || a.byteLength !== a.buffer.byteLength) ? a.slice() : a;
  const me = own(tracks.me);
  const them = own(tracks.them);
  return runJob(
    (jobId) => ({
      type: "meeting",
      jobId,
      cacheDir: cacheDir(),
      me,
      them,
      modelSize,
      speakers,
    }),
    [me, them].flatMap((a) => (a ? [a.buffer as ArrayBuffer] : [])),
    onProgress,
    (msg) => (msg.type === "utterances" ? msg.utterances : undefined),
  );
}

function cacheDir(): string {
  return path.join(app.getPath("userData"), "models");
}

function runJob<T>(
  request: (jobId: string) => TranscribeRequest | MeetingRequest,
  transfer: ArrayBuffer[],
  onProgress: (pct: number) => void,
  result: (msg: WorkerResponse) => T | undefined,
): Promise<T> {
  return enqueue(
    () =>
      new Promise<T>((resolve, reject) => {
        const jobId = randomUUID();
        const w = getWorker();

        const onMessage = (msg: WorkerResponse) => {
          if (msg.jobId !== jobId) return;
          if (msg.type === "progress") {
            onProgress(msg.pct);
          } else if (msg.type === "error") {
            cleanup();
            reject(new Error(msg.message));
          } else {
            const value = result(msg);
            if (value === undefined) return;
            cleanup();
            resolve(value);
          }
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const onExit = (code: number) => {
          cleanup();
          reject(new Error(`Transcription worker exited unexpectedly (code ${code}).`));
        };

        function cleanup(): void {
          w.off("message", onMessage);
          w.off("error", onError);
          w.off("exit", onExit);
        }

        w.on("message", onMessage);
        w.on("error", onError);
        w.on("exit", onExit);

        w.postMessage(request(jobId), transfer);
      }),
  );
}
