/** Main-thread handle to the on-device LLM worker. */
import path from "node:path";
import { Worker } from "node:worker_threads";

import { app } from "electron";

import { LOCAL_MODELS, type ChatMessage, type LocalModelId } from "../../shared/tutor";
import type { LocalRequest, LocalResponse } from "./local-worker";

let worker: Worker | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(path.join(__dirname, "tutor", "local-worker.js"));
  w.on("exit", () => {
    if (worker === w) worker = null;
  });
  worker = w;
  return w;
}

export function streamLocal(
  jobId: string,
  model: LocalModelId,
  messages: ChatMessage[],
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onStatus: (text: string) => void,
): Promise<void> {
  const repo = LOCAL_MODELS.find((m) => m.id === model)?.repo ?? LOCAL_MODELS[1]!.repo;
  return new Promise<void>((resolve, reject) => {
    const w = getWorker();
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
