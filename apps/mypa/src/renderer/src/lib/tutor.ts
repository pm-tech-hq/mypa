/** Tutor widget helpers — prompt building, source retrieval, speech. */
import type { ChatMessage, VoiceEngine } from "../../../shared/tutor";
import type { TranscriptRow } from "../../../shared/types";

export type Level = "beginner" | "intermediate" | "advanced";
export type Mode = "ask" | "explain" | "apply" | "takeaways" | "quiz" | "topics";
export type Engine = VoiceEngine;

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

/* ------------------------------------------------------------ lessons -- */

export type LessonStyle = "storyteller" | "direct" | "coach" | "simple" | "custom";
export type LessonLength = "short" | "medium" | "long";

export const LESSON_STYLES: { id: LessonStyle; label: string; hint: string; prompt: string }[] = [
  {
    id: "storyteller",
    label: "Storyteller (Jim Rohn style)",
    hint: "Stories, simple principles, memorable lines",
    prompt:
      "Teach like a warm, wise personal-development speaker in the tradition of Jim Rohn: open with a short story or an everyday scene, build to one simple principle, phrase it in short memorable lines with contrast and rhythm, talk straight to 'you', and close with a gentle challenge about who you could become.",
  },
  {
    id: "direct",
    label: "No fluff (Alex Hormozi style)",
    hint: "Blunt, frameworks, numbers, action",
    prompt:
      "Teach like a blunt, high-energy business operator in the style of Alex Hormozi: state the point in the first sentence, name the principle, break it into a simple framework or a few numbered steps, use concrete numbers and before/after examples, call out the mistake most people make, and push for action. Tough love, zero fluff.",
  },
  {
    id: "coach",
    label: "Coach",
    hint: "Questions that make you think",
    prompt:
      "Teach like a supportive coach: explain the idea briefly, then ask two or three reflective questions that connect it to my own life (pause on each, as if waiting), and end with a small exercise.",
  },
  {
    id: "simple",
    label: "Simple explainer (Feynman style)",
    hint: "Plain words, vivid analogies",
    prompt:
      "Teach like Richard Feynman: build the idea up from first principles in plain words, use one vivid analogy, point out where people usually get confused, and finish by restating the core idea in one sentence.",
  },
  {
    id: "custom",
    label: "My own style…",
    hint: "Describe how you want to be taught",
    prompt: "",
  },
];

export const LESSON_LENGTH: Record<LessonLength, { label: string; words: number }> = {
  short: { label: "Short (~2 min)", words: 280 },
  medium: { label: "Medium (~4 min)", words: 600 },
  long: { label: "Long (~8 min)", words: 1_100 },
};

export function lessonStyleLabel(style: LessonStyle, custom: string): string {
  if (style === "custom") return custom.trim() ? "my style" : "simple";
  return LESSON_STYLES.find((s) => s.id === style)!.label.replace(/ \(.*\)$/, "").toLowerCase();
}

/** The request for one lesson. With no topic, the tutor picks one idea itself. */
export function lessonPrompt(opts: {
  topic: string;
  style: LessonStyle;
  custom: string;
  length: LessonLength;
  covered: string[];
  hasMaterial: boolean;
}): string {
  const style =
    opts.style === "custom"
      ? opts.custom.trim()
        ? `Teach in this style: ${opts.custom.trim()}`
        : LESSON_STYLES.find((s) => s.id === "simple")!.prompt
      : LESSON_STYLES.find((s) => s.id === opts.style)!.prompt;
  const what = opts.topic
    ? `Teach me one lesson about "${opts.topic}".`
    : [
        opts.hasMaterial
          ? "Teach me one lesson. Pick ONE specific idea from the material that is genuinely worth learning (not a summary of everything)."
          : "Teach me one lesson on a single practical idea that would make my life or work better.",
        opts.covered.length
          ? `Pick something different from what you already taught me: ${opts.covered.slice(-15).join("; ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
  return [
    what,
    style,
    `Length: about ${LESSON_LENGTH[opts.length].words} words. It is a talk that will be read aloud to me, so write flowing spoken paragraphs, not notes; use at most one short list.`,
    'Start with a first line "# " followed by a short title for the lesson. End with a line that starts with "Try this:" and gives one thing I can do today.',
    "Stay true to the material, and say so when you add an example of your own. You are inspired by that teaching style, not the person: don't speak as them or put invented quotes in anyone's mouth.",
  ].join("\n\n");
}

/** The "# Title" line of a lesson. */
export function lessonTitle(text: string): string {
  return /^\s*#+\s*(.+)$/m.exec(text)?.[1]?.replace(/[*_`]/g, "").trim().slice(0, 80) ?? "";
}

/**
 * A stretch of the material to teach from: a random source (longer ones more
 * often) and a random place in it, so each lesson can land somewhere new.
 */
export function lessonMaterial(sources: TranscriptRow[], budget: number): string {
  const total = sources.reduce((n, t) => n + t.text.length, 0);
  if (total <= budget) return buildMaterial(sources, "", budget);
  let r = Math.random() * total;
  const t = sources.find((s) => (r -= s.text.length) < 0) ?? sources[0]!;
  if (t.text.length <= budget) return `### ${t.title}\n${t.text}`;
  const start = Math.floor(Math.random() * (t.text.length - budget));
  // begin and end on sentence boundaries where possible
  const dot = t.text.indexOf(". ", start);
  const from = dot >= 0 && dot - start < 400 ? dot + 2 : start;
  const slice = t.text.slice(from, from + budget);
  const end = slice.lastIndexOf(". ");
  return `### ${t.title}\n${end > budget / 2 ? slice.slice(0, end + 1) : slice}`;
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
  // Only role and content: the chat's own fields (id, shown) would be sent too,
  // and Anthropic's API rejects unknown fields.
  return [
    { role: "system", content: system },
    ...history.slice(-historyLimit).map(({ role, content }) => ({ role, content })),
  ];
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

/** Splits into speakable pieces (`max` chars) so speech starts quickly. */
export function splitSentences(text: string, max = 300): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > max) {
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
  /** System: a SpeechSynthesisVoice.voiceURI; neural: a Kokoro voice id; cloud: the service's voice id. */
  voice: string;
}

/** An error's message without Electron's "Error invoking remote method …" wrapper. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

export const ENGINE_LABEL: Record<Engine, string> = {
  system: "System voice: instant, basic quality",
  neural: "Neural voice: natural, offline, ~90 MB download on first use",
  openai: "OpenAI voices: very natural (your API key)",
  elevenlabs: "ElevenLabs: most lifelike (your API key)",
};

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
    const engine = opts.engine;
    // cloud voices sound more natural with whole paragraphs, and each piece is a request
    const parts = splitSentences(stripMarkdown(text), engine === "neural" || engine === "system" ? 300 : 900);
    if (parts.length === 0) return false;

    if (engine === "system") {
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
    const synth = (part: string) => window.mypa.tutor.speak(part, opts.voice, engine);
    let next = synth(parts[0]!);
    for (let i = 0; i < parts.length; i++) {
      const audio = await next;
      if (this.token !== mine) return false;
      if (i + 1 < parts.length) {
        next = synth(parts[i + 1]!);
        next.catch(() => undefined); // surfaced when awaited; don't warn if stopped first
      }
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
