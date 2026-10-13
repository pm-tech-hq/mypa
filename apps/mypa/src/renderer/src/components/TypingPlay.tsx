import { useEffect, useMemo, useRef, useState } from "react";

import { Lightbulb, RotateCcw } from "lucide-react";

import {
  gapRanges,
  recallCueLength,
  scoreRecall,
  words,
  wpm,
  type GapDensity,
  type RecallResult,
  type Stage,
} from "../lib/typing";
import { Button } from "./ui/button";

/** What one finished passage produced. */
export interface Attempt {
  stage: Stage;
  score: number;
  ms: number;
  /** copy and gaps only */
  chars?: number;
  keystrokes?: number;
  errors?: number;
  missed?: Record<string, number>;
  /** gaps: hidden words typed right / hidden words */
  gaps?: [number, number];
  /** recall: key words recalled / key words */
  recalled?: [number, number];
  hinted?: boolean;
  /** Each completed word and how long it took per character. */
  wordTimes?: [string, number][];
  /** Set on a timed sprint: its length in seconds. */
  sprint?: number;
  /** Set when saved: this beat the previous best. */
  newBest?: boolean;
}

export interface TyperOptions {
  stopOnError: boolean;
  ignoreCase: boolean;
  sounds: boolean;
  showLive: boolean;
}

/* ------------------------------------------------------------- sounds ---- */

let audio: AudioContext | null = null;

/** A soft tick per key, a low buzz for a mistake. */
function keySound(bad: boolean) {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = bad ? "square" : "triangle";
    osc.frequency.value = bad ? 170 : 1300 + Math.random() * 250;
    gain.gain.setValueAtTime(bad ? 0.04 : 0.025, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (bad ? 0.09 : 0.03));
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch {
    /* no audio device: stay silent */
  }
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------- typing ---- */

export function Typer({
  text,
  gaps,
  options,
  timeLimitMs,
  onDone,
}: {
  text: string;
  /** Hide some words (Fill the gaps). */
  gaps: GapDensity | null;
  options: TyperOptions;
  /** A timed sprint: stops when the time is up. */
  timeLimitMs?: number;
  onDone: (a: Attempt) => void;
}) {
  const [typed, setTyped] = useState("");
  const [focused, setFocused] = useState(true);
  const [finished, setFinished] = useState(false);
  const [, tick] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const started = useRef<number | null>(null);
  const strokes = useRef(0);
  const errors = useRef(0);
  const missed = useRef<Record<string, number>>({});
  const wordStart = useRef<number | null>(null);
  const wordTimes = useRef<[string, number][]>([]);
  const doneRef = useRef(false);

  const ranges = useMemo(() => (gaps ? gapRanges(text, gaps) : []), [text, gaps]);
  const hidden = useMemo(() => {
    const h = new Uint8Array(text.length);
    for (const [a, b] of ranges) h.fill(1, a, b);
    return h;
  }, [text, ranges]);

  const same = (a: string | undefined, b: string | undefined) =>
    a !== undefined &&
    b !== undefined &&
    (options.ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b);

  useEffect(() => input.current?.focus(), []);

  const finish = (v: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setFinished(true);
    const ms = timeLimitMs
      ? Math.min(timeLimitMs, Date.now() - (started.current ?? Date.now()))
      : Date.now() - (started.current ?? Date.now());
    let correct = 0;
    for (let i = 0; i < v.length; i++) if (same(v[i], text[i])) correct++;
    const accuracy = strokes.current ? (strokes.current - errors.current) / strokes.current : 1;
    const right = ranges.filter(([a, b]) =>
      [...text.slice(a, b)].every((ch, j) => same(v[a + j], ch)),
    ).length;
    onDone({
      stage: gaps ? 1 : 0,
      score: gaps ? (ranges.length ? right / ranges.length : 1) : accuracy,
      ms,
      chars: correct,
      keystrokes: strokes.current,
      errors: errors.current,
      missed: missed.current,
      gaps: gaps ? [right, ranges.length] : undefined,
      wordTimes: wordTimes.current,
      sprint: timeLimitMs ? Math.round(timeLimitMs / 1000) : undefined,
    });
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const typedRef = useRef(typed);
  typedRef.current = typed;

  // Live speed once a second; a sprint also ends here when time runs out.
  useEffect(() => {
    const t = window.setInterval(
      () => {
        if (!started.current || doneRef.current) return;
        if (timeLimitMs && Date.now() - started.current >= timeLimitMs)
          finishRef.current(typedRef.current);
        else tick((n) => n + 1);
      },
      timeLimitMs ? 200 : 1000,
    );
    return () => window.clearInterval(t);
  }, [timeLimitMs]);

  // Keep the caret in view when the text is longer than the box (sprints).
  useEffect(() => {
    const el = box.current;
    const caret = el?.querySelector<HTMLElement>(".is-caret");
    if (!el || !caret) return;
    // Show the line before the caret's at the top, aligned to whole lines.
    const line = parseFloat(getComputedStyle(el).lineHeight) || 30;
    const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
    const caretLine = Math.floor((caret.offsetTop - pad + caret.offsetHeight / 2) / line);
    const want = Math.max(0, (caretLine - 1) * line);
    if (el.scrollTop !== want) el.scrollTop = want;
  }, [typed]);

  const restart = () => {
    setTyped("");
    setFinished(false);
    doneRef.current = false;
    started.current = null;
    strokes.current = 0;
    errors.current = 0;
    missed.current = {};
    wordStart.current = null;
    wordTimes.current = [];
    if (box.current) box.current.scrollTop = 0;
    input.current?.focus();
  };

  const change = (value: string) => {
    if (doneRef.current) return;
    let v = value.replace(/\n/g, "").slice(0, text.length);
    if (v.length > typed.length) {
      const now = Date.now();
      started.current ??= now;
      wordStart.current ??= now;
      for (let i = typed.length; i < v.length; i++) {
        strokes.current++;
        const ok = same(v[i], text[i]);
        if (options.sounds) keySound(!ok);
        if (!ok) {
          errors.current++;
          const k = text[i]!.toLowerCase();
          missed.current[k] = (missed.current[k] ?? 0) + 1;
          if (options.stopOnError) {
            // The wrong key isn't taken: fix it before moving on.
            v = v.slice(0, i);
            break;
          }
        } else if (text[i] === " " || i === text.length - 1) {
          const end = text[i] === " " ? i : i + 1;
          const startIdx = text.lastIndexOf(" ", end - 1) + 1;
          const word = text.slice(startIdx, end).replace(/[^\p{L}\p{N}'-]/gu, "");
          if (word.length >= 3 && wordStart.current)
            wordTimes.current.push([word.toLowerCase(), (now - wordStart.current) / word.length]);
          wordStart.current = now;
        }
      }
    }
    setTyped(v);
    // A rejected key leaves the text unchanged; still refresh the live stats.
    if (v === typed) tick((n) => n + 1);
    if (v.length === text.length) finish(v);
  };

  const elapsed = started.current ? Date.now() - started.current : 0;
  let correctSoFar = 0;
  for (let i = 0; i < typed.length; i++) if (same(typed[i], text[i])) correctSoFar++;

  const tokens = useMemo(() => {
    const out: { start: number; text: string }[] = [];
    const re = /\S+\s*|\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push({ start: m.index, text: m[0] });
    return out;
  }, [text]);

  return (
    <div className="typ__stagebox">
      <div
        ref={box}
        className={`typ__text${timeLimitMs ? " is-sprint" : ""}${focused || finished ? "" : " is-blurred"}`}
        onMouseDown={(e) => {
          e.preventDefault();
          input.current?.focus();
        }}
      >
        {tokens.map((tok) => (
          <span key={tok.start} className="typ__word">
            {[...tok.text].map((ch, j) => {
              const i = tok.start + j;
              const isHidden = hidden[i] === 1;
              let cls = "typ__ch";
              let shown = ch;
              if (i < typed.length) {
                const ok = same(typed[i], ch);
                cls += ok ? " is-ok" : " is-bad";
                if (!ok && isHidden) shown = typed[i] === " " ? "·" : typed[i]!;
              } else if (isHidden) {
                cls += " is-hidden";
              }
              if (isHidden) cls += " is-gap";
              if (i === typed.length && !finished) cls += " is-caret";
              return (
                <span key={j} className={cls}>
                  {shown}
                </span>
              );
            })}
          </span>
        ))}
        {!focused && !finished && <span className="typ__resume">Click to keep typing</span>}
      </div>
      <textarea
        ref={input}
        className="typ__input"
        value={typed}
        aria-label={gaps ? "Type the passage, including the hidden words" : "Type the passage"}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
        onPaste={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
          if (e.key === "Escape" && !finished) {
            e.preventDefault();
            e.stopPropagation();
            restart();
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <div className="typ__live num">
        {timeLimitMs ? (
          <span className="typ__clock" aria-live="off">
            {clock(started.current ? timeLimitMs - elapsed : timeLimitMs)}
          </span>
        ) : null}
        {options.showLive && (
          <>
            <span>{wpm(correctSoFar, elapsed)} wpm</span>
            <span>
              {strokes.current
                ? Math.round(((strokes.current - errors.current) / strokes.current) * 100)
                : 100}
              %
            </span>
            {!timeLimitMs && (
              <span>
                {words(typed).length} / {words(text).length} words
              </span>
            )}
          </>
        )}
        {!finished && (
          <button type="button" className="typ__restart" onClick={restart} title="Restart (Esc)">
            <RotateCcw size={12} />
            Restart
            <kbd className="typ__kbd">Esc</kbd>
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- recall ---- */

export function Recall({
  text,
  done,
  onDone,
}: {
  text: string;
  done: boolean;
  onDone: (a: Attempt) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<RecallResult | null>(null);
  const [hint, setHint] = useState(false);
  const opened = useRef(Date.now());
  const input = useRef<HTMLTextAreaElement>(null);
  const cueLen = recallCueLength(text);
  const cue = words(text).slice(0, cueLen).join(" ");
  // First letters of what comes next: enough to jog memory, not to copy.
  const skeleton = words(text)
    .slice(cueLen)
    .map((w) =>
      w.replace(
        /^([^\p{L}\p{N}]*[\p{L}\p{N}])([\p{L}\p{N}'-]*)/u,
        (_, a: string, b: string) => a + "·".repeat(b.length),
      ),
    )
    .join(" ");

  useEffect(() => input.current?.focus(), []);

  const check = (giveUp = false) => {
    if (result) return;
    const r = scoreRecall(text, giveUp ? "" : answer);
    setResult(r);
    const content = r.marks.filter((m) => m.content);
    onDone({
      stage: 2,
      // A hint helps you recall, so it counts for a bit less.
      score: hint ? r.score * 0.75 : r.score,
      ms: Date.now() - opened.current,
      recalled: [content.filter((m) => m.got).length, content.length],
      hinted: hint,
    });
  };

  if (result) {
    return (
      <div className="typ__stagebox">
        <p className="typ__reveal">
          <span className="typ__cue">{cue} </span>
          {result.marks.map((m, i) => (
            <span
              key={i}
              className={m.content ? (m.got ? "typ__w is-got" : "typ__w is-missed") : "typ__w"}
            >
              {m.word}{" "}
            </span>
          ))}
        </p>
        {answer.trim() && <p className="typ__yours">You wrote: {answer.trim()}</p>}
      </div>
    );
  }

  return (
    <div className="typ__stagebox">
      <p className="typ__reveal">
        <span className="typ__cue">{cue}</span>
        {hint ? (
          <span className="typ__skeleton"> {skeleton}</span>
        ) : (
          <span className="typ__ellipsis"> …</span>
        )}
      </p>
      <textarea
        ref={input}
        className="typ__answer"
        value={answer}
        disabled={done}
        placeholder="Type what comes next, in your own words if you need to."
        aria-label="What comes next"
        spellCheck={false}
        onChange={(e) => setAnswer(e.target.value)}
        onPaste={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            check();
          }
        }}
      />
      <div className="typ__recall-actions">
        {!hint && (
          <button type="button" className="typ__giveup" onClick={() => setHint(true)}>
            <Lightbulb size={12} />
            Hint
          </button>
        )}
        <button type="button" className="typ__giveup" onClick={() => check(true)}>
          Show me
        </button>
        <Button size="sm" disabled={!answer.trim()} onClick={() => check()}>
          Check
          <kbd className="typ__kbd">Ctrl ↵</kbd>
        </Button>
      </div>
    </div>
  );
}
