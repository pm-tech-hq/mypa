/** Neural text-to-speech (Kokoro-82M) in its own worker_thread. */
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";

import { KokoroTTS } from "kokoro-js";

import { friendlyDownloadError, withRetry } from "./download";

if (!parentPort) {
  throw new Error("tts-worker.ts must be run as a worker_thread, not required directly");
}

export type TtsRequest = {
  type: "speak";
  jobId: string;
  cacheDir: string;
  text: string;
  voice: string;
};

export type TtsResponse =
  | { type: "done"; jobId: string; samples: Float32Array; sampleRate: number }
  | { type: "error"; jobId: string; message: string };

type Voice = NonNullable<NonNullable<Parameters<KokoroTTS["generate"]>[1]>["voice"]>;

const port = parentPort;
let tts: Promise<KokoroTTS> | null = null;

let cacheDirSet = false;

/** kokoro-js bundles its own transformers.js (v3), separate from the app's.
 *  Reach that exact copy so the model is cached under userData — its default
 *  is inside node_modules, which is read-only once packaged. */
function setCacheDir(cacheDir: string): void {
  if (cacheDirSet) return;
  const fromKokoro = createRequire(require.resolve("kokoro-js"));
  const hf = fromKokoro("@huggingface/transformers") as { env: { cacheDir: string } };
  hf.env.cacheDir = cacheDir;
  cacheDirSet = true;
}

function load(cacheDir: string): Promise<KokoroTTS> {
  setCacheDir(cacheDir);
  tts ??= withRetry(
    () =>
      KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8",
        device: "cpu",
      }),
    4,
  );
  tts.catch(() => {
    tts = null;
  });
  return tts;
}

port.on("message", (msg: TtsRequest) => {
  void (async () => {
    try {
      const engine = await load(msg.cacheDir);
      const audio = await engine.generate(msg.text, { voice: msg.voice as Voice });
      const res: TtsResponse = {
        type: "done",
        jobId: msg.jobId,
        samples: audio.audio,
        sampleRate: audio.sampling_rate,
      };
      port.postMessage(res);
    } catch (err) {
      const res: TtsResponse = {
        type: "error",
        jobId: msg.jobId,
        message: friendlyDownloadError(err),
      };
      port.postMessage(res);
    }
  })();
});
