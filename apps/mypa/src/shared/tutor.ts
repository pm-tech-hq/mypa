/** Tutor widget contract — AI providers, streaming chat and text-to-speech.
 *  Kept apart from api.ts: none of this touches the SQLite snapshot. */

export type ProviderType = "openai" | "anthropic";

export type LocalModelId = "qwen-0.5b" | "qwen-1.5b" | "phi-4-mini";

export const LOCAL_MODELS: { id: LocalModelId; label: string; note: string; repo: string }[] = [
  {
    id: "qwen-0.5b",
    label: "Qwen 2.5 · 0.5B",
    note: "Fastest, ~750 MB download. Fine for simple material.",
    repo: "onnx-community/Qwen2.5-0.5B-Instruct",
  },
  {
    id: "qwen-1.5b",
    label: "Qwen 2.5 · 1.5B",
    note: "Balanced, ~1.7 GB download. Recommended.",
    repo: "onnx-community/Qwen2.5-1.5B-Instruct",
  },
  {
    id: "phi-4-mini",
    label: "Phi-4 mini · 3.8B",
    note: "Smartest, ~2.7 GB download, slow on CPU.",
    repo: "onnx-community/Phi-4-mini-instruct-ONNX",
  },
];

/** A user-configured cloud / self-hosted provider. The API key never leaves the
 *  main process — the renderer only ever sees `hasKey`. */
export interface ProviderInfo {
  id: string;
  name: string;
  type: ProviderType;
  /** OpenAI-compatible: the API root (…/v1). Anthropic: leave blank for the default. */
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export interface SaveProviderInput {
  /** Omit to create. */
  id?: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  /** undefined = keep the stored key; "" = clear it. */
  apiKey?: string;
}

export interface TutorConfig {
  providers: ProviderInfo[];
  localModel: LocalModelId;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** "local" or a `ProviderInfo.id`. */
export type ChatTarget = string;

export interface ChatRequest {
  requestId: string;
  target: ChatTarget;
  messages: ChatMessage[];
}

export type ChatEvent =
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "status"; text: string }
  | { requestId: string; type: "done" }
  | { requestId: string; type: "error"; message: string };

export interface SpeakResult {
  samples: Float32Array;
  sampleRate: number;
}

export const KOKORO_VOICES: { id: string; label: string }[] = [
  { id: "af_heart", label: "Heart (US, female)" },
  { id: "af_bella", label: "Bella (US, female)" },
  { id: "am_michael", label: "Michael (US, male)" },
  { id: "bf_emma", label: "Emma (UK, female)" },
  { id: "bm_george", label: "George (UK, male)" },
];

export const TUTOR_IPC = {
  getConfig: "tutor:getConfig",
  saveProvider: "tutor:saveProvider",
  deleteProvider: "tutor:deleteProvider",
  setLocalModel: "tutor:setLocalModel",
  chat: "tutor:chat",
  cancel: "tutor:cancel",
  chatEvent: "tutor:chatEvent",
  speak: "tutor:speak",
  transcribeMic: "tutor:transcribeMic",
} as const;

export interface MypaTutor {
  getConfig: () => Promise<TutorConfig>;
  saveProvider: (input: SaveProviderInput) => Promise<TutorConfig>;
  deleteProvider: (id: string) => Promise<TutorConfig>;
  setLocalModel: (id: LocalModelId) => Promise<TutorConfig>;
  /** Starts a streamed reply; events arrive via `onChatEvent`. */
  chat: (req: ChatRequest) => Promise<void>;
  cancel: (requestId: string) => Promise<void>;
  onChatEvent: (cb: (e: ChatEvent) => void) => () => void;
  /** Neural text-to-speech (Kokoro) — synthesised on-device. */
  speak: (text: string, voice: string) => Promise<SpeakResult>;
  /** Speech-to-text for mic input: mono 16 kHz samples → text (local Whisper). */
  transcribeMic: (samples: Float32Array) => Promise<string>;
}
