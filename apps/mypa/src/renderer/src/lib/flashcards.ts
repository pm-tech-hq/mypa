/** The flashcard trainer's logic: making cards from transcripts and notes,
 *  scheduling them with FSRS, choosing how to ask, and checking answers.
 *  Pure functions apart from `streamChat`, no React. */
import type { ChatMessage } from "../../../shared/tutor";
import type { FlashDay, Flashcard, FlashcardsPrefs, FlashState } from "../../../shared/types";
import { systemPrompt } from "./tutor";
import { isContent, norm, sentencesOf, words, type Source } from "./typing";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** A study day starts at 4am, so a late night still counts as the same day. */
const ROLLOVER = 4 * HOUR;

export type Grade = 1 | 2 | 3 | 4;
export const GRADE_LABEL: Record<Grade, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

/** The cloze gap marker inside `front`. */
export const GAP = "{{}}";

/* ================================================================ FSRS ==== */

/** FSRS-5 default parameters. */
const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
] as const;
const w = (i: number): number => W[i]!;
const DECAY = -0.5;
const FACTOR = 19 / 81;

/** Minutes between showings while a card is new, and after it's forgotten. */
const LEARN_STEPS = [1, 10];
const RELEARN_STEPS = [10];
const MAX_INTERVAL = 365 * 3;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Chance of remembering after `days` with stability `s`. */
export function retrievability(days: number, s: number): number {
  return s > 0 ? Math.pow(1 + (FACTOR * days) / s, DECAY) : 0;
}

function intervalFor(s: number, retention: number): number {
  return (s / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
}

const initStability = (g: Grade): number => Math.max(w(g - 1), 0.1);
const initDifficulty = (g: Grade): number => clamp(w(4) - Math.exp(w(5) * (g - 1)) + 1, 1, 10);

function nextDifficulty(d: number, g: Grade): number {
  const delta = -w(6) * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  return clamp(w(7) * initDifficulty(4) + (1 - w(7)) * damped, 1, 10);
}

function recallStability(d: number, s: number, r: number, g: Grade): number {
  const hard = g === 2 ? w(15) : 1;
  const easy = g === 4 ? w(16) : 1;
  return (
    s *
    (1 +
      Math.exp(w(8)) *
        (11 - d) *
        Math.pow(s, -w(9)) *
        (Math.exp(w(10) * (1 - r)) - 1) *
        hard *
        easy)
  );
}

function forgetStability(d: number, s: number, r: number): number {
  const f = w(11) * Math.pow(d, -w(12)) * (Math.pow(s + 1, w(13)) - 1) * Math.exp(w(14) * (1 - r));
  return Math.min(s, f);
}

/** Reviews on the same day barely move long-term memory. */
const sameDayStability = (s: number, g: Grade): number => s * Math.exp(w(17) * (g - 3 + w(18)));

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Midnight-ish start (4am) of the study day `days` after the one `t` is in. */
function studyDayStart(t: number, days: number): number {
  const d = new Date(t - ROLLOVER);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime() + ROLLOVER;
}

export function studyDay(t: number): string {
  const d = new Date(t - ROLLOVER);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A little deterministic spread so cards learned together don't all return together. */
function fuzz(days: number, card: Flashcard): number {
  if (days < 2.5) return days;
  const f = (hash(`${card.id}:${card.reps}`) % 1000) / 1000;
  return days * (1 + (f - 0.5) * 0.1);
}

/**
 * The card after each possible grade, Again to Easy. Learning cards step
 * through minutes-long steps; learned cards get FSRS intervals in days that
 * always order Hard < Good < Easy.
 */
export function outcomes(
  card: Flashcard,
  now: number,
  retention: number,
): Record<Grade, Flashcard> {
  const elapsed = card.lastReview ? (now - card.lastReview) / DAY : 0;
  const r = card.state === 0 ? 1 : retrievability(elapsed, card.stability);

  const memory = (g: Grade): { stability: number; difficulty: number } => {
    if (card.state === 0) return { stability: initStability(g), difficulty: initDifficulty(g) };
    const difficulty = nextDifficulty(card.difficulty, g);
    if (elapsed < 1) return { stability: sameDayStability(card.stability, g), difficulty };
    return {
      stability:
        g === 1
          ? forgetStability(card.difficulty, card.stability, r)
          : recallStability(card.difficulty, card.stability, r, g),
      difficulty,
    };
  };

  const base = (g: Grade): Flashcard => ({
    ...card,
    ...memory(g),
    lastReview: now,
    reps: card.reps + 1,
  });
  const inMinutes = (
    c: Flashcard,
    state: FlashState,
    step: number,
    minutes: number,
  ): Flashcard => ({
    ...c,
    state,
    step,
    due: now + minutes * MIN,
  });
  const days = (c: Flashcard) =>
    clamp(Math.round(fuzz(intervalFor(c.stability, retention), c)), 1, MAX_INTERVAL);

  const out = {} as Record<Grade, Flashcard>;
  if (card.state === 0 || card.state === 1 || card.state === 3) {
    const steps = card.state === 3 ? RELEARN_STEPS : LEARN_STEPS;
    const state: FlashState = card.state === 3 ? 3 : 1;
    const step = card.state === 0 ? 0 : Math.min(card.step, steps.length - 1);
    out[1] = inMinutes(base(1), state, 0, steps[0]!);
    const hardMin =
      step === 0 && steps.length > 1 ? (steps[0]! + steps[1]!) / 2 : steps[step]! * 1.5;
    out[2] = inMinutes(base(2), state, step, hardMin);
    const good = base(3);
    out[3] =
      step + 1 < steps.length
        ? inMinutes(good, state, step + 1, steps[step + 1]!)
        : graduate(good, days(good));
    const easy = base(4);
    const goodDays = out[3].state === 2 ? Math.round((out[3].due - now) / DAY) : 0;
    out[4] = graduate(easy, Math.max(days(easy), goodDays + 1));
  } else {
    const again = base(1);
    out[1] = inMinutes({ ...again, lapses: card.lapses + 1 }, 3, 0, RELEARN_STEPS[0]!);
    const hardD = days(base(2));
    const goodD = Math.max(days(base(3)), hardD + 1);
    const easyD = Math.max(days(base(4)), goodD + 1);
    out[2] = graduate(base(2), hardD);
    out[3] = graduate(base(3), goodD);
    out[4] = graduate(base(4), easyD);
  }
  return out;

  function graduate(c: Flashcard, d: number): Flashcard {
    return { ...c, state: 2, step: 0, due: studyDayStart(now, d) };
  }
}

/** "1m", "10m", "3d", "2mo" — how long until the card comes back. */
export function intervalLabel(due: number, now: number): string {
  const ms = Math.max(0, due - now);
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))}m`;
  if (ms < DAY * 0.9) return `${Math.round(ms / HOUR)}h`;
  const d = Math.max(1, Math.round(ms / DAY));
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, "")}y`;
}

export function when(t: number, now: number): string {
  const ms = t - now;
  if (ms <= 0) return "now";
  if (ms < HOUR) return `in ${Math.max(1, Math.round(ms / MIN))} min`;
  if (t < studyDayStart(now, 1)) return `in ${Math.round(ms / HOUR)} h`;
  const days = Math.round((studyDayStart(t, 0) - studyDayStart(now, 0)) / DAY);
  return days <= 1 ? "tomorrow" : `in ${days} days`;
}

export function newCard(
  partial: Pick<Flashcard, "sourceId" | "sourceTitle" | "kind" | "front" | "back" | "origin"> &
    Partial<Pick<Flashcard, "quote" | "wrong">>,
  now: number,
): Flashcard {
  return {
    id: crypto.randomUUID(),
    quote: "",
    wrong: [],
    ...partial,
    createdAt: now,
    state: 0,
    step: 0,
    due: now,
    stability: 0,
    difficulty: 0,
    lastReview: 0,
    reps: 0,
    lapses: 0,
  };
}

/** Back to new, keeping the card itself. */
export function forget(card: Flashcard, now: number): Flashcard {
  return {
    ...card,
    state: 0,
    step: 0,
    due: now,
    stability: 0,
    difficulty: 0,
    lastReview: 0,
    reps: 0,
    lapses: 0,
  };
}

/** Missed often enough that drilling it more won't help — it needs rewording. */
export const isLeech = (c: Flashcard): boolean => c.lapses >= 5;

/* =============================================================== queue ==== */

export const EMPTY_DAY: FlashDay = {
  reviews: 0,
  fresh: 0,
  rev: 0,
  revOk: 0,
  ms: 0,
};

export interface Queue {
  /** Learned cards due today, most at risk of being forgotten first. */
  reviews: Flashcard[];
  /** New cards allowed today, round-robin across sources. */
  fresh: Flashcard[];
  /** Cards in their minutes-long steps (due now or later today). */
  learning: Flashcard[];
}

export function buildQueue(
  cards: Flashcard[],
  now: number,
  prefs: Pick<FlashcardsPrefs, "newPerDay" | "maxReviews">,
  today: FlashDay,
  /** Practise ahead: also take reviews due in the next few days. */
  ahead = false,
): Queue {
  const live = cards.filter((c) => !c.suspended);
  const horizon = ahead ? studyDayStart(now, 4) : now;
  const reviewLimit = prefs.maxReviews > 0 ? Math.max(0, prefs.maxReviews - today.rev) : Infinity;
  const reviews = live
    .filter((c) => c.state === 2 && c.due <= horizon)
    .map((c) => ({
      c,
      r: retrievability((now - c.lastReview) / DAY, c.stability),
    }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.c)
    .slice(0, ahead ? 50 : reviewLimit);

  const newLimit = ahead ? 0 : Math.max(0, prefs.newPerDay - today.fresh);
  const bySource = new Map<string, Flashcard[]>();
  for (const c of live
    .filter((x) => x.state === 0)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    const list = bySource.get(c.sourceId) ?? [];
    list.push(c);
    bySource.set(c.sourceId, list);
  }
  const fresh: Flashcard[] = [];
  const queues = [...bySource.values()];
  while (fresh.length < newLimit && queues.some((q) => q.length)) {
    for (const q of queues) {
      const c = q.shift();
      if (c && fresh.length < newLimit) fresh.push(c);
    }
  }

  const learning = live
    .filter((c) => (c.state === 1 || c.state === 3) && c.due < studyDayStart(now, 1))
    .sort((a, b) => a.due - b.due);
  return { reviews, fresh, learning };
}

/** The order a session starts with: a new card after every few reviews. */
export function interleave(q: Queue): string[] {
  const out: string[] = [];
  const reviews = [...q.reviews];
  const fresh = [...q.fresh];
  const every = fresh.length ? Math.max(1, Math.floor(reviews.length / fresh.length)) : 0;
  while (reviews.length || fresh.length) {
    for (let i = 0; i < Math.max(1, every) && reviews.length; i++) out.push(reviews.shift()!.id);
    if (fresh.length) out.push(fresh.shift()!.id);
  }
  return out;
}

/** Learning cards are shown early when there's nothing else, up to this far ahead. */
export const LEARN_AHEAD = 20 * MIN;

/* ========================================================= asking ========= */

export type AskMode = "flip" | "type" | "choice";

const answerWords = (c: Flashcard): number => words(c.back).length;

/**
 * Mixed mode moves each card from recognising to recalling: pick from four
 * while it's new, then type it (short answers) or recall it in your head
 * (longer ones) once it has started to stick.
 */
export function askMode(card: Flashcard, mode: FlashcardsPrefs["mode"], options: number): AskMode {
  if (mode === "choice") return options >= 3 ? "choice" : "flip";
  if (mode === "flip" || mode === "type") return mode;
  const fresh = card.state === 0 || (card.state === 1 && card.step === 0);
  if (fresh && options >= 3) return "choice";
  if (card.kind === "cloze" || answerWords(card) <= 6) return "type";
  return "flip";
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const looksNumeric = (s: string): boolean => /^\W*[\d$€£]/.test(s);
const sameAnswer = (a: string, b: string): boolean => normAnswer(a) === normAnswer(b);

/** Four options: the card's own wrong answers, or answers of similar cards. */
export function choicesFor(card: Flashcard, all: Flashcard[]): string[] {
  const picked: string[] = [];
  const add = (x: string) => {
    const t = x.trim();
    if (t && !sameAnswer(t, card.back) && !picked.some((p) => sameAnswer(p, t))) picked.push(t);
  };
  for (const x of shuffle(card.wrong)) if (picked.length < 3) add(x);
  if (picked.length < 3) {
    const n = answerWords(card);
    const num = looksNumeric(card.back);
    const pool = all
      .filter((c) => c.id !== card.id && c.kind === card.kind && looksNumeric(c.back) === num)
      .map((c) => ({
        back: c.back,
        score:
          (c.sourceId === card.sourceId ? 0 : 2) +
          Math.abs(answerWords(c) - n) +
          Math.random() * 1.5,
      }))
      .sort((a, b) => a.score - b.score);
    for (const p of pool) if (picked.length < 3) add(p.back);
  }
  if (picked.length < 2) return [];
  return shuffle([card.back, ...picked]);
}

/** Text to read aloud: the gap spoken as "blank". */
export function spokenFront(card: Flashcard): string {
  return card.front.replace(GAP, "blank");
}

/* ===================================================== checking answers === */

const ARTICLES = /^(?:the|a|an|to)\s+/;

export function normAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*(?:per ?cent)\b/g, "%")
    .replace(/[‘’']/g, "")
    .replace(/[^\p{L}\p{N}%.\s-]/gu, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(ARTICLES, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length]!;
}

const similarity = (a: string, b: string): number =>
  1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

export type Verdict = "right" | "close" | "wrong";

export interface Check {
  verdict: Verdict;
  /** Words of the expected answer, and whether the answer had them. */
  marks: { word: string; got: boolean }[];
}

/**
 * Short answers are compared as a whole, forgiving typos; longer ones by
 * how many of the expected key words the answer contains.
 */
export function checkAnswer(answer: string, expected: string): Check {
  const a = normAnswer(answer);
  const e = normAnswer(expected);
  const expWords = words(expected);
  const said = words(a).map(norm);
  const hasWord = (w: string) => {
    const n = norm(w);
    return said.some((s) => s === n || (n.length >= 5 && similarity(s, n) >= 0.8));
  };
  const marks = expWords.map((word) => ({
    word,
    got: isContent(word) && hasWord(word),
  }));
  if (!a) return { verdict: "wrong", marks };
  if (a === e) return { verdict: "right", marks: marks.map((m) => ({ ...m, got: true })) };

  const eWords = e.split(" ");
  if (eWords.length <= 3) {
    const sim = similarity(a, e);
    // The answer inside a few extra words still counts ("in 1969" for "1969").
    const inside = ` ${a} `.includes(` ${e} `) && words(a).length <= eWords.length + 3;
    const numeric = /\d/.test(e);
    if (numeric) {
      const nums = (s: string) => s.match(/\d+(?:\.\d+)?/g)?.join(" ") ?? "";
      if (nums(a) !== nums(e)) return { verdict: "wrong", marks };
    }
    if (sim >= 0.85 || inside)
      return {
        verdict: "right",
        marks: marks.map((m) => ({ ...m, got: true })),
      };
    if (sim >= 0.65) return { verdict: "close", marks };
    return { verdict: "wrong", marks };
  }

  const key = marks.filter((m) => isContent(m.word));
  if (!key.length) return { verdict: similarity(a, e) >= 0.75 ? "right" : "wrong", marks };
  const share = key.filter((m) => m.got).length / key.length;
  return {
    verdict: share >= 0.7 ? "right" : share >= 0.4 ? "close" : "wrong",
    marks,
  };
}

export const SUGGESTED: Record<Verdict, Grade> = {
  right: 3,
  close: 2,
  wrong: 1,
};

/* ======================================================= making cards ===== */

/** About this many characters of a source go into each request / part. */
const PART_CHARS = 2_400;

export interface Part {
  index: number;
  text: string;
}

/** A source split into parts at sentence ends; the unit cards are made from. */
export function partsOf(source: Source): Part[] {
  const parts: Part[] = [];
  let cur = "";
  for (const s of sentencesOf(source)) {
    if (cur && cur.length + s.length > PART_CHARS) {
      parts.push({ index: parts.length, text: cur.trim() });
      cur = "";
    }
    cur += `${s} `;
  }
  if (cur.trim().length > 80 || (cur.trim() && !parts.length))
    parts.push({ index: parts.length, text: cur.trim() });
  return parts;
}

export type Draft = Pick<Flashcard, "kind" | "front" | "back" | "quote" | "wrong"> & {
  /** Which part of the source it came from. */
  part: number;
};

/* ---- quick cards (no AI) ---- */

const PRONOUN =
  /^(?:it|this|that|these|those|they|he|she|we|you|i|there|here|which|what|who|one|something|everything|nothing|someone|anyone|all|some|so|and|but|because|if|when|then|how|why|where|whether|while|also|just|really|now|my|your|our|their|his|her|its|me|us)\b/i;

const DEFINITION =
  /^(?:(?:so|and|but|now|basically|essentially|simply put|in short),?\s+)?((?:[\p{L}\p{N}'’-]+\s){0,5}?[\p{L}\p{N}'’-]+)\s+(is|are|was|were|means|refers to|is defined as|is known as|is called|describes)\s+(.{12,240})$/iu;

/** "What is X?" cards from sentences that define something. */
function definitionDraft(sentence: string, part: number, context: string): Draft | null {
  const m = DEFINITION.exec(sentence.replace(/[.!?]+["')\]]*$/, ""));
  if (!m) return null;
  const subject = m[1]!.trim();
  const verb = m[2]!.toLowerCase();
  let predicate = m[3]!.trim();
  if (PRONOUN.test(subject) || !words(subject).some(isContent)) return null;
  if (words(predicate).length < 3 || words(predicate).length > 30) return null;
  const vague =
    /^(?:not|also|just|really|very|going|gonna|like|about|kind of|sort of|to|that|because|why|how|what)\b/i;
  if (vague.test(predicate)) return null;
  // Lower-case a capital that only comes from starting the sentence: an
  // article, or a word the text also writes in lower case. Names stay.
  const first = subject.split(" ")[0]!;
  const lower = first.toLowerCase();
  const sentenceCase =
    first !== lower &&
    (/^(?:a|an|the)$/.test(lower) ||
      words(context).some((x) => x.replace(/[^\p{L}\p{N}'’-]/gu, "") === lower));
  const shown = sentenceCase ? lower + subject.slice(first.length) : subject;
  const question =
    verb === "means"
      ? `What does ${shown} mean?`
      : verb === "refers to"
        ? `What does ${shown} refer to?`
        : verb === "describes"
          ? `What does ${shown} describe?`
          : verb === "is called" || verb === "is known as"
            ? `What is ${shown} called?`
            : `What ${verb === "are" || verb === "were" ? "are" : "is"} ${shown}?`;
  predicate = predicate.charAt(0).toUpperCase() + predicate.slice(1);
  return {
    kind: "qa",
    front: question,
    back: predicate,
    quote: sentence,
    wrong: [],
    part,
  };
}

/** Word scores for a source: frequent, long content words matter most. */
function keywordScores(sentences: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const s of sentences)
    for (const word of words(s)) {
      if (!isContent(word)) continue;
      const n = norm(word);
      tf.set(n, (tf.get(n) ?? 0) + 1);
    }
  const scores = new Map<string, number>();
  for (const [n, f] of tf) scores.set(n, Math.log(1 + f) * Math.min(1.6, 0.6 + n.length / 10));
  return scores;
}

interface Target {
  start: number;
  end: number;
  score: number;
}

/** What could be blanked out of a sentence, best first: numbers, names, key terms. */
function clozeTargets(sentence: string, scores: Map<string, number>): Target[] {
  const cands: Target[] = [];
  // numbers with their unit: "1969", "40%", "3.5 million", "$20"
  for (const m of sentence.matchAll(
    /[$€£]?\d[\d,.]*(?:\s?(?:%|percent|million|billion|thousand|years?|days?|hours?|minutes?|km|kg|miles?))?/gi,
  )) {
    const t = m[0].replace(/[.,]+$/, "");
    if (t.replace(/\D/g, "").length === 0) continue;
    cands.push({ start: m.index!, end: m.index! + t.length, score: 2.2 });
  }
  // names: runs of capitalised words not at the very start
  for (const m of sentence.matchAll(
    /(?<=\s)(?:[A-Z][\p{L}'’-]+)(?:\s+(?:of\s+|the\s+)?[A-Z][\p{L}'’-]+)*/gu,
  )) {
    const t = m[0];
    if (t.length < 3 || PRONOUN.test(t)) continue;
    cands.push({
      start: m.index!,
      end: m.index! + t.length,
      score: 1.6 + words(t).length * 0.3,
    });
  }
  // key terms
  for (const m of sentence.matchAll(/[\p{L}][\p{L}'’-]{4,}/gu)) {
    const t = m[0];
    if (!isContent(t) || m.index === 0) continue;
    const s = scores.get(norm(t)) ?? 0;
    cands.push({ start: m.index!, end: m.index! + t.length, score: s });
  }
  return cands.filter((c) => c.score >= 0.9).sort((a, b) => b.score - a.score);
}

function clozeDraft(
  sentence: string,
  scores: Map<string, number>,
  part: number,
  taken: Set<string>,
): Draft | null {
  const ws = words(sentence);
  if (ws.length < 7 || ws.length > 40) return null;
  if (ws.filter(isContent).length / ws.length < 0.35) return null;
  // The same answer over and over teaches one word; each gap gets a new one.
  const t = clozeTargets(sentence, scores).find(
    (c) => !taken.has(normAnswer(sentence.slice(c.start, c.end))),
  );
  if (!t) return null;
  const back = sentence.slice(t.start, t.end);
  const front = `${sentence.slice(0, t.start)}${GAP}${sentence.slice(t.end)}`;
  return { kind: "cloze", front, back, quote: sentence, wrong: [], part };
}

/** How much a sentence is worth learning: its key words, per word. */
function sentenceScore(sentence: string, scores: Map<string, number>): number {
  const ws = words(sentence);
  const sum = ws.reduce((n, word) => n + (isContent(word) ? (scores.get(norm(word)) ?? 0) : 0), 0);
  return sum / Math.sqrt(ws.length || 1) + (/\d/.test(sentence) ? 0.4 : 0);
}

/** Cards from one part of a source, instantly and offline. */
export function quickDrafts(
  source: Source,
  part: Part,
  all: Part[],
  perPart = 5,
  /** Normalised answers already in the deck (see `normAnswer`); grows as cards are made. */
  taken = new Set<string>(),
): Draft[] {
  const sentences = all.flatMap((p) => p.text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? []);
  const scores = keywordScores(sentences);
  const mine = (part.text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? []).map((s) => s.trim());
  const drafts: Draft[] = [];
  const used = new Set<string>();
  for (const s of mine) {
    const d = definitionDraft(s, part.index, part.text);
    if (d) {
      drafts.push(d);
      used.add(s);
    }
  }
  const ranked = mine
    .filter((s) => !used.has(s))
    .map((s) => ({ s, score: sentenceScore(s, scores) }))
    .sort((a, b) => b.score - a.score);
  for (const { s } of ranked) {
    if (drafts.length >= perPart) break;
    const d = clozeDraft(s, scores, part.index, taken);
    if (d) {
      drafts.push(d);
      taken.add(normAnswer(d.back));
    }
  }
  // In reading order, so related cards are learned together.
  const order = (d: Draft) => part.text.indexOf(d.quote);
  return drafts.slice(0, perPart).sort((a, b) => order(a) - order(b));
}

/* ---- AI cards ---- */

const FOCUS: Record<FlashcardsPrefs["focus"], string> = {
  understanding:
    "Prefer understanding over trivia: why things happen, how they work, what they mean, cause and effect, comparisons, and how to apply them. Include the key names, numbers and definitions needed to explain the ideas.",
  facts:
    "Focus on the facts worth remembering: definitions, key terms, names, numbers, dates, steps and lists.",
  mixed:
    "Mix understanding (why, how, what it means, how to apply it) with the key facts (definitions, names, numbers, steps).",
};

export function draftPrompt(
  focus: FlashcardsPrefs["focus"],
  title: string,
  part: Part,
  parts: number,
  count: number,
  existing: string[],
): ChatMessage[] {
  const system = [
    "You write flashcards that help someone learn and remember material they saved (a video, podcast, article, course or note, converted to text).",
    "Rules:",
    "- Each card tests ONE idea from the material.",
    `- ${FOCUS[focus]}`,
    '- Every question must make sense on its own, without the material: name the subject. Never write "the speaker", "the author", "the text", "the video" or "according to the material".',
    "- Answers are short: a word, a phrase or one sentence, at most 20 words.",
    "- Stay faithful to the material and never invent facts. Skip small talk, jokes, ads, sponsor messages and anything trivial.",
    "- For each card give three wrong answers that sound plausible: the same kind of thing, similar length and style as the right answer.",
    "- Quote the short phrase or sentence from the material that the card is based on.",
    "",
    "Write each card exactly like this, with a blank line between cards and nothing else before or after:",
    "Q: <question>",
    "A: <answer>",
    "W: <wrong answer> | <wrong answer> | <wrong answer>",
    "S: <quote from the material>",
  ].join("\n");
  const avoid = existing.length
    ? `\n\nThese questions already exist; don't repeat them:\n${existing
        .slice(-40)
        .map((q) => `- ${q}`)
        .join("\n")}`
    : "";
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `MATERIAL (part ${part.index + 1} of ${parts} of "${title}"):\n${part.text}${avoid}\n\nWrite up to ${count} flashcards from this part. Fewer is fine if it has less worth learning.`,
    },
  ];
}

const FIELD =
  /^\s*(?:[-*•]\s*)?(?:\d+[.)]\s*)?(?:\*\*)?(Q|A|W|S|Question|Answer|Wrong|Source|Quote)(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.*?)\s*(?:\*\*)?\s*$/i;

const LABEL: Record<string, "q" | "a" | "w" | "s"> = {
  q: "q",
  question: "q",
  a: "a",
  answer: "a",
  w: "w",
  wrong: "w",
  s: "s",
  source: "s",
  quote: "s",
};

const strip = (s: string): string =>
  s
    .replace(/^[\s"“”'|:-]+|[\s"“”'|]+$/g, "")
    .replace(/\*\*/g, "")
    .trim();

/** Small models ramble past the length rule; a long answer keeps its first sentence. */
function brief(answer: string): string {
  if (words(answer).length <= 25) return answer;
  const first = /^.+?[.!?](?=\s|$)/.exec(answer)?.[0];
  return first && words(first).length >= 3 ? first : answer;
}

/**
 * Cards in the model's reply. Lenient about numbering, bold and spelled-out
 * labels. While streaming, `complete=false` holds back the last card, which
 * may still be arriving.
 */
export function parseDrafts(text: string, part: number, complete: boolean): Draft[] {
  const out: Draft[] = [];
  let cur: { q?: string; a?: string; w?: string; s?: string } = {};
  let last: keyof typeof cur | null = null;
  const flush = () => {
    const front = strip(cur.q ?? "");
    const back = brief(strip(cur.a ?? "")).replace(/\.$/, "");
    if (front.length >= 6 && back && front.length <= 400 && back.length <= 300) {
      out.push({
        kind: "qa",
        front,
        back,
        quote: strip(cur.s ?? "").slice(0, 500),
        wrong: (cur.w ?? "")
          .split(/\s*\|\s*|\s*;\s*/)
          .map((x) => strip(x).replace(/\.$/, ""))
          .filter((x) => x && !sameAnswer(x, back))
          .slice(0, 3),
        part,
      });
    }
    cur = {};
    last = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const m = FIELD.exec(line);
    if (m) {
      const key = LABEL[m[1]!.toLowerCase()] ?? "q";
      if (key === "q" && cur.q) flush();
      cur[key] = m[2]!;
      last = key;
    } else if (line.trim() && last && last !== "w") {
      // a wrapped line continues the field above it
      cur[last] = `${cur[last] ?? ""} ${line.trim()}`;
    }
  }
  if (complete) flush();
  return out;
}

/** Same question, ignoring case and punctuation. */
export function questionKey(front: string): string {
  return normAnswer(front.replace(GAP, "_"));
}

/* ============================================================= the AI ===== */

export interface ChatHandle {
  done: Promise<string>;
  cancel: () => void;
}

/** One request to the Tutor's models (on-device or a provider), streamed. */
export function streamChat(
  target: string,
  messages: ChatMessage[],
  on: { delta?: (all: string) => void; status?: (text: string) => void } = {},
): ChatHandle {
  const requestId = crypto.randomUUID();
  let text = "";
  let off = () => {};
  const done = new Promise<string>((resolve, reject) => {
    off = window.mypa.tutor.onChatEvent((e) => {
      if (e.requestId !== requestId) return;
      if (e.type === "delta") {
        text += e.text;
        on.delta?.(text);
      } else if (e.type === "status") on.status?.(e.text);
      else {
        off();
        if (e.type === "error") reject(new Error(e.message));
        else resolve(text);
      }
    });
    window.mypa.tutor.chat({ requestId, target, messages }).catch((err: unknown) => {
      off();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
  return { done, cancel: () => void window.mypa.tutor.cancel(requestId) };
}

/** The material around a card's quote, for explaining it. */
export function contextFor(card: Flashcard, source: Source | undefined, chars = 3_000): string {
  if (!source) return card.quote;
  const text = sentencesOf(source).join(" ");
  const probe = (card.quote || card.back).slice(0, 60);
  let at = probe ? text.indexOf(probe) : -1;
  if (at < 0) {
    const key = words(card.back).find(isContent);
    at = key ? text.toLowerCase().indexOf(key.toLowerCase()) : -1;
  }
  if (at < 0) return text.slice(0, chars);
  const start = Math.max(0, at - chars / 2);
  return text.slice(start, start + chars);
}

export function explainMessages(card: Flashcard, material: string): ChatMessage[] {
  const q = card.kind === "cloze" ? card.front.replace(GAP, "_____") : card.front;
  return [
    {
      role: "system",
      content: `${systemPrompt("intermediate")}\n\nMATERIAL:\n${material}`,
    },
    {
      role: "user",
      content: `Help me understand this flashcard.\nQuestion: ${q}\nAnswer: ${card.back}\n\nExplain the answer in 3 to 5 short sentences using the material: why it's true and how it connects to the bigger idea. Then give one memorable hook (an analogy, mnemonic or vivid example) on its own line starting with "Hook:".`,
    },
  ];
}

export function checkMessages(card: Flashcard, answer: string): ChatMessage[] {
  const q = card.kind === "cloze" ? card.front.replace(GAP, "_____") : card.front;
  return [
    {
      role: "system",
      content:
        "You grade a learner's flashcard answer by meaning, not wording. Synonyms, paraphrases and extra correct detail are fine; missing the key idea or stating something false is not. Reply with exactly one of RIGHT, PARTLY or WRONG on the first line, then one short, kind sentence of feedback on the second line.",
    },
    {
      role: "user",
      content: `Question: ${q}\nExpected answer: ${card.back}\nLearner's answer: ${answer}`,
    },
  ];
}

export function parseCheck(text: string): { verdict: Verdict; feedback: string } | null {
  const m = /\b(RIGHT|PARTLY|PARTIAL|WRONG|CORRECT|INCORRECT)\b/i.exec(text);
  if (!m) return null;
  const v = m[1]!.toUpperCase();
  const verdict: Verdict =
    v === "RIGHT" || v === "CORRECT"
      ? "right"
      : v === "WRONG" || v === "INCORRECT"
        ? "wrong"
        : "close";
  const feedback = text
    .slice(m.index + m[0].length)
    .replace(/^[\s:.\-–—]+/, "")
    .trim()
    .split(/\r?\n/)[0]!;
  return { verdict, feedback };
}

/* ============================================================= stats ====== */

export interface Counts {
  fresh: number;
  learning: number;
  young: number;
  mature: number;
  suspended: number;
}

/** A card counts as mature once it would hold for three weeks. */
export const MATURE_DAYS = 21;

export function counts(cards: Flashcard[]): Counts {
  const c: Counts = {
    fresh: 0,
    learning: 0,
    young: 0,
    mature: 0,
    suspended: 0,
  };
  for (const x of cards) {
    if (x.suspended) c.suspended++;
    else if (x.state === 0) c.fresh++;
    else if (x.state === 2) {
      if (x.stability >= MATURE_DAYS) c.mature++;
      else c.young++;
    } else c.learning++;
  }
  return c;
}

/** Consecutive study days, ending today (or yesterday, if not yet today). */
export function streak(days: Record<string, FlashDay>, now: number): number {
  let n = 0;
  let t = now;
  if (!days[studyDay(t)]?.reviews) t -= DAY;
  while (days[studyDay(t)]?.reviews) {
    n++;
    t -= DAY;
  }
  return n;
}

/** Share of learned cards remembered over the last `n` days, or null. */
export function retention(days: Record<string, FlashDay>, now: number, n = 30): number | null {
  let rev = 0;
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const d = days[studyDay(now - i * DAY)];
    rev += d?.rev ?? 0;
    ok += d?.revOk ?? 0;
  }
  return rev ? ok / rev : null;
}

/** Answers per day for the last `n` days, oldest first. */
export function history(days: Record<string, FlashDay>, now: number, n = 14) {
  const out: {
    key: string;
    label: string;
    reviews: number;
    minutes: number;
  }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = now - i * DAY;
    const d = days[studyDay(t)];
    out.push({
      key: studyDay(t),
      label: new Date(t - ROLLOVER).toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
      }),
      reviews: d?.reviews ?? 0,
      minutes: (d?.ms ?? 0) / MIN,
    });
  }
  return out;
}

/** Learned cards coming due on each of the next `n` days (today includes overdue). */
export function forecast(cards: Flashcard[], now: number, n = 14) {
  const out: { key: string; label: string; due: number }[] = [];
  for (let i = 0; i < n; i++) {
    const end = studyDayStart(now, i + 1);
    const start = i === 0 ? -Infinity : studyDayStart(now, i);
    const t = studyDayStart(now, i);
    out.push({
      key: studyDay(t),
      label:
        i === 0
          ? "Today"
          : i === 1
            ? "Tomorrow"
            : new Date(t).toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
              }),
      due: cards.filter((c) => !c.suspended && c.state !== 0 && c.due >= start && c.due < end)
        .length,
    });
  }
  return out;
}

/** Cards you struggle with most: forgotten often, or rated hard. */
export function hardest(cards: Flashcard[], n = 5): Flashcard[] {
  return cards
    .filter((c) => c.reps > 0 && !c.suspended && (c.lapses > 0 || c.difficulty >= 7))
    .sort((a, b) => b.lapses - a.lapses || b.difficulty - a.difficulty)
    .slice(0, n);
}

/** Recall chance right now for a learned card. */
export function recallNow(card: Flashcard, now: number): number | null {
  if (card.state === 0 || !card.lastReview) return null;
  return retrievability((now - card.lastReview) / DAY, card.stability);
}
