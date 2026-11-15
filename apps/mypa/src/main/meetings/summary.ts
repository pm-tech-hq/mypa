/**
 * Meeting notes from a transcript: a short summary, the decisions made and
 * who agreed to do what. Written for small on-device models: a fixed plain
 * text format instead of JSON, and long meetings summarized a part at a time
 * and then combined, so no single prompt is longer than the model handles well.
 */
import { randomUUID } from "node:crypto";

import type { ChatMessage } from "../../shared/tutor";
import type { MeetingActionItem } from "../../shared/types";
import * as tutorConfig from "../tutor/config";
import { streamLocal } from "../tutor/local";
import { streamProvider } from "../tutor/providers";

export interface MeetingNotes {
  title: string | null;
  summary: string;
  decisions: string[];
  actionItems: MeetingActionItem[];
}

/** Characters per prompt: about 1,500 tokens on the built-in model. */
const LOCAL_PART = 6_000;
const PROVIDER_PART = 40_000;

const SYSTEM = [
  "You write meeting notes from a transcript of a call.",
  'Each line looks like "[m:ss] Name: words". "User" is the person who recorded the meeting and will read the notes; the others are named or called "Speaker 1", "Speaker 2" and so on.',
  "Only use what the transcript says. Never invent names, dates, numbers or decisions. The transcript was made by speech recognition, so a few words may be wrong.",
].join("\n");

const FORMAT = [
  "Write the notes in exactly this format, with these four headings:",
  "TITLE: a short name for the meeting, 3 to 6 words",
  "SUMMARY:",
  "2 to 5 sentences: what the meeting was about and what came out of it.",
  "DECISIONS:",
  "- one line per decision that was made (write - None if there were none)",
  "ACTION ITEMS:",
  "- Name: what they agreed to do, and by when if it was said (write - None if nobody agreed to do anything)",
  'Start each action item with the name of who will do it, exactly as the transcript writes it. Include what "User" said they will do.',
].join("\n");

type Ask = (messages: ChatMessage[], signal: AbortSignal) => Promise<string>;

/** "local" or a provider id → a function that asks it and returns the whole answer. */
function asker(ai: string): { ask: Ask; part: number } {
  if (ai !== "local") {
    const provider = tutorConfig.getProviderWithKey(ai);
    if (!provider) throw new Error("That AI provider no longer exists. Choose another in settings.");
    return {
      part: PROVIDER_PART,
      ask: async (messages, signal) => {
        let text = "";
        await streamProvider(provider, messages, signal, (t) => (text += t));
        return text;
      },
    };
  }
  return {
    part: LOCAL_PART,
    ask: async (messages, signal) => {
      // If the model goes quiet (it can, when memory runs short), give up
      // rather than leave the notes "being written" forever.
      const stall = new AbortController();
      const stop = () => stall.abort();
      signal.addEventListener("abort", stop);
      let timer = setTimeout(stop, FIRST_WORD_MS);
      let text = "";
      try {
        await streamLocal(
          randomUUID(),
          tutorConfig.getLocalModel(),
          messages,
          stall.signal,
          (t) => {
            text += t;
            clearTimeout(timer);
            timer = setTimeout(stop, NEXT_WORD_MS);
          },
          () => {
            // downloading or loading the model: still alive
            clearTimeout(timer);
            timer = setTimeout(stop, FIRST_WORD_MS);
          },
          true,
        );
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
      }
      if (stall.signal.aborted && !signal.aborted)
        throw new Error("The built-in model stopped responding. Try again.");
      return text;
    },
  };
}

/** Reading the prompt comes before the first word; downloading and loading
 *  the model report progress, which restarts this wait. */
const FIRST_WORD_MS = 3 * 60_000;
const NEXT_WORD_MS = 90_000;

/** Splits at line breaks into parts of at most `size` characters. */
export function splitLines(text: string, size: number): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > size) {
      parts.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${line}` : line.slice(0, size);
  }
  if (cur) parts.push(cur);
  return parts;
}

/**
 * The model's notes, with action items it can be trusted with. Small
 * on-device models summarize well but mix up who said what, so with the
 * built-in model the action items are the promises people made in their
 * own words ("I'll send…"), whose speaker the transcript already knows.
 */
export async function writeNotes(
  transcript: string,
  ai: string,
  signal: AbortSignal,
  onProgress: (pct: number) => void,
): Promise<MeetingNotes> {
  const notes = await askForNotes(transcript, ai, signal, onProgress);
  const promised = commitments(transcript);
  if (ai === "local" || notes.actionItems.length === 0) notes.actionItems = promised;
  return notes;
}

/** "I'll", "I will", "I'm going to". ("Let me…" is nearly always something
 *  done there and then: "let me share my screen".) */
const PROMISE = /\bI(?:'ll| will| shall|'m going to| am going to)\s+/gi;
/** "I'll be honest", "I will say": figures of speech, not promises. */
const NOT_A_TASK =
  /^(?:be (?:honest|frank|brief|quick|there in a sec)|say|tell you (?:what|this)|admit|think|guess|bet|see what you mean|just say|leave it)\b/i;
/** "I'll do it": true, but says nothing on its own. */
const VAGUE = /^(?:do|handle|fix|check|send|take care of|look (?:into|at)|sort out) (?:it|that|this|them)$/i;

/** What people said they'd do, by who said it. */
export function commitments(transcript: string): MeetingActionItem[] {
  const out: MeetingActionItem[] = [];
  const seen = new Set<string>();
  for (const line of transcript.split("\n")) {
    const m = /^\[[^\]]*\] ([^:]+): (.*)$/.exec(line);
    if (!m) continue;
    const owner = m[1]!.trim();
    for (const sentence of m[2]!.split(/(?<=[.!?])\s+/)) {
      // "I'll check with legal and I'll let you know" is two promises
      const starts = [...sentence.matchAll(PROMISE)];
      starts.forEach((p, i) => {
        const task = sentence
          .slice(p.index + p[0].length, starts[i + 1]?.index ?? sentence.length)
          .replace(/^(?:also|definitely|just|then|probably|try to)\s+/i, "")
          .replace(/(?:[\s,;]+(?:and|but|so))?[.!?,;\s]*$/i, "")
          .trim();
        if (task.split(/\s+/).length < 2 || NOT_A_TASK.test(task) || VAGUE.test(task)) return;
        const key = `${owner}|${task.toLowerCase().split(/\s+/).slice(0, 5).join(" ")}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ owner, text: task[0]!.toUpperCase() + task.slice(1), taskId: null });
      });
    }
  }
  return out;
}

async function askForNotes(
  transcript: string,
  ai: string,
  signal: AbortSignal,
  onProgress: (pct: number) => void,
): Promise<MeetingNotes> {
  const { ask, part } = asker(ai);
  // Small models read "Me" as somebody's odd name and hand your tasks to
  // whoever spoke before you; "User" they get right.
  const parts = splitLines(transcript.replace(/^(\[[^\]]*\]) Me:/gm, "$1 User:"), part);

  if (parts.length === 1) {
    onProgress(10);
    const answer = await ask(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `TRANSCRIPT:\n${parts[0]}\n\n${FORMAT}` },
      ],
      signal,
    );
    return parseNotes(answer);
  }

  // Long meeting: notes on each part, then one set of notes from those.
  const notes: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (signal.aborted) throw new Error("Stopped.");
    onProgress((i / (parts.length + 1)) * 100);
    const answer = await ask(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `TRANSCRIPT (part ${i + 1} of ${parts.length}):\n${parts[i]}\n\nWrite short notes on this part as "- " bullets: the main points, any decisions, and any tasks someone agreed to do (who, what, by when). Keep the names exactly as written. Only what this part says.`,
        },
      ],
      signal,
    );
    notes.push(`PART ${i + 1}:\n${clean(answer)}`);
  }
  onProgress((parts.length / (parts.length + 1)) * 100);
  // Notes are far shorter than the transcript, but keep the final prompt in bounds too.
  const combined = splitLines(notes.join("\n\n"), part * 1.5)[0]!;
  const answer = await ask(
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `These are notes on each part of one meeting, in order:\n\n${combined}\n\nNow write the notes for the whole meeting. ${FORMAT}`,
      },
    ],
    signal,
  );
  return parseNotes(answer);
}

/** Reasoning models (Qwen 3, DeepSeek) may think aloud first; drop that. */
function clean(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*<\/think>/i, "")
    .trim();
}

type Section = "title" | "summary" | "decisions" | "actions";

// A heading is the word alone or followed by a colon, so a sentence that
// merely starts with "Tasks…" isn't one.
const HEADING: [RegExp, Section][] = [
  [/^(?:meeting\s+)?title\s*(?::|$)/i, "title"],
  [/^summary\s*(?::|$)/i, "summary"],
  [/^(?:key\s+)?decisions?(?:\s+made)?\s*(?::|$)/i, "decisions"],
  [/^(?:action\s*items?|next\s*steps|tasks)\s*(?::|$)/i, "actions"],
];

/** "None", "N/A", "None were made.", "No decisions were made." */
function isNone(line: string): boolean {
  const t = line.trim();
  return (
    t.length < 50 &&
    /^(?:none|n\/a|nothing|no (?:decisions?|action items?|tasks?|one))\b/i.test(t)
  );
}

/** Reads the model's answer, tolerating markdown headings, bold and stray numbering. */
export function parseNotes(answer: string): MeetingNotes {
  const sections: Record<Section, string[]> = { title: [], summary: [], decisions: [], actions: [] };
  let current: Section | null = null;
  for (const raw of clean(answer).split("\n")) {
    const line = raw.replace(/\*\*/g, "").replace(/^#+\s*/, "").trim();
    if (!line) continue;
    // small models sometimes write a heading as a bullet: "- Action items:"
    const bare = line.replace(/^(?:[-*•]|\d+[.)])\s*/, "");
    const heading = HEADING.find(([re]) => re.test(bare));
    if (heading) {
      current = heading[1];
      const rest = bare.replace(heading[0], "").trim();
      if (rest) sections[current].push(rest);
      continue;
    }
    if (current) sections[current].push(line);
  }

  const bullets = (lines: string[]) =>
    lines
      .map((l) => l.replace(/^(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter((l) => l && !isNone(l));

  const actionItems = bullets(sections.actions).map((line): MeetingActionItem => {
    const m = /^([^:]{1,40}):\s*(.+)$/.exec(line);
    if (!m) {
      // "User will …": still yours
      const mine = /^(?:the )?user\b\s*/i.exec(line);
      return mine
        ? { owner: "Me", text: toYou(line.slice(mine[0].length).replace(/^will\s+/i, "")), taskId: null }
        : { owner: null, text: toYou(line), taskId: null };
    }
    const owner = m[1]!.trim();
    return {
      owner: /^(?:the )?user$/i.test(owner) ? "Me" : owner,
      text: toYou(m[2]!.trim()),
      taskId: null,
    };
  });

  const summary = sections.summary.join(" ").trim();
  return {
    title: sections.title[0]?.replace(/^["']|["'.]$/g, "").trim().slice(0, 80) || null,
    // A model that ignored the format still wrote something useful: keep it as the summary.
    summary: toYou(summary || (current === null ? clean(answer).slice(0, 2000) : "")),
    decisions: bullets(sections.decisions).map(toYou),
    actionItems,
  };
}

/** The notes are for the user: "User agreed…" reads "You agreed…". */
function toYou(text: string): string {
  return text.replace(/\b(?:the )?user('s)?\b/gi, (match, possessive: string | undefined, at: number) => {
    const word = possessive ? "your" : "you";
    const sentenceStart = at === 0 || /[.!?]\s+$/.test(text.slice(0, at));
    return sentenceStart ? word[0]!.toUpperCase() + word.slice(1) : word;
  });
}
