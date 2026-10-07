/**
 * Runs entirely in a Node `worker_thread` — model loading and ONNX inference
 * are CPU-heavy enough to measurably starve the event loop (verified: a
 * single 104s chunk cost ~15% of a 100ms ticker's ticks), and the main
 * process is also where every window/IPC/DB call lives, so doing this work
 * there makes the whole app feel like it's frozen while a job runs. Isolating
 * it here means transcription can never block anything the user is doing.
 */
import { parentPort } from "node:worker_threads";

import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

import type { WhisperModelSize } from "../../shared/types";

if (!parentPort) {
  throw new Error("whisper-worker.ts must be run as a worker_thread, not required directly");
}

const MODEL_BY_SIZE: Record<WhisperModelSize, string> = {
  tiny: "Xenova/whisper-tiny.en",
  base: "Xenova/whisper-base.en",
  small: "Xenova/whisper-small.en",
};

const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 30;
const CHUNK_SAMPLES = CHUNK_SECONDS * SAMPLE_RATE;

let cacheDirSet = false;
let cached: { size: WhisperModelSize; pipe: Promise<AutomaticSpeechRecognitionPipeline> } | null =
  null;

function getTranscriber(size: WhisperModelSize): Promise<AutomaticSpeechRecognitionPipeline> {
  if (cached && cached.size === size) return cached.pipe;
  const pipe = pipeline("automatic-speech-recognition", MODEL_BY_SIZE[size], {
    dtype: "q8",
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  cached = { size, pipe };
  return pipe;
}

export interface TranscribeRequest {
  type: "transcribe";
  jobId: string;
  /** `app.getPath("userData")`-derived — computed on the main thread since
   *  this worker has no Electron `app` module of its own. */
  cacheDir: string;
  audio: Float32Array;
  modelSize: WhisperModelSize;
}

export type WorkerResponse =
  | { type: "progress"; jobId: string; pct: number }
  | { type: "done"; jobId: string; text: string }
  | { type: "error"; jobId: string; message: string };

function post(msg: WorkerResponse): void {
  parentPort!.postMessage(msg);
}

parentPort.on("message", (msg: TranscribeRequest) => {
  if (msg.type !== "transcribe") return;
  void run(msg);
});

async function run({ jobId, cacheDir, audio, modelSize }: TranscribeRequest): Promise<void> {
  try {
    if (!cacheDirSet) {
      env.cacheDir = cacheDir;
      cacheDirSet = true;
    }

    const transcriber = await getTranscriber(modelSize);
    const totalChunks = Math.max(1, Math.ceil(audio.length / CHUNK_SAMPLES));
    const parts: string[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const chunk = audio.subarray(i * CHUNK_SAMPLES, Math.min((i + 1) * CHUNK_SAMPLES, audio.length));
      const result = await transcriber(chunk);
      const text = Array.isArray(result) ? result.map((r) => r.text).join(" ") : result.text;
      parts.push(text.trim());
      post({ type: "progress", jobId, pct: ((i + 1) / totalChunks) * 100 });
    }

    post({ type: "done", jobId, text: parts.join(" ").replace(/\s+/g, " ").trim() });
  } catch (err) {
    post({ type: "error", jobId, message: err instanceof Error ? err.message : String(err) });
  }
}
