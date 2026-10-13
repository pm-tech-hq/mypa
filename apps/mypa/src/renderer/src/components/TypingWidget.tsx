import { useEffect, useMemo, useRef, useState } from "react";

import { BookOpen, ChevronDown, Flame, Keyboard, X } from "lucide-react";

import type { TypingCard, TypingDay, WidgetRow } from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import {
  collectSources,
  dayKey,
  gapRanges,
  nextCard,
  nextDue,
  PASS,
  passagesOf,
  pickRound,
  recallCueLength,
  ROUND_SIZE,
  scoreRecall,
  STAGE_HINT,
  STAGE_LABEL,
  streak,
  when,
  words,
  wpm,
  type RecallResult,
  type RoundItem,
  type Stage,
} from "../lib/typing";
import "../styles/typing.css";
import { Button } from "./ui/button";

/** What one finished passage produced. */
interface Attempt {
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
}

const MAX_HUMAN_WPM = 250;

const EMPTY_DAY: TypingDay = { ms: 0, chars: 0, keystrokes: 0, errors: 0, passages: 0 };

/**
 * A typing trainer over your own transcripts and notes. Each passage climbs
 * three steps — copy it, fill in hidden words, recall it from a cue — and
 * comes back on a widening schedule, so you get faster and remember more.
 */
export function TypingWidget({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const s = widget.settings;
  const chosen = s.typingSources ?? null;
  const cards = useMemo(() => s.typingCards ?? {}, [s.typingCards]);
  const days = useMemo(() => s.typingDays ?? {}, [s.typingDays]);
  const keys = useMemo(() => s.typingKeys ?? {}, [s.typingKeys]);
  const best = s.typingBestWpm ?? 0;

  const sources = useMemo(
    () => collectSources(snapshot.transcripts, snapshot.widgets),
    [snapshot.transcripts, snapshot.widgets],
  );
  const selected = useMemo(
    () => (chosen === null ? sources : sources.filter((x) => chosen.includes(x.id))),
    [sources, chosen],
  );
  const passages = useMemo(() => selected.flatMap(passagesOf), [selected]);

  const [now, setNow] = useState(() => Date.now());
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [round, setRound] = useState<RoundItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [current, setCurrent] = useState<Attempt | null>(null);

  // Keep "due" counts honest while the widget sits on the board.
  useEffect(() => {
    if (round) return;
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [round]);

  const upNext = useMemo(() => pickRound(passages, cards, now), [passages, cards, now]);
  const reviews = upNext.filter((r) => cards[r.passage.id]).length;
  const fresh = upNext.length - reviews;
  const soonest = useMemo(() => nextDue(passages, cards), [passages, cards]);
  const learned = passages.filter((p) => (cards[p.id]?.box ?? 0) >= 2).length;
  const today = days[dayKey(now)] ?? EMPTY_DAY;
  const run = streak(days, now);
  const weakKeys = Object.entries(keys)
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const toggleSource = (id: string) => {
    const cur = chosen ?? sources.map((x) => x.id);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    void actions.updateWidgetSettings(widget.id, {
      typingSources: next.length === sources.length ? null : next,
    });
  };

  const start = (practiceAnyway = false) => {
    const t = Date.now();
    const r = pickRound(passages, cards, t, practiceAnyway);
    if (!r.length) return;
    setNow(t);
    setRound(r);
    setIndex(0);
    setAttempts([]);
    setCurrent(null);
  };

  const quit = () => {
    setRound(null);
    setCurrent(null);
    setNow(Date.now());
  };

  /** Saves one attempt: the passage's schedule, today's totals, missed keys. */
  const record = (item: RoundItem, a: Attempt) => {
    const t = Date.now();
    const card: TypingCard = nextCard(cards[item.passage.id], item.stage, a.score, t);
    const key = dayKey(t);
    const d = days[key] ?? EMPTY_DAY;
    const nextKeys = { ...keys };
    for (const [k, n] of Object.entries(a.missed ?? {})) nextKeys[k] = (nextKeys[k] ?? 0) + n;
    const speed = a.chars !== undefined ? wpm(a.chars, a.ms) : 0;
    void actions.updateWidgetSettings(widget.id, {
      typingCards: { ...cards, [item.passage.id]: card },
      typingDays: {
        ...days,
        [key]: {
          ms: d.ms + a.ms,
          chars: d.chars + (a.chars ?? 0),
          keystrokes: d.keystrokes + (a.keystrokes ?? 0),
          errors: d.errors + (a.errors ?? 0),
          passages: d.passages + 1,
        },
      },
      typingKeys: nextKeys,
      // A whole passage at 95%+ accuracy counts; a lucky burst doesn't, and
      // neither does text that arrived faster than anyone types (autofill, IME).
      typingBestWpm:
        a.keystrokes &&
        (a.keystrokes - (a.errors ?? 0)) / a.keystrokes >= 0.95 &&
        speed <= MAX_HUMAN_WPM
          ? Math.max(best, speed)
          : best,
    });
    setCurrent(a);
    setAttempts((xs) => [...xs, a]);
  };

  const next = () => {
    setCurrent(null);
    setIndex((i) => i + 1);
  };

  /* ---------------------------------------------------------------- views */

  if (!sources.length) {
    return (
      <div className="typ">
        <div className="blankstate">
          <span className="blankstate__icon">
            <Keyboard size={16} />
          </span>
          <p className="blankstate__title">Nothing to type yet</p>
          <p className="blankstate__text">
            Transcribe a video or article, or write a note. It turns into typing practice here.
          </p>
        </div>
      </div>
    );
  }

  if (round && index < round.length) {
    const item = round[index]!;
    return (
      <div className="typ">
        <div className="typ__bar">
          <span
            className="typ__progress num"
            aria-label={`Passage ${index + 1} of ${round.length}`}
          >
            {round.map((r, i) => (
              <i
                key={r.passage.id}
                className={i < index ? "is-done" : i === index ? "is-current" : undefined}
              />
            ))}
          </span>
          <span className={`typ__stage typ__stage--${item.stage}`}>{STAGE_LABEL[item.stage]}</span>
          <span className="typ__from" title={item.passage.sourceTitle}>
            {item.passage.sourceTitle}
          </span>
          <button
            type="button"
            className="typ__quit"
            aria-label="End round"
            title="End round"
            onClick={quit}
          >
            <X size={14} />
          </button>
        </div>
        <p className="typ__hint">{STAGE_HINT[item.stage]}</p>

        {item.stage === 2 ? (
          <Recall
            key={`${index}-${item.passage.id}`}
            text={item.passage.text}
            done={current !== null}
            onDone={(a) => record(item, a)}
          />
        ) : (
          <Typer
            key={`${index}-${item.passage.id}`}
            text={item.passage.text}
            gaps={item.stage === 1}
            onDone={(a) => record(item, a)}
          />
        )}

        {current && (
          <div className="typ__result" role="status">
            <span
              className={
                current.score >= PASS[item.stage] ? "typ__verdict is-pass" : "typ__verdict"
              }
            >
              {verdict(item.stage, current)}
            </span>
            <span className="typ__result-detail num">{detail(current)}</span>
            <Button size="sm" autoFocus onClick={next}>
              {index + 1 < round.length ? "Next" : "Finish"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (round) {
    const typed = attempts.filter((a) => a.chars !== undefined);
    const ms = typed.reduce((n, a) => n + a.ms, 0);
    const chars = typed.reduce((n, a) => n + (a.chars ?? 0), 0);
    const strokes = typed.reduce((n, a) => n + (a.keystrokes ?? 0), 0);
    const errors = typed.reduce((n, a) => n + (a.errors ?? 0), 0);
    const recalls = attempts.filter((a) => a.recalled);
    const moved = attempts.filter((a) => a.score >= PASS[a.stage]).length;
    return (
      <div className="typ">
        <div className="typ__summary">
          <p className="typ__summary-title">Round done</p>
          <dl className="typ__figures">
            {typed.length > 0 && (
              <>
                <div>
                  <dt>Speed</dt>
                  <dd className="num">{wpm(chars, ms)} wpm</dd>
                </div>
                <div>
                  <dt>Accuracy</dt>
                  <dd className="num">
                    {strokes ? Math.round(((strokes - errors) / strokes) * 100) : 100}%
                  </dd>
                </div>
              </>
            )}
            {recalls.length > 0 && (
              <div>
                <dt>Recalled</dt>
                <dd className="num">
                  {Math.round((recalls.reduce((n, a) => n + a.score, 0) / recalls.length) * 100)}%
                </dd>
              </div>
            )}
            <div>
              <dt>Moved up</dt>
              <dd className="num">
                {moved} of {attempts.length}
              </dd>
            </div>
          </dl>
          <div className="typ__summary-actions">
            <Button variant="outline" size="sm" onClick={quit}>
              Done
            </Button>
            <Button size="sm" autoFocus onClick={() => start(true)}>
              Another round
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="typ">
      <button
        type="button"
        className="typ__sources-toggle"
        aria-expanded={sourcesOpen}
        onClick={() => setSourcesOpen((v) => !v)}
      >
        <BookOpen size={13} />
        <span>
          Practising from {selected.length} of {sources.length}{" "}
          {sources.length === 1 ? "source" : "transcripts and notes"}
        </span>
        <ChevronDown size={13} className="typ__sources-caret" />
      </button>
      {sourcesOpen && (
        <div className="typ__sources">
          {sources.map((x) => (
            <label key={x.id}>
              <input
                type="checkbox"
                checked={chosen === null || chosen.includes(x.id)}
                onChange={() => toggleSource(x.id)}
              />
              <span>{x.title}</span>
              <em>{x.kind === "note" ? "Note" : "Transcript"}</em>
            </label>
          ))}
        </div>
      )}

      <div className="typ__home">
        {upNext.length > 0 ? (
          <>
            <p className="typ__lead">
              {reviews > 0 && fresh > 0
                ? `${reviews} to review, ${fresh} new`
                : reviews > 0
                  ? `${reviews} to review`
                  : `${fresh} new passage${fresh === 1 ? "" : "s"}`}
            </p>
            <p className="typ__sub">
              A round is up to {ROUND_SIZE} short passages, about two minutes.
            </p>
            <figure className="typ__peek">
              <figcaption>
                Up first · {STAGE_LABEL[upNext[0]!.stage]} · {upNext[0]!.passage.sourceTitle}
              </figcaption>
              <p>{upNext[0]!.passage.text}</p>
            </figure>
            <Button onClick={() => start()}>Start round</Button>
          </>
        ) : passages.length === 0 ? (
          <>
            <p className="typ__lead">Nothing long enough to practise</p>
            <p className="typ__sub">Pick more sources above, or add a longer note or transcript.</p>
          </>
        ) : (
          <>
            <p className="typ__lead">All caught up</p>
            <p className="typ__sub">
              {soonest !== null ? `The next review is ${when(soonest, now)}.` : "Nothing is due."}
            </p>
            <Button variant="outline" onClick={() => start(true)}>
              Practise anyway
            </Button>
          </>
        )}
      </div>

      <dl className="typ__stats">
        <div>
          <dt>Streak</dt>
          <dd className="num">
            {run > 0 && <Flame size={12} aria-hidden="true" />}
            {run} {run === 1 ? "day" : "days"}
          </dd>
        </div>
        <div>
          <dt>Today</dt>
          <dd className="num">
            {today.ms > 0 && today.ms < 60_000
              ? "Under 1 min"
              : `${Math.round(today.ms / 60_000)} min`}
          </dd>
        </div>
        <div>
          <dt>Best</dt>
          <dd className="num">{best} wpm</dd>
        </div>
        <div>
          <dt>Learned</dt>
          <dd className="num">
            {learned} of {passages.length}
          </dd>
        </div>
      </dl>

      {weakKeys.length > 0 && (
        <p className="typ__keys">
          <span>Keys you miss most</span>
          {weakKeys.map(([k]) => (
            <kbd key={k}>{k === " " ? "space" : k}</kbd>
          ))}
        </p>
      )}
    </div>
  );
}

function verdict(stage: Stage, a: Attempt): string {
  const passed = a.score >= PASS[stage];
  if (stage === 0)
    return passed ? "Next time: fill the gaps" : "Again soon, a little more carefully";
  if (stage === 1) return passed ? "Next: recall it tomorrow" : "Again soon";
  return passed ? "Remembered. It comes back later" : "Back to the gaps for this one";
}

function detail(a: Attempt): string {
  const parts: string[] = [];
  if (a.gaps) parts.push(`${a.gaps[0]} of ${a.gaps[1]} hidden words`);
  if (a.recalled) parts.push(`${a.recalled[0]} of ${a.recalled[1]} key words`);
  if (a.chars !== undefined) {
    parts.push(`${wpm(a.chars, a.ms)} wpm`);
    if (a.keystrokes)
      parts.push(
        `${Math.round(((a.keystrokes - (a.errors ?? 0)) / a.keystrokes) * 100)}% accuracy`,
      );
  }
  return parts.join(" · ");
}

/* ------------------------------------------------------------- typing ---- */

function Typer({
  text,
  gaps,
  onDone,
}: {
  text: string;
  gaps: boolean;
  onDone: (a: Attempt) => void;
}) {
  const [typed, setTyped] = useState("");
  const [focused, setFocused] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const started = useRef<number | null>(null);
  const strokes = useRef(0);
  const errors = useRef(0);
  const missed = useRef<Record<string, number>>({});
  const finished = useRef(false);
  const [, tick] = useState(0);

  const ranges = useMemo(() => (gaps ? gapRanges(text) : []), [text, gaps]);
  const hidden = useMemo(() => {
    const h = new Uint8Array(text.length);
    for (const [a, b] of ranges) h.fill(1, a, b);
    return h;
  }, [text, ranges]);

  useEffect(() => input.current?.focus(), []);

  // Refresh the live speed once a second while typing.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (started.current && !finished.current) tick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const change = (value: string) => {
    if (finished.current) return;
    const v = value.replace(/\n/g, "").slice(0, text.length);
    if (v.length > typed.length) {
      started.current ??= Date.now();
      for (let i = typed.length; i < v.length; i++) {
        strokes.current++;
        if (v[i] !== text[i]) {
          errors.current++;
          const k = text[i]!.toLowerCase();
          missed.current[k] = (missed.current[k] ?? 0) + 1;
        }
      }
    }
    setTyped(v);
    if (v.length === text.length) {
      finished.current = true;
      const ms = Date.now() - (started.current ?? Date.now());
      let correct = 0;
      for (let i = 0; i < text.length; i++) if (v[i] === text[i]) correct++;
      const accuracy = strokes.current ? (strokes.current - errors.current) / strokes.current : 1;
      const right = ranges.filter(
        ([a, b]) => v.slice(a, b).toLowerCase() === text.slice(a, b).toLowerCase(),
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
      });
    }
  };

  const elapsed = started.current ? Date.now() - started.current : 0;
  let correctSoFar = 0;
  for (let i = 0; i < typed.length; i++) if (typed[i] === text[i]) correctSoFar++;

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
        className={`typ__text${focused || finished.current ? "" : " is-blurred"}`}
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
                const ok = typed[i] === ch;
                cls += ok ? " is-ok" : " is-bad";
                if (!ok && isHidden) shown = typed[i] === " " ? "·" : typed[i]!;
              } else if (isHidden) {
                cls += " is-hidden";
              }
              if (isHidden) cls += " is-gap";
              if (i === typed.length && !finished.current) cls += " is-caret";
              return (
                <span key={j} className={cls}>
                  {shown}
                </span>
              );
            })}
          </span>
        ))}
        {!focused && !finished.current && <span className="typ__resume">Click to keep typing</span>}
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
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <p className="typ__live num" aria-hidden="true">
        <span>{wpm(correctSoFar, elapsed)} wpm</span>
        <span>
          {strokes.current
            ? Math.round(((strokes.current - errors.current) / strokes.current) * 100)
            : 100}
          %
        </span>
        <span>
          {words(typed).length} / {words(text).length} words
        </span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- recall ---- */

function Recall({
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
  const opened = useRef(Date.now());
  const input = useRef<HTMLTextAreaElement>(null);
  const cue = words(text).slice(0, recallCueLength(text)).join(" ");

  useEffect(() => input.current?.focus(), []);

  const check = (giveUp = false) => {
    if (result) return;
    const r = scoreRecall(text, giveUp ? "" : answer);
    setResult(r);
    const content = r.marks.filter((m) => m.content);
    onDone({
      stage: 2,
      score: r.score,
      ms: Date.now() - opened.current,
      recalled: [content.filter((m) => m.got).length, content.length],
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
        <span className="typ__ellipsis"> …</span>
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
