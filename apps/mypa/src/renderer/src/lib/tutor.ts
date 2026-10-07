/** Tutor widget helpers — prompt building, source retrieval, speech. */
import type { ChatMessage } from "../../../shared/tutor";
import type { TranscriptRow } from "../../../shared/types";

export type Level = "beginner" | "intermediate" | "advanced";
export type Mode = "ask" | "explain" | "apply" | "takeaways" | "quiz" | "topics";
export type Engine = "system" | "neural";

export const LEVEL_LABEL: Record<Level, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export const MODE_LABEL: Record<Exclude<Mode, "ask">, string> = {
  explain: "Explain",
  apply: "How to apply",
  takeaways: "Key takeaways",
  quiz: "Quiz me",
  topics: "Find topics",
};

/** Characters of source material sent along with each question. */
export const LOCAL_BUDGET = 6_000;
export const CLOUD_BUDGET = 60_000;

const LEVEL_HINT: Record<Level, string> = {
  beginner: "The learner is a complete beginner: no jargon without a plain-words definition, lots of everyday analogies.",
  intermediate: "The learner knows the basics: skip the obvious, explain the why behind things.",
  advanced: "The learner is experienced: be concise and precise, focus on nuance and trade-offs.",
};

export function systemPrompt(level: Level): string {
  return [
    "You are a patient, friendly tutor. The learner saved material from the internet (video, PDF, article, post, course, song) and it was converted to text for you below.",
    "Teach from that material in plain, easy-to-understand language: short paragraphs, concrete examples, analogies, and practical ways to apply it.",
    "Stay faithful to the material. If it does not cover something, say so; if you add outside knowledge, label it clearly. Never invent quotes.",
    LEVEL_HINT[level],
    "Your answer may be read aloud, so avoid tables, LaTeX and math markup (write formulas in plain words) and keep formatting light: short headings and simple bullet lists only.",
  ].join("\n");
}

export function modePrompt(mode: Mode, topic: string): string {
  const about = topic ? `"${topic}"` : "the main ideas in the material";
  switch (mode) {
    case "explain":
      return `Explain ${about} step by step in simple terms, as if teaching someone new to it. Include one analogy or example.`;
    case "apply":
      return `Show me how to apply ${about} in real life: concrete steps I can take, a worked example, and common mistakes to avoid.`;
    case "takeaways":
      return `Give me the key takeaways of ${about}: a two-sentence summary, then 5-8 bullet points.`;
    case "quiz":
      return `Quiz me on ${about}. Ask me ONE question first and wait for my answer. After I answer, tell me what I got right and wrong, then ask the next question.`;
    case "topics":
      return "List the main topics covered in the material as a numbered list, each with a one-line description, so I can pick one to learn.";
    default:
      return topic;
  }
}

/* ------------------------------------------------------- source context -- */

const CHUNK = 1_200;

function words(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
}

/**
 * Builds the MATERIAL block. Small enough → everything. Otherwise keeps the
 * chunks that best match the question (or an even sample when there's no
 * question), in their original order.
 */
export function buildMaterial(sources: TranscriptRow[], query: string, budget: number): string {
  const total = sources.reduce((n, t) => n + t.text.length, 0);
  if (total <= budget) {
    return sources.map((t) => `### ${t.title}\n${t.text}`).join("\n\n");
  }

  const chunks: { src: number; idx: number; text: string; score: number }[] = [];
  const q = new Set(words(query));
  sources.forEach((t, src) => {
    for (let i = 0, n = 0; i < t.text.length; i += CHUNK, n++) {
      const text = t.text.slice(i, i + CHUNK);
      const score = q.size ? words(text).filter((w) => q.has(w)).length : 0;
      chunks.push({ src, idx: n, text, score });
    }
  });

  const ranked = q.size
    ? [...chunks].sort((a, b) => b.score - a.score || a.idx - b.idx)
    : // no question: an even sample so every source is represented
      [...chunks].sort((a, b) => (a.idx % 3) - (b.idx % 3) || a.idx - b.idx);

  const picked = new Set<(typeof chunks)[number]>();
  let used = 0;
  for (const c of ranked) {
    if (used + c.text.length > budget) continue;
    picked.add(c);
    used += c.text.length;
  }

  return sources
    .map((t, src) => {
      const parts = chunks.filter((c) => c.src === src && picked.has(c)).map((c) => c.text);
      return parts.length ? `### ${t.title}\n${parts.join(" […] ")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function buildMessages(
  history: { role: "user" | "assistant"; content: string }[],
  material: string,
  level: Level,
  historyLimit: number,
): ChatMessage[] {
  const system = material
    ? `${systemPrompt(level)}\n\nMATERIAL:\n${material}`
    : `${systemPrompt(level)}\n\n(No material is selected yet — answer from general knowledge and say so.)`;
  return [{ role: "system", content: system }, ...history.slice(-historyLimit)];
}

/* ---------------------------------------------------------------- save -- */

/** Bullet / numbered lines of an answer, cleaned up for use as to-do items. */
export function extractItems(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    const item = stripMarkdown(m[1]!);
    if (item.length >= 3) items.push(item.length > 200 ? `${item.slice(0, 197)}…` : item);
  }
  return items;
}

/** A short default title for a saved task: the topic asked about. */
export function titleFor(question: string): string {
  const q = question.replace(/^[^:]{2,20}:\s*/, "").replace(/\s+/g, " ").trim();
  const t = q.length > 70 ? `${q.slice(0, 67)}…` : q;
  return t ? `Learn: ${t}` : "Follow up on what I learned";
}

/* --------------------------------------------------------------- speech -- */

export function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/[*_]{1,2}([^*_\n]+)[*_]{1,2}/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits into speakable pieces (~300 chars max) so speech starts quickly. */
export function splitSentences(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > 300) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export interface SpeakOptions {
  engine: Engine;
  /** System: a SpeechSynthesisVoice.voiceURI; neural: a Kokoro voice id. */
  voice: string;
}

/** One speaker per widget: starting anything new stops whatever was playing. */
export class Speaker {
  private token = 0;
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  stop(): void {
    this.token++;
    window.speechSynthesis?.cancel();
    try {
      this.source?.stop();
    } catch {
      /* already stopped */
    }
    this.source = null;
  }

  /** Resolves `true` when speech played to the end, `false` if it was stopped
   *  or interrupted; rejects on synthesis failure. */
  async speak(text: string, opts: SpeakOptions): Promise<boolean> {
    this.stop();
    const mine = this.token;
    const parts = splitSentences(stripMarkdown(text));
    if (parts.length === 0) return false;

    if (opts.engine === "system") {
      const synth = window.speechSynthesis;
      const voice = synth.getVoices().find((v) => v.voiceURI === opts.voice);
      await Promise.all(
        parts.map(
          (part) =>
            new Promise<void>((resolve) => {
              const u = new SpeechSynthesisUtterance(part);
              if (voice) u.voice = voice;
              u.onend = () => resolve();
              u.onerror = () => resolve();
              if (this.token === mine) synth.speak(u);
              else resolve();
            }),
        ),
      );
      return this.token === mine;
    }

    const ctx = (this.ctx ??= new AudioContext());
    if (ctx.state === "suspended") await ctx.resume();
    let next = window.mypa.tutor.speak(parts[0]!, opts.voice);
    for (let i = 0; i < parts.length; i++) {
      const audio = await next;
      if (this.token !== mine) return false;
      if (i + 1 < parts.length) next = window.mypa.tutor.speak(parts[i + 1]!, opts.voice);
      const buffer = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
      buffer.copyToChannel(new Float32Array(audio.samples), 0);
      await new Promise<void>((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.onended = () => resolve();
        this.source = src;
        src.start();
      });
      if (this.token !== mine) return false;
    }
    return true;
  }
}

/* ---------------------------------------------------------------- mic -- */

/** Records the microphone; `stop()` resolves to mono 16 kHz samples (Whisper's input). */
export class Recorder {
  private media: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private stopWatch: (() => void) | null = null;

  /** `onAutoStop` turns on hands-free behaviour: it fires once you stop talking
   *  (or immediately with `false` if nothing was heard for a while). */
  async start(opts: { onAutoStop?: (heard: boolean) => void } = {}): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    const media = new MediaRecorder(this.stream);
    media.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    media.start();
    this.media = media;
    if (opts.onAutoStop) this.watch(this.stream, opts.onAutoStop);
  }

  /** Simple voice-activity detection on the mic level. */
  private watch(stream: MediaStream, onAutoStop: (heard: boolean) => void): void {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const t0 = Date.now();
    let heard = false;
    let lastVoice = t0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const now = Date.now();
      if (Math.sqrt(sum / data.length) > 0.02) {
        heard = true;
        lastVoice = now;
      }
      const done =
        (heard && now - lastVoice > 1_500) || (!heard && now - t0 > 10_000) || now - t0 > 60_000;
      if (done) {
        this.endWatch();
        onAutoStop(heard);
      }
    }, 100);
    this.stopWatch = () => {
      clearInterval(timer);
      void ctx.close();
    };
  }

  private endWatch(): void {
    this.stopWatch?.();
    this.stopWatch = null;
  }

  /** Discards the recording. */
  cancel(): void {
    if (this.media && this.media.state !== "inactive") this.media.stop();
    this.release();
  }

  stop(): Promise<Float32Array> {
    const media = this.media;
    if (!media) return Promise.resolve(new Float32Array());
    return new Promise((resolve, reject) => {
      media.onstop = () => {
        const blob = new Blob(this.chunks, { type: media.mimeType });
        this.release();
        void (async () => {
          const ctx = new AudioContext({ sampleRate: 16_000 });
          try {
            const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
            resolve(decoded.getChannelData(0));
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          } finally {
            void ctx.close();
          }
        })();
      };
      media.stop();
    });
  }

  private release(): void {
    this.endWatch();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.media = null;
  }
}
