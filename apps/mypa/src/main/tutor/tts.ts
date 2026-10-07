/** Main-thread handle to the Kokoro TTS worker. Requests run one at a time. */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { app } from "electron";

import type { SpeakResult } from "../../shared/tutor";
import type { TtsRequest, TtsResponse } from "./tts-worker";

let worker: Worker | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(path.join(__dirname, "tutor", "tts-worker.js"));
  w.on("exit", () => {
    if (worker === w) worker = null;
  });
  worker = w;
  return w;
}

let queue: Promise<unknown> = Promise.resolve();

export function speak(text: string, voice: string): Promise<SpeakResult> {
  const job = () =>
    new Promise<SpeakResult>((resolve, reject) => {
      const jobId = randomUUID();
      const w = getWorker();
      const onMessage = (msg: TtsResponse) => {
        if (msg.jobId !== jobId) return;
        cleanup();
        if (msg.type === "done") resolve({ samples: msg.samples, sampleRate: msg.sampleRate });
        else reject(new Error(msg.message));
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onExit = (code: number) => {
        cleanup();
        reject(new Error(`Voice worker exited (code ${code}).`));
      };
      function cleanup(): void {
        w.off("message", onMessage);
        w.off("error", onError);
        w.off("exit", onExit);
      }
      w.on("message", onMessage);
      w.on("error", onError);
      w.on("exit", onExit);
      const req: TtsRequest = {
        type: "speak",
        jobId,
        cacheDir: path.join(app.getPath("userData"), "models"),
        text,
        voice,
      };
      w.postMessage(req);
    });
  const result = queue.then(job, job);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
