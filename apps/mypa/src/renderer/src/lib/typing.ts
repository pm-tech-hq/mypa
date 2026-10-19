/** The typing trainer's logic: turning transcripts and notes into passages,
 *  choosing what to practise, and scoring. Pure functions, no React. */
import type { TranscriptRow, TypingCard, TypingDay, WidgetRow } from "../../../shared/types";

export type Stage = 0 | 1 | 2;

export const STAGE_LABEL: Record<Stage, string> = {
  0: "Copy",
  1: "Fill the gaps",
  2: "Recall",
};

export const STAGE_HINT: Record<Stage, string> = {
  0: "Type it as you read it.",
  1: "Type the whole passage, including the hidden words.",
  2: "Type what comes next from memory. Close counts.",
};

export interface Source {
  /** "t:<transcript id>" or "n:<widget id>" */
  id: string;
  kind: "transcript" | "note";
  title: string;
  text: string;
}

export interface Passage {
  /** Stable across edits elsewhere in the source: a hash of the passage text. */
  id: string;
  sourceId: string;
  sourceTitle: string;
  text: string;
}

export interface RoundItem {
  passage: Passage;
  stage: Stage;
  /** Practice that doesn't touch the passage's schedule (speed, drills). */
  free?: boolean;
}

/** Passages per round: short enough to feel like a game, not homework. */
export const DEFAULT_ROUND_SIZE = 5;

/** Days until the next recall, by box. */
const INTERVALS = [1, 3, 7, 16, 35, 90];
const SOON = 10 * 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------ sources ---- */

export function collectSources(transcripts: TranscriptRow[], widgets: WidgetRow[]): Source[] {
  const out: Source[] = [];
  for (const t of transcripts) {
    if (t.status === "done" && t.text.trim())
      out.push({ id: `t:${t.id}`, kind: "transcript", title: t.title, text: t.text });
  }
  for (const w of widgets) {
    const note = w.kind === "blank" ? (w.settings.note ?? "").trim() : "";
    if (!note) continue;
    const firstLine =
      note
        .split("\n")
        .find((l) => l.trim())
        ?.replace(/^[#>*\-+\s]+/, "") ?? "";
    const title =
      w.title && w.title !== "Note" && w.title !== "Widget" && w.title !== "Blank"
        ? w.title
        : firstLine.slice(0, 48) || "Note";
    out.push({ id: `n:${w.id}`, kind: "note", title, text: note });
  }
  return out;
}

/* ----------------------------------------------------------- cleaning ---- */

/** Characters people can't easily type, mapped to ones they can. */
function plainChars(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍﻿]/g, "");
}

function cleanTranscript(text: string): string {
  return (
    text
      // web page boilerplate
      .replace(/From Wikipedia, the free encyclopedia\.?/gi, " ")
      // footnote markers: [1] [12] [citation needed]
      .replace(/\[(?:\d{1,3}|[a-z]|citation needed|clarification needed)\]/gi, "")
      // SRT/VTT cue numbers and timing lines
      .replace(/^\s*\d+\s*$/gm, "")
      .replace(/^.*-->.*$/gm, "")
      .replace(/^WEBVTT.*$/gm, "")
      // timestamps like [00:01:02] (1:02) 00:01:02.500
      .replace(/[[(]?\b\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\b[\])]?/g, " ")
      // sound cues
      .replace(
        /[[(](?:music|laughter|laughs|applause|inaudible|crosstalk|silence|noise)[^\])]*[\])]/gi,
        " ",
      )
      // "Speaker 1:" / "JOHN:" at the start of a line
      .replace(
        /^\s*(?:speaker\s*\d+|[A-Z][A-Za-z.'-]{0,20}(?:\s[A-Z][A-Za-z.'-]{0,20})?)\s*:\s+/gm,
        "",
      )
      // fillers
      .replace(/\b(?:u+m+|u+h+|e+r+m+|h+m+|mm+)\b[,.]?\s*/gi, "")
      .replace(/\byou know,\s*/gi, "")
      // stutters: "the the", "I I"
      .replace(/\b(\w+)(\s+\1\b)+/gi, "$1")
  );
}

function cleanNote(text: string): string {
  return (
    text
      .replace(/```[\s\S]*?```/g, "\n")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/^\s*(?:---+|\*\*\*+)\s*$/gm, "")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|\W)[*_](\S[^*_]*?)[*_](?=\W|$)/g, "$1$2")
      // A line that doesn't end a sentence (a list item, a heading) becomes one.
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (/[.!?:;"')]$/.test(l) ? l : `${l}.`))
      .join(" ")
  );
}

/* ----------------------------------------------------------- passages ---- */

const STOP = new Set(
  (
    "a an the and or but so if then than that this these those there here is are was were be been being am " +
    "i me my we our you your he him his she her it its they them their what which who whom whose when where why how " +
    "to of in on at by for with from up down out over under into onto about as just also very really quite " +
    "do does did doing done have has had having can could will would shall should may might must not no yes " +
    "all any some each every both few more most other such only own same too again once now ok okay like get got " +
    "go going gonna wanna kind sort thing things stuff yeah well right actually basically literally lot lots " +
    "one two let lets let's it's that's don't i'm you're we're they're isn't aren't wasn't can't won't didn't doesn't"
  ).split(" "),
);

export function words(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** Lowercase, letters and digits only, light stemming: for comparing words. */
export function norm(word: string): string {
  const w = word
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, "")
    .replace(/'s$/, "");
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function isContent(word: string): boolean {
  const w = word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  return w.length >= 3 && /\p{L}/u.test(w) && !STOP.has(w);
}

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const CITATION =
  /[\u2191^]|\b(?:Retrieved|Archived from|Accessed|ISBN|ISSN|doi|PMID|OCLC|Bibcode)\b|\bpp?\.\s*\d|\(\d{4}\)\.|\bet al\./i;

export type PassageLength = "short" | "medium" | "long";

/** Words per passage: fewest kept, where a passage closes, most allowed. */
const LENGTHS: Record<PassageLength, { min: number; target: number; max: number }> = {
  short: { min: 6, target: 10, max: 22 },
  medium: { min: 8, target: 18, max: 45 },
  long: { min: 20, target: 40, max: 75 },
};

/** Splits a long sentence at commas, or failing that every ~30 words. */
function splitLong(sentence: string, MAX_WORDS: number, MIN_WORDS: number): string[] {
  const ws = words(sentence);
  if (ws.length <= MAX_WORDS) return [sentence];
  const out: string[] = [];
  let cur: string[] = [];
  for (const w of ws) {
    cur.push(w);
    if ((cur.length >= 20 && /[,;:]$/.test(w)) || cur.length >= 32) {
      out.push(cur.join(" "));
      cur = [];
    }
  }
  if (cur.length) {
    if (cur.length < MIN_WORDS && out.length) out[out.length - 1] += ` ${cur.join(" ")}`;
    else out.push(cur.join(" "));
  }
  return out;
}

/** A source as plain sentences: no timestamps, speaker labels, fillers,
 *  markdown or citations. Also what the Flashcards widget learns from. */
export function sentencesOf(source: Source): string[] {
  const cleaned = plainChars(
    source.kind === "transcript" ? cleanTranscript(source.text) : cleanNote(source.text),
  )
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    // Reference lists and citations: nothing to learn, awkward to type.
    .filter((s) => !CITATION.test(s))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

export function passagesOf(source: Source, length: PassageLength = "medium"): Passage[] {
  const { min: MIN_WORDS, target: TARGET_WORDS, max: MAX_WORDS } = LENGTHS[length];
  const sentences = sentencesOf(source).flatMap((s) => splitLong(s, MAX_WORDS, MIN_WORDS));

  const chunks: string[] = [];
  let cur: string[] = [];
  let count = 0;
  for (const s of sentences) {
    const n = words(s).length;
    if (count && count + n > MAX_WORDS) {
      chunks.push(cur.join(" "));
      cur = [];
      count = 0;
    }
    cur.push(s);
    count += n;
    if (count >= TARGET_WORDS) {
      chunks.push(cur.join(" "));
      cur = [];
      count = 0;
    }
  }
  if (cur.length) chunks.push(cur.join(" "));

  const seen = new Set<string>();
  const out: Passage[] = [];
  for (const text of chunks) {
    const ws = words(text);
    if (ws.length < MIN_WORDS) continue;
    // Mostly small talk ("yeah so I mean it's like that") carries nothing to learn.
    if (ws.filter(isContent).length / ws.length < 0.3) continue;
    const id = hash(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""));
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, sourceId: source.id, sourceTitle: source.title, text });
  }
  return out;
}

/* ---------------------------------------------------------------- gaps --- */

/** Character ranges [start, end) of the words to hide: the longest content
 *  words, about a quarter of them, spread across the passage. */
export type GapDensity = "few" | "some" | "many";

const DENSITY: Record<GapDensity, { share: number; most: number }> = {
  few: { share: 0.15, most: 3 },
  some: { share: 0.25, most: 6 },
  many: { share: 0.4, most: 10 },
};

export function gapRanges(text: string, density: GapDensity = "some"): [number, number][] {
  const tokens: { start: number; end: number; word: string; i: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Hide the word itself, not its punctuation.
    const lead = m[0].match(/^[^\p{L}\p{N}]*/u)![0].length;
    const trail = m[0].match(/[^\p{L}\p{N}]*$/u)![0].length;
    const word = m[0].slice(lead, m[0].length - trail);
    if (word)
      tokens.push({
        start: m.index + lead,
        end: m.index + m[0].length - trail,
        word,
        i: tokens.length,
      });
  }
  const content = tokens.filter((t) => isContent(t.word) && t.word.length >= 4);
  const { share, most } = DENSITY[density];
  const want = Math.min(
    most,
    Math.max(density === "few" ? 1 : 2, Math.round(content.length * share)),
  );
  const picked: typeof content = [];
  for (const t of [...content].sort((a, b) => b.word.length - a.word.length)) {
    if (picked.length >= want) break;
    // Keep hidden words apart so each has context around it.
    if (picked.some((p) => Math.abs(p.i - t.i) < 2)) continue;
    picked.push(t);
  }
  return picked.sort((a, b) => a.start - b.start).map((t) => [t.start, t.end]);
}

/* -------------------------------------------------------------- recall --- */

/** How many leading words to show as the cue. */
export function recallCueLength(text: string): number {
  return Math.min(5, Math.max(3, Math.round(words(text).length * 0.15)));
}

export interface RecallResult {
  score: number;
  /** One entry per word of the passage after the cue. */
  marks: { word: string; content: boolean; got: boolean }[];
}

/** Scores free recall by the passage's content words the answer contains. */
export function scoreRecall(text: string, answer: string): RecallResult {
  const ws = words(text).slice(recallCueLength(text));
  const said = new Set(words(answer).map(norm).filter(Boolean));
  const marks = ws.map((word) => {
    const content = isContent(word);
    return { word, content, got: content && said.has(norm(word)) };
  });
  const content = marks.filter((m) => m.content);
  const score = content.length ? content.filter((m) => m.got).length / content.length : 1;
  return { score, marks };
}

/* ---------------------------------------------------------- scheduling --- */

export const PASS: Record<Stage, number> = { 0: 0.9, 1: 0.75, 2: 0.6 };

/** The card after one attempt. */
export function nextCard(
  card: TypingCard | undefined,
  stage: Stage,
  score: number,
  now: number,
): TypingCard {
  const c: TypingCard = card ?? { stage: 0, box: 0, due: 0, reps: 0 };
  const passed = score >= PASS[stage];
  const reps = c.reps + 1;
  if (stage === 0)
    return passed ? { ...c, stage: 1, due: now + SOON, reps } : { ...c, due: now + SOON, reps };
  if (stage === 1)
    // A night's sleep between seeing it and recalling it is what makes it stick.
    return passed
      ? { ...c, stage: 2, due: now + 8 * HOUR, reps }
      : { ...c, stage: 1, due: now + SOON, reps };
  if (passed) {
    const box = Math.min(c.box + 1, INTERVALS.length);
    return { ...c, stage: 2, box, due: now + INTERVALS[box - 1]! * DAY, reps };
  }
  return { ...c, stage: 1, box: Math.max(0, c.box - 1), due: now + SOON, reps };
}

/** Due reviews first (recall before gaps before copy), then new passages
 *  taken round-robin across sources so one long transcript doesn't dominate. */
export function pickRound(
  passages: Passage[],
  cards: Record<string, TypingCard>,
  now: number,
  practiceAnyway = false,
  ROUND_SIZE = DEFAULT_ROUND_SIZE,
  skipCopy = false,
): RoundItem[] {
  const firstStage: Stage = skipCopy ? 1 : 0;
  const due = passages
    .filter((p) => cards[p.id] && cards[p.id]!.due <= now)
    .sort((a, b) => cards[b.id]!.stage - cards[a.id]!.stage || cards[a.id]!.due - cards[b.id]!.due);
  const round: RoundItem[] = due
    .slice(0, ROUND_SIZE)
    .map((p) => ({ passage: p, stage: Math.max(firstStage, cards[p.id]!.stage) as Stage }));

  if (round.length < ROUND_SIZE) {
    const bySource = new Map<string, Passage[]>();
    for (const p of passages) {
      if (cards[p.id]) continue;
      const list = bySource.get(p.sourceId) ?? [];
      list.push(p);
      bySource.set(p.sourceId, list);
    }
    const queues = [...bySource.values()];
    while (round.length < ROUND_SIZE && queues.some((q) => q.length)) {
      for (const q of queues) {
        const p = q.shift();
        if (p && round.length < ROUND_SIZE) round.push({ passage: p, stage: firstStage });
      }
    }
  }

  if (!round.length && practiceAnyway) {
    // Nothing due: the soonest-due passages, at their current stage.
    return passages
      .filter((p) => cards[p.id])
      .sort((a, b) => cards[a.id]!.due - cards[b.id]!.due)
      .slice(0, ROUND_SIZE)
      .map((p) => ({ passage: p, stage: cards[p.id]!.stage as Stage }));
  }
  return round;
}

/** When the next passage comes due, if nothing is due now. */
export function nextDue(passages: Passage[], cards: Record<string, TypingCard>): number | null {
  let soonest: number | null = null;
  for (const p of passages) {
    const c = cards[p.id];
    if (c && (soonest === null || c.due < soonest)) soonest = c.due;
  }
  return soonest;
}

/* --------------------------------------------------------------- stats --- */

export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Consecutive days practised, ending today (or yesterday, if not yet today). */
export function streak(days: Record<string, TypingDay>, now: number): number {
  let n = 0;
  let t = now;
  if (!days[dayKey(t)]?.passages) t -= DAY;
  while (days[dayKey(t)]?.passages) {
    n++;
    t -= DAY;
  }
  return n;
}

export function wpm(correctChars: number, ms: number): number {
  return ms > 0 ? Math.round(correctChars / 5 / (ms / 60_000)) : 0;
}

export function when(t: number, now: number): string {
  const ms = t - now;
  if (ms < HOUR) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < DAY) return `in ${Math.round(ms / HOUR)} h`;
  const days = Math.round(ms / DAY);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/* ------------------------------------------------------- free practice --- */

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Random passages to copy for speed, without touching the schedule. */
export function speedRound(passages: Passage[], size: number): RoundItem[] {
  return shuffle(passages)
    .slice(0, size)
    .map((p) => ({ passage: p, stage: 0 as Stage, free: true }));
}

/** Copy drills built from real words in your sources that use the given
 *  characters (your weak keys), or from the given words (your slow words). */
export function drillRound(
  passages: Passage[],
  opts: { keys?: string[]; words?: string[] },
  size: number,
): RoundItem[] {
  let pool: string[];
  if (opts.words?.length) {
    pool = opts.words;
  } else {
    const keys = (opts.keys ?? []).filter((k) => k.trim());
    const all = new Set<string>();
    for (const p of passages)
      for (const w of words(p.text)) {
        const bare = w.replace(/[^\p{L}\p{N}'-]/gu, "");
        if (bare.length >= 3 && keys.some((k) => bare.toLowerCase().includes(k)))
          all.add(bare.toLowerCase());
      }
    pool = [...all];
  }
  if (!pool.length) return [];
  const out: RoundItem[] = [];
  for (let n = 0; n < size; n++) {
    const line: string[] = [];
    while (line.length < 12) line.push(...shuffle(pool));
    const text = line.slice(0, 12).join(" ");
    out.push({
      passage: { id: `drill-${n}-${Date.now()}`, sourceId: "drill", sourceTitle: "Drill", text },
      stage: 0,
      free: true,
    });
  }
  return out;
}

/** One long run of text for a timed sprint. */
export function sprintText(passages: Passage[], minChars = 2400): string {
  const parts: string[] = [];
  let len = 0;
  const pool = shuffle(passages);
  for (let i = 0; len < minChars && pool.length; i++) {
    const p = pool[i % pool.length]!;
    parts.push(p.text);
    len += p.text.length + 1;
  }
  return parts.join(" ");
}

/** What you actually type, after the strictness settings. */
export function typeable(text: string, ignorePunctuation: boolean): string {
  if (!ignorePunctuation) return text;
  return text
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/(^|\s)['-]+|['-]+(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Per-day speed and minutes for the last `n` days, oldest first. */
export function history(days: Record<string, TypingDay>, now: number, n = 14) {
  const out: { key: string; label: string; minutes: number; wpm: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = now - i * DAY;
    const d = days[dayKey(t)];
    out.push({
      key: dayKey(t),
      label: new Date(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric" }),
      minutes: d ? d.ms / 60_000 : 0,
      wpm: d && d.ms ? wpm(d.chars, d.ms) : 0,
    });
  }
  return out;
}

/** Started / learned / total passages for one source. */
export function sourceProgress(passages: Passage[], cards: Record<string, TypingCard>) {
  let started = 0;
  let learned = 0;
  for (const p of passages) {
    const c = cards[p.id];
    if (c) started++;
    if (c && c.box >= 1) learned++;
  }
  return { started, learned, total: passages.length };
}
