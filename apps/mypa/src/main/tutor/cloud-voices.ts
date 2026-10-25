/** Text-to-speech with cloud voice services, using the learner's own API key. */
import type { SpeakResult, VoiceService } from "../../shared/tutor";
import { getVoiceKey } from "./config";

/** Both services are asked for raw 16-bit mono PCM at this rate. */
const RATE = 24_000;
const NAME: Record<VoiceService, string> = { openai: "OpenAI", elevenlabs: "ElevenLabs" };

function keyFor(service: VoiceService): string {
  const key = getVoiceKey(service);
  if (!key) throw new Error(`Add your ${NAME[service]} API key in Tutor settings → Voice.`);
  return key;
}

async function failure(service: VoiceService, res: Response): Promise<Error> {
  const body = await res.text().catch(() => "");
  let detail = body.slice(0, 300);
  try {
    const j = JSON.parse(body) as {
      error?: { message?: string } | string;
      detail?: { message?: string } | string;
    };
    const d = j.error ?? j.detail;
    detail = (typeof d === "string" ? d : d?.message) ?? detail;
  } catch {
    /* not JSON */
  }
  if (res.status === 401 || res.status === 403) {
    return new Error(`${NAME[service]} rejected the API key${detail ? ` (${detail})` : ""}.`);
  }
  return new Error(`${NAME[service]} voice: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
}

function pcm16(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf);
  const out = new Float32Array(Math.floor(buf.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32_768;
  return out;
}

let elevenDefault: string | undefined;

export async function speakCloud(
  service: VoiceService,
  text: string,
  voice: string,
): Promise<SpeakResult> {
  const key = keyFor(service);
  let res: Response;
  if (service === "openai") {
    res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        input: text,
        voice: voice || "coral",
        instructions: "Speak like an engaging teacher giving a talk: warm, clear and natural.",
        response_format: "pcm",
      }),
    });
  } else {
    const id = voice || (elevenDefault ??= (await listCloudVoices("elevenlabs"))[0]?.id);
    if (!id) throw new Error("Your ElevenLabs account has no voices yet.");
    res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}?output_format=pcm_${RATE}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": key },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
      },
    );
  }
  if (!res.ok) throw await failure(service, res);
  return { samples: pcm16(await res.arrayBuffer()), sampleRate: RATE };
}

export async function listCloudVoices(
  service: VoiceService,
): Promise<{ id: string; label: string }[]> {
  if (service === "openai") return [];
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": keyFor(service) },
  });
  if (!res.ok) throw await failure(service, res);
  const j = (await res.json()) as {
    voices?: { voice_id: string; name: string; labels?: Record<string, string> }[];
  };
  return (j.voices ?? []).map((v) => {
    const about = [v.labels?.accent, v.labels?.gender].filter(Boolean).join(", ");
    return { id: v.voice_id, label: about ? `${v.name} (${about})` : v.name };
  });
}
