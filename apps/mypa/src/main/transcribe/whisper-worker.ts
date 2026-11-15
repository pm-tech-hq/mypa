/**
 * Runs entirely in a Node `worker_thread` — model loading and ONNX inference
 * are CPU-heavy enough to measurably starve the event loop (verified: a
 * single 104s chunk cost ~15% of a 100ms ticker's ticks), and the main
 * process is also where every window/IPC/DB call lives, so doing this work
 * there makes the whole app feel like it's frozen while a job runs. Isolating
 * it here means transcription can never block anything the user is doing.
 */
import { parentPort } from "node:worker_threads";

import {
  AutoModel,
  AutoProcessor,
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type PreTrainedModel,
  type Processor,
  type Tensor,
} from "@huggingface/transformers";

import type { WhisperModelSize } from "../../shared/types";
import { clusterSpeakers, isSpeech, speechRegions, type Utterance } from "./segments";

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

/** Voice prints for telling speakers apart: small (~26 MB) and, in testing,
 *  far clearer between voices than WavLM. Full precision: quantizing blurs
 *  the prints. */
const SPEAKER_MODEL = "onnx-community/wespeaker-voxceleb-resnet34-LM";
let speakerModel: Promise<[Processor, PreTrainedModel]> | null = null;

function getSpeakerModel(): Promise<[Processor, PreTrainedModel]> {
  speakerModel ??= Promise.all([
    AutoProcessor.from_pretrained(SPEAKER_MODEL),
    AutoModel.from_pretrained(SPEAKER_MODEL, { dtype: "fp32" }),
  ]);
  return speakerModel;
}

async function voicePrint(clip: Float32Array): Promise<Float32Array> {
  const [processor, model] = await getSpeakerModel();
  const out = (await model(await processor(clip))) as Record<string, Tensor>;
  const first = out[Object.keys(out)[0]!]!;
  return new Float32Array(first.data as Float32Array);
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

/** A recorded meeting: your mic and the computer's sound, transcribed apart. */
export interface MeetingRequest {
  type: "meeting";
  jobId: string;
  cacheDir: string;
  me: Float32Array | null;
  them: Float32Array | null;
  modelSize: WhisperModelSize;
  /** Tell the other side's voices apart. */
  speakers: boolean;
}

export type WorkerResponse =
  | { type: "progress"; jobId: string; pct: number }
  | { type: "done"; jobId: string; text: string }
  | { type: "utterances"; jobId: string; utterances: Utterance[] }
  | { type: "error"; jobId: string; message: string };

function post(msg: WorkerResponse): void {
  parentPort!.postMessage(msg);
}

parentPort.on("message", (msg: TranscribeRequest | MeetingRequest) => {
  if (msg.type === "transcribe") void run(msg);
  else if (msg.type === "meeting") void runMeeting(msg);
});

function setCacheDir(cacheDir: string): void {
  if (cacheDirSet) return;
  env.cacheDir = cacheDir;
  cacheDirSet = true;
}

async function runMeeting(req: MeetingRequest): Promise<void> {
  const { jobId } = req;
  try {
    setCacheDir(req.cacheDir);
    const transcriber = await getTranscriber(req.modelSize);
    const tracks = [
      { track: "me" as const, audio: req.me },
      { track: "them" as const, audio: req.them },
    ].map((t) => ({ ...t, regions: t.audio ? speechRegions(t.audio) : [] }));
    const total = Math.max(1, tracks.reduce((n, t) => n + t.regions.length, 0));

    const utterances: Utterance[] = [];
    const prints: Float32Array[] = [];
    const theirs: Utterance[] = [];
    let done = 0;
    for (const { track, audio, regions } of tracks) {
      for (const r of regions) {
        const clip = audio!.subarray(r.start, r.end);
        const result = await transcriber(clip);
        const text = (Array.isArray(result) ? result.map((x) => x.text).join(" ") : result.text)
          .replace(/\s+/g, " ")
          .trim();
        if (isSpeech(text)) {
          const u: Utterance = {
            track,
            start: Math.round(r.start / 16),
            end: Math.round(r.end / 16),
            speaker: track === "me" ? "Me" : "Them",
            text,
          };
          utterances.push(u);
          if (track === "them" && req.speakers) {
            prints.push(await voicePrint(clip));
            theirs.push(u);
          }
        }
        done += 1;
        post({ type: "progress", jobId, pct: (done / total) * 100 });
      }
    }

    if (theirs.length > 0) {
      const labels = clusterSpeakers(
        prints,
        theirs.map((u) => u.end - u.start),
      );
      theirs.forEach((u, i) => (u.speaker = `Speaker ${labels[i]! + 1}`));
    }
    post({ type: "utterances", jobId, utterances });
  } catch (err) {
    post({ type: "error", jobId, message: err instanceof Error ? err.message : String(err) });
  }
}

async function run({ jobId, cacheDir, audio, modelSize }: TranscribeRequest): Promise<void> {
  try {
    setCacheDir(cacheDir);

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
