/** On-device LLM (transformers.js, ONNX) in its own worker_thread — same
 *  reasoning as whisper-worker.ts: inference must never block the main process. */
import path from "node:path";
import { parentPort } from "node:worker_threads";

import {
  env,
  InterruptableStoppingCriteria,
  pipeline,
  TextStreamer,
} from "@huggingface/transformers";

import type { ChatMessage } from "../../shared/tutor";
import { download, friendlyDownloadError, listRepoFiles, probe, withRetry } from "./download";

if (!parentPort) {
  throw new Error("local-worker.ts must be run as a worker_thread, not required directly");
}

export type LocalRequest =
  | { type: "generate"; jobId: string; cacheDir: string; repo: string; messages: ChatMessage[] }
  | { type: "cancel"; jobId: string };

export type LocalResponse =
  | { type: "status"; jobId: string; text: string }
  | { type: "delta"; jobId: string; text: string }
  | { type: "done"; jobId: string }
  | { type: "error"; jobId: string; message: string };

interface Generator {
  (messages: ChatMessage[], opts: Record<string, unknown>): Promise<unknown>;
  tokenizer: unknown;
}

const port = parentPort;
const post = (m: LocalResponse): void => port.postMessage(m);

let loaded: { repo: string; gen: Promise<Generator> } | null = null;
const stops = new Map<string, InterruptableStoppingCriteria>();
const cancelled = new Set<string>();

port.on("message", (msg: LocalRequest) => {
  if (msg.type === "cancel") {
    cancelled.add(msg.jobId);
    stops.get(msg.jobId)?.interrupt();
  }
  else void generate(msg);
});

/** Fetches the big model files with resume + retries (see download.ts). */
async function prefetch(repo: string, cacheDir: string, jobId: string): Promise<void> {
  const names = await listRepoFiles(repo, "onnx/model_q4.onnx");
  const files = await Promise.all(
    names.map((n) =>
      probe(`https://huggingface.co/${repo}/resolve/main/${n}`, path.join(cacheDir, repo, n)),
    ),
  );
  const total = files.reduce((n, f) => n + f.total, 0);
  const mb = (b: number) => Math.round(b / 1_048_576);
  let done = 0;
  let lastPct = -1;
  for (const f of files) {
    await download(
      f,
      (n) => {
        done += n;
        const pct = Math.floor((done / total) * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          post({
            type: "status",
            jobId,
            text: `Downloading model… ${pct}% (${mb(done)} of ${mb(total)} MB)`,
          });
        }
      },
      () => cancelled.has(jobId),
    );
  }
}

function getGenerator(repo: string, cacheDir: string, jobId: string): Promise<Generator> {
  if (loaded?.repo === repo) return loaded.gen;
  const files = new Map<string, { loaded: number; total: number }>();
  let lastPct = -1;
  const gen = prefetch(repo, cacheDir, jobId).then(() => withRetry(() => pipeline("text-generation", repo, {
    dtype: "q4",
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      const pct = Math.floor((loaded / total) * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        post({ type: "status", jobId, text: `Loading model… ${pct}%` });
      }
    },
  }), 3)) as unknown as Promise<Generator>;
  loaded = { repo, gen };
  gen.catch(() => {
    if (loaded?.gen === gen) loaded = null;
  });
  return gen;
}

async function generate({
  jobId,
  cacheDir,
  repo,
  messages,
}: Extract<LocalRequest, { type: "generate" }>): Promise<void> {
  const stop = new InterruptableStoppingCriteria();
  stops.set(jobId, stop);
  try {
    env.cacheDir = cacheDir;
    post({ type: "status", jobId, text: "Loading model…" });
    const gen = await getGenerator(repo, cacheDir, jobId);
    post({ type: "status", jobId, text: "" });

    const streamer = new TextStreamer(gen.tokenizer as never, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => post({ type: "delta", jobId, text }),
    });
    await gen(messages, {
      max_new_tokens: 1024,
      do_sample: true,
      temperature: 0.6,
      top_p: 0.9,
      repetition_penalty: 1.05,
      streamer,
      stopping_criteria: stop,
    });
    post({ type: "done", jobId });
  } catch (err) {
    if (cancelled.has(jobId)) post({ type: "done", jobId });
    else post({ type: "error", jobId, message: friendlyDownloadError(err) });
  } finally {
    stops.delete(jobId);
    cancelled.delete(jobId);
  }
}
