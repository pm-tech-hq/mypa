/**
 * The model-free half of meeting transcription: finding where people talk,
 * grouping voices into speakers, and weaving the two tracks into one
 * conversation. Pure functions, shared by the Whisper worker and main.
 */

export const SAMPLE_RATE = 16000;

/** 30 ms analysis frames. */
const FRAME = 480;
/** Silence this long ends a stretch of speech. */
const GAP_FRAMES = 25;
/** Shorter blips (a click, a cough) aren't speech. */
const MIN_SPEECH_FRAMES = 8;
/** Context kept either side of the speech, so first and last words aren't clipped. */
const PAD = Math.round(0.2 * SAMPLE_RATE);
/** Whisper hears 30 s at a time; longer stretches are cut at a quiet moment. */
const MAX_REGION = 28 * SAMPLE_RATE;
const MIN_CUT = 18 * SAMPLE_RATE;

export interface Region {
  start: number;
  end: number;
}

function frameLevels(audio: Float32Array): Float32Array {
  const n = Math.floor(audio.length / FRAME);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * FRAME; j < (i + 1) * FRAME; j++) sum += audio[j]! * audio[j]!;
    db[i] = 10 * Math.log10(sum / FRAME + 1e-10);
  }
  return db;
}

/**
 * Stretches of speech in a track, as sample ranges. Speech is anything well
 * above the track's own noise floor, so a quiet room and a noisy one both
 * work; silence is never handed to Whisper, which would invent words for it.
 */
export function speechRegions(audio: Float32Array): Region[] {
  const db = frameLevels(audio);
  const n = db.length;
  if (n === 0) return [];
  const floor = Array.from(db).sort((a, b) => a - b)[Math.floor(n * 0.1)]!;
  const threshold = Math.max(floor + 12, -55);

  const found: Region[] = [];
  let start = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (db[i]! > threshold) {
      if (start < 0) start = i;
      last = i;
    } else if (start >= 0 && i - last > GAP_FRAMES) {
      found.push({ start, end: last + 1 });
      start = -1;
    }
  }
  if (start >= 0) found.push({ start, end: last + 1 });

  const out: Region[] = [];
  for (const r of found) {
    if (r.end - r.start < MIN_SPEECH_FRAMES) continue;
    const region = {
      start: Math.max(0, r.start * FRAME - PAD),
      end: Math.min(audio.length, r.end * FRAME + PAD),
    };
    out.push(...splitLong(region, db));
  }
  return out;
}

/** Cuts a long stretch at its quietest frame between 18 and 28 seconds in. */
function splitLong(region: Region, db: Float32Array): Region[] {
  const out: Region[] = [];
  let { start } = region;
  while (region.end - start > MAX_REGION) {
    const from = Math.floor((start + MIN_CUT) / FRAME);
    const to = Math.floor((start + MAX_REGION) / FRAME);
    let cut = to;
    for (let f = from; f < to; f++) if (db[f]! < db[cut]!) cut = f;
    out.push({ start, end: cut * FRAME });
    start = cut * FRAME;
  }
  out.push({ start, end: region.end });
  return out;
}

/* ------------------------------------------------------------- speakers -- */

/** Shorter clips say too little about a voice to start a speaker of their own. */
const RELIABLE_MS = 1500;
/** Two clips this similar (cosine) are the same voice. */
const SAME_VOICE = 0.35;
/** Two speakers' averages this similar are one person split in two. */
const SAME_SPEAKER = 0.55;

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function normalize(v: Float32Array): Float32Array {
  const len = Math.sqrt(dot(v, v)) || 1;
  return Float32Array.from(v, (x) => x / len);
}

function centroid(members: Float32Array[]): Float32Array {
  const sum = new Float32Array(members[0]!.length);
  for (const m of members) for (let i = 0; i < sum.length; i++) sum[i]! += m[i]!;
  return normalize(sum);
}

/**
 * Groups clips by voice. `embeddings` are voice prints (any length, any
 * scale), `durations` in ms. Returns a speaker number per clip, numbered by
 * who talks first (0 = the first voice heard).
 */
export function clusterSpeakers(embeddings: Float32Array[], durations: number[]): number[] {
  const n = embeddings.length;
  if (n === 0) return [];
  const prints = embeddings.map(normalize);
  const reliable = prints.map((_, i) => i).filter((i) => durations[i]! >= RELIABLE_MS);
  if (reliable.length === 0) return prints.map(() => 0);

  // Longest clips first: they carry the clearest prints, so they found the groups.
  reliable.sort((a, b) => durations[b]! - durations[a]!);
  let groups: number[][] = [];
  let centers: Float32Array[] = [];
  for (const i of reliable) {
    let best = -1;
    let bestSim = SAME_VOICE;
    centers.forEach((c, g) => {
      const s = dot(prints[i]!, c);
      if (s > bestSim) {
        bestSim = s;
        best = g;
      }
    });
    if (best < 0) {
      groups.push([i]);
      centers.push(prints[i]!);
    } else {
      groups[best]!.push(i);
      centers[best] = centroid(groups[best]!.map((m) => prints[m]!));
    }
  }

  // A few rounds of moving each clip to its closest group.
  for (let round = 0; round < 3; round++) {
    const next: number[][] = centers.map(() => []);
    for (const i of reliable) next[nearest(prints[i]!, centers)]!.push(i);
    groups = next.filter((g) => g.length > 0);
    centers = groups.map((g) => centroid(g.map((m) => prints[m]!)));
  }

  // One person can end up as two groups (a cough, a change of tone): join them.
  for (;;) {
    let pair: [number, number] | null = null;
    let bestSim = SAME_SPEAKER;
    for (let a = 0; a < centers.length; a++)
      for (let b = a + 1; b < centers.length; b++) {
        const s = dot(centers[a]!, centers[b]!);
        if (s > bestSim) {
          bestSim = s;
          pair = [a, b];
        }
      }
    if (!pair) break;
    const [a, b] = pair;
    groups[a] = [...groups[a]!, ...groups[b]!];
    groups.splice(b, 1);
    centers = groups.map((g) => centroid(g.map((m) => prints[m]!)));
  }

  // A "speaker" heard for only a moment is more likely noise than a person.
  if (groups.length > 1) {
    const talk = groups.map((g) => g.reduce((ms, i) => ms + durations[i]!, 0));
    const keep = groups.map((g, k) => g.length >= 2 || talk[k]! >= 4000);
    if (keep.some(Boolean)) {
      groups = groups.filter((_, k) => keep[k]);
      centers = groups.map((g) => centroid(g.map((m) => prints[m]!)));
    }
  }

  const raw = prints.map((p) => nearest(p, centers));
  // Number speakers by who talks first.
  const order = new Map<number, number>();
  for (const g of raw) if (!order.has(g)) order.set(g, order.size);
  return raw.map((g) => order.get(g)!);
}

function nearest(p: Float32Array, centers: Float32Array[]): number {
  let best = 0;
  let bestSim = -Infinity;
  centers.forEach((c, g) => {
    const s = dot(p, c);
    if (s > bestSim) {
      bestSim = s;
      best = g;
    }
  });
  return best;
}

/* ------------------------------------------------------- the transcript -- */

/** Whisper's well-known inventions for noise and silence. */
const NOT_SPEECH = /^(?:you|\.+|thanks? for watching[.!]?|thank you for watching[.!]?)$/i;

/** False for text Whisper made up from noise rather than heard. */
export function isSpeech(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // "[BLANK_AUDIO]", "(music)", "*laughs*": sounds, not words
  if (/^[[(*♪].*[\])*♪]$/.test(t)) return false;
  return !NOT_SPEECH.test(t);
}

export interface Utterance {
  track: "me" | "them";
  /** ms from the start of the recording */
  start: number;
  end: number;
  speaker: string;
  text: string;
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/**
 * Drops what your microphone picked up from the speakers: a line of yours
 * that overlaps theirs in time and mostly repeats their words is their voice
 * coming out of your speakers, not you.
 */
export function dropEcho(utterances: Utterance[]): Utterance[] {
  const theirs = utterances.filter((u) => u.track === "them");
  return utterances.filter((u) => {
    if (u.track !== "me") return true;
    const mine = wordsOf(u.text);
    if (mine.length === 0) return false;
    const heard = new Set(
      theirs
        .filter((t) => t.start < u.end + 1000 && t.end > u.start - 1000)
        .flatMap((t) => wordsOf(t.text)),
    );
    if (heard.size === 0) return true;
    const repeated = mine.filter((w) => heard.has(w)).length;
    return repeated / mine.length < 0.6;
  });
}

/** Same speaker, this close together: one turn. */
const SAME_TURN_GAP = 1500;
const MAX_TURN = 90_000;

/** Both tracks in time order, with one person's back-to-back lines joined. */
export function weave(utterances: Utterance[]): Utterance[] {
  const sorted = [...utterances].sort((a, b) => a.start - b.start);
  const out: Utterance[] = [];
  for (const u of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.speaker === u.speaker &&
      u.start - prev.end < SAME_TURN_GAP &&
      u.end - prev.start < MAX_TURN
    ) {
      prev.text = `${prev.text} ${u.text}`;
      prev.end = Math.max(prev.end, u.end);
    } else {
      out.push({ ...u });
    }
  }
  return out;
}

export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** The transcript as text: one "[m:ss] Name: words" line per turn. */
export function transcriptText(
  turns: { start: number; speaker: string; text: string }[],
  names: Record<string, string>,
): string {
  return turns.map((t) => `[${clock(t.start)}] ${names[t.speaker] || t.speaker}: ${t.text}`).join("\n");
}
