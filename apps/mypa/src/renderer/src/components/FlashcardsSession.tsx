import { useEffect, useMemo, useRef, useState } from "react";

import {
  AlertTriangle,
  Check,
  EyeOff,
  Lightbulb,
  Loader2,
  Pencil,
  Sparkles,
  Undo2,
  Volume2,
  X,
} from "lucide-react";

import type { FlashDay, Flashcard, FlashcardsPrefs } from "../../../shared/types";
import {
  askMode,
  checkAnswer,
  checkMessages,
  choicesFor,
  contextFor,
  explainMessages,
  GAP,
  GRADE_LABEL,
  intervalLabel,
  isLeech,
  LEARN_AHEAD,
  outcomes,
  parseCheck,
  spokenFront,
  streamChat,
  studyDay,
  SUGGESTED,
  type AskMode,
  type ChatHandle,
  type Check as AnswerCheck,
  type Grade,
  type Verdict,
} from "../lib/flashcards";
import { Speaker } from "../lib/tutor";
import { words, type Source } from "../lib/typing";
import type { Session } from "./FlashcardsWidget";
import { Markdown } from "./Markdown";
import { Button } from "./ui/button";

export interface SessionResult {
  title: string;
  answered: number;
  /** Answers graded Hard or better. */
  remembered: number;
  fresh: number;
  ms: number;
  /** Cards still in their learning steps, due back later today. */
  later: number;
}

interface Shown {
  id: string;
  mode: AskMode;
  options: string[];
  at: number;
  /** Bumped every presentation, so late async results can tell they're stale. */
  n: number;
}

interface Undo {
  before: Flashcard;
  day: { key: string; value: FlashDay | undefined } | null;
  graded: Grade | null;
}

const MODE_HINT: Record<AskMode, string> = {
  choice: "Pick the answer",
  type: "Type the answer",
  flip: "Answer in your head, then check",
};

const STATE_LABEL = ["New", "Learning", "Review", "Relearning"] as const;

interface Props {
  session: Session;
  cards: Record<string, Flashcard>;
  all: Flashcard[];
  prefs: FlashcardsPrefs;
  sources: Map<string, Source>;
  ai: string;
  days: Record<string, FlashDay>;
  onGrade: (card: Flashcard, grade: Grade, ms: number) => Flashcard;
  onRestore: (card: Flashcard, day: { key: string; value: FlashDay | undefined }) => void;
  onSave: (card: Flashcard) => void;
  onExit: (result: SessionResult) => void;
}

export function FlashcardsSession({
  session,
  cards,
  all,
  prefs,
  sources,
  ai,
  days,
  onGrade,
  onRestore,
  onSave,
  onExit,
}: Props) {
  const pending = useRef<string[]>([...session.ids]);
  const members = useRef(new Set([...session.ids, ...session.learning]));
  const counter = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const speaker = useMemo(() => new Speaker(), []);
  const explainHandle = useRef<ChatHandle | null>(null);
  const checkHandle = useRef<ChatHandle | null>(null);

  const [shown, setShown] = useState<Shown | null>(null);
  const [phase, setPhase] = useState<"next" | "ask" | "shown">("next");
  const [typed, setTyped] = useState("");
  const [check, setCheck] = useState<AnswerCheck | null>(null);
  const [aiVerdict, setAiVerdict] = useState<
    { busy: true } | { busy: false; verdict: Verdict; feedback: string } | null
  >(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [suggested, setSuggested] = useState<Grade>(3);
  const [explain, setExplain] = useState<{
    text: string;
    busy: boolean;
    error?: string;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [undo, setUndo] = useState<Undo[]>([]);
  const [tally, setTally] = useState({
    answered: 0,
    remembered: 0,
    fresh: 0,
    ms: 0,
  });
  const tallyRef = useRef(tally);
  tallyRef.current = tally;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const card = shown ? cards[shown.id] : undefined;

  const stopAsync = () => {
    explainHandle.current?.cancel();
    explainHandle.current = null;
    checkHandle.current?.cancel();
    checkHandle.current = null;
    speaker.stop();
  };
  useEffect(() => () => stopAsync(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const result = (): SessionResult => {
    const now = Date.now();
    const later = [...members.current].filter((id) => {
      const c = cardsRef.current[id];
      return c && !c.suspended && (c.state === 1 || c.state === 3) && c.due > now;
    }).length;
    return { title: session.title, ...tallyRef.current, later };
  };

  const present = (c: Flashcard) => {
    stopAsync();
    const options = choicesFor(c, all);
    const mode = askMode(c, prefs.mode, options.length);
    counter.current += 1;
    setShown({
      id: c.id,
      mode,
      options: mode === "choice" ? options : [],
      at: Date.now(),
      n: counter.current,
    });
    setPhase("ask");
    setTyped("");
    setCheck(null);
    setAiVerdict(null);
    setPicked(null);
    setSuggested(3);
    setExplain(null);
    setEditing(false);
    if (prefs.readAloud) void speaker.speak(spokenFront(c), { engine: "system", voice: "" });
  };

  const live = (id: string) => {
    const c = cardsRef.current[id];
    return c && !c.suspended ? c : null;
  };
  /** Queued cards not answered yet. A card leaves the queue once it's graded. */
  const queued = () =>
    pending.current
      .map(live)
      .filter((c): c is Flashcard => !!c && (c.state === 0 || c.state === 2));
  const inSteps = () =>
    [...members.current]
      .map(live)
      .filter((c): c is Flashcard => !!c && (c.state === 1 || c.state === 3))
      .sort((a, b) => a.due - b.due);

  /** Learning cards that are due come first, then the queue, then learning
   *  cards a little early rather than making you wait. Doesn't change
   *  anything, so running it twice picks the same card. */
  const choose = (now: number): Flashcard | null => {
    const learning = inSteps();
    if (learning[0] && learning[0].due <= now) return learning[0];
    const next = queued()[0];
    if (next) return next;
    if (learning[0] && learning[0].due <= now + LEARN_AHEAD) return learning[0];
    return null;
  };

  useEffect(() => {
    if (phase !== "next") return;
    const next = choose(Date.now());
    if (next) present(next);
    else onExit(result());
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard focus follows the card, so shortcuts work without clicking first.
  useEffect(() => {
    if (!shown || editing) return;
    if (phase === "shown" || shown.mode !== "type") rootRef.current?.focus({ preventScroll: true });
  }, [phase, shown, editing]);

  const remaining = useMemo(() => {
    const soon = Date.now() + LEARN_AHEAD;
    const ids = new Set(queued().map((c) => c.id));
    for (const c of inSteps()) if (c.due <= soon) ids.add(c.id);
    if (shown) ids.add(shown.id);
    return ids.size;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, shown, phase]);

  const preview = useMemo(
    () => (card && phase === "shown" ? outcomes(card, Date.now(), prefs.retention) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card?.id, card?.reps, phase, prefs.retention],
  );

  if (!card || !shown) {
    return (
      <div className="fc fc--session">
        <p className="fc__sub">Loading…</p>
      </div>
    );
  }

  /* -------------------------------------------------------------- actions */

  const reveal = (verdict?: Verdict) => {
    speaker.stop();
    if (verdict) setSuggested(SUGGESTED[verdict]);
    setPhase("shown");
  };

  const submitTyped = (giveUp = false) => {
    const answer = giveUp ? "" : typed;
    const res = checkAnswer(answer, card.back);
    setCheck(res);
    reveal(res.verdict);
    // Cloud models answer in a second, so ask straight away. The built-in one
    // can take a while (and download first), so it waits for a click.
    if (!giveUp && canAskAi(answer, res.verdict) && ai !== "local") askAi(answer);
  };

  const canAskAi = (answer: string, v: Verdict) =>
    v !== "right" &&
    prefs.aiCheck &&
    ai !== "off" &&
    words(answer).length >= 2 &&
    words(card.back).length >= 2;

  const askAi = (answer: string) => {
    const n = shown.n;
    setAiVerdict({ busy: true });
    const h = streamChat(ai, checkMessages(card, answer));
    checkHandle.current = h;
    h.done
      .then((text) => {
        if (counter.current !== n) return;
        const parsed = parseCheck(text);
        if (!parsed) return setAiVerdict(null);
        setAiVerdict({ busy: false, ...parsed });
        setSuggested(SUGGESTED[parsed.verdict]);
      })
      .catch(() => counter.current === n && setAiVerdict(null));
  };

  const choose4 = (i: number) => {
    if (phase !== "ask" || shown.mode !== "choice" || i >= shown.options.length) return;
    setPicked(i);
    reveal(shown.options[i] === card.back ? "right" : "wrong");
  };

  const grade = (g: Grade) => {
    if (phase !== "shown") return;
    const ms = Date.now() - shown.at;
    const key = studyDay(Date.now());
    setUndo((u) => [...u.slice(-19), { before: card, day: { key, value: days[key] }, graded: g }]);
    setTally((t) => ({
      answered: t.answered + 1,
      remembered: t.remembered + (g > 1 ? 1 : 0),
      fresh: t.fresh + (card.state === 0 ? 1 : 0),
      ms: t.ms + Math.min(ms, 90_000),
    }));
    onGrade(card, g, ms);
    members.current.add(card.id);
    pending.current = pending.current.filter((id) => id !== card.id);
    setPhase("next");
  };

  const suspend = () => {
    setUndo((u) => [...u.slice(-19), { before: card, day: null, graded: null }]);
    onSave({ ...card, suspended: true });
    pending.current = pending.current.filter((id) => id !== card.id);
    setPhase("next");
  };

  const undoLast = () => {
    const last = undo.at(-1);
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    if (last.day) onRestore(last.before, last.day);
    else onSave(last.before);
    if (last.graded)
      setTally((t) => ({
        answered: Math.max(0, t.answered - 1),
        remembered: Math.max(0, t.remembered - (last.graded! > 1 ? 1 : 0)),
        fresh: Math.max(0, t.fresh - (last.before.state === 0 ? 1 : 0)),
        ms: t.ms,
      }));
    // The card on screen stays queued (it isn't graded yet); the undone one goes first.
    if (last.before.state === 0 || last.before.state === 2)
      pending.current = [last.before.id, ...pending.current.filter((id) => id !== last.before.id)];
    present(last.before);
  };

  const runExplain = () => {
    if (ai === "off") return;
    explainHandle.current?.cancel();
    setExplain({ text: "", busy: true });
    const h = streamChat(ai, explainMessages(card, contextFor(card, sources.get(card.sourceId))), {
      delta: (text) => setExplain({ text, busy: true }),
      status: (text) =>
        setExplain((e) => (e && !e.text ? { text: "", busy: true, error: text } : e)),
    });
    explainHandle.current = h;
    const n = shown.n;
    h.done
      .then((text) => counter.current === n && setExplain({ text, busy: false }))
      .catch(
        (err: unknown) =>
          counter.current === n &&
          setExplain({
            text: "",
            busy: false,
            error: `Couldn't explain: ${err instanceof Error ? err.message : String(err)}`,
          }),
      );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || editing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undoLast();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const digit = /^[1-4]$/.test(e.key) ? (Number(e.key) as Grade) : null;
    if (phase === "ask") {
      if (shown.mode === "choice" && digit) {
        e.preventDefault();
        choose4(digit - 1);
      } else if (shown.mode === "flip" && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        reveal();
      }
    } else if (phase === "shown") {
      if (digit) {
        e.preventDefault();
        grade(digit);
      } else if (e.key === " " || e.key === "Enter") {
        if ((e.target as HTMLElement).tagName === "BUTTON" && e.target !== rootRef.current) return;
        e.preventDefault();
        grade(suggested);
      }
    }
  };

  /* --------------------------------------------------------------- render */

  const [before, after] = card.kind === "cloze" ? splitGap(card.front) : [card.front, ""];
  const isRevealed = phase === "shown";
  const verdict: Verdict | null =
    aiVerdict && !aiVerdict.busy ? aiVerdict.verdict : (check?.verdict ?? null);

  return (
    <div className="fc fc--session" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="fc__bar">
        <span className="fc__left num" title="Cards left in this session">
          {remaining} left
        </span>
        <span className={`fc__state fc__state--${card.state}`}>{STATE_LABEL[card.state]}</span>
        <span className="fc__from" title={card.sourceTitle}>
          {card.sourceTitle}
        </span>
        <button
          type="button"
          className="fc__icon"
          aria-label="Undo last answer"
          title="Undo last answer (Ctrl+Z)"
          disabled={!undo.length}
          onClick={undoLast}
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          className={`fc__icon${editing ? " is-on" : ""}`}
          aria-label="Edit card"
          title="Edit card"
          onClick={() => setEditing((v) => !v)}
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          className="fc__icon"
          aria-label="Suspend card"
          title="Suspend: stop showing this card"
          onClick={suspend}
        >
          <EyeOff size={13} />
        </button>
        <button
          type="button"
          className="fc__icon"
          aria-label="End session"
          title="End session"
          onClick={() => onExit(result())}
        >
          <X size={14} />
        </button>
      </div>

      {editing ? (
        <EditCard
          card={card}
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            onSave(next);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <div className={`fc__card${isRevealed ? " is-revealed" : ""}`}>
            <p className="fc__mode">
              {isRevealed ? "Answer" : MODE_HINT[shown.mode]}
              {prefs.readAloud || isRevealed ? null : (
                <button
                  type="button"
                  className="fc__speak"
                  aria-label="Read the question aloud"
                  title="Read aloud"
                  onClick={() =>
                    void speaker.speak(spokenFront(card), {
                      engine: "system",
                      voice: "",
                    })
                  }
                >
                  <Volume2 size={12} />
                </button>
              )}
            </p>
            <p className="fc__front">
              {before}
              {card.kind === "cloze" && (
                <span className={`fc__gap${isRevealed ? " is-filled" : ""}`}>
                  {isRevealed ? card.back : " ".repeat(Math.min(18, Math.max(6, card.back.length)))}
                </span>
              )}
              {after}
            </p>
            {isRevealed && card.kind === "qa" && shown.mode !== "choice" && (
              <p className="fc__back">{card.back}</p>
            )}
          </div>

          {shown.mode === "choice" && (
            <div
              className={`fc__choices${isRevealed ? " is-revealed" : ""}`}
              role="group"
              aria-label="Choices"
            >
              {shown.options.map((o, i) => {
                const right = o === card.back;
                // Once answered, only the right answer (and a wrong pick) stay.
                if (isRevealed && !right && picked !== i) return null;
                const cls = !isRevealed ? "" : right ? " is-right" : " is-wrong";
                return (
                  <button
                    key={`${shown.n}-${i}`}
                    type="button"
                    className={`fc__choice${cls}`}
                    disabled={isRevealed}
                    onClick={() => choose4(i)}
                  >
                    <kbd className="fc__kbd">{i + 1}</kbd>
                    <span>{o}</span>
                    {isRevealed && right && <Check size={14} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}

          {shown.mode === "type" && !isRevealed && (
            <form
              className="fc__type"
              onSubmit={(e) => {
                e.preventDefault();
                submitTyped();
              }}
            >
              <input
                className="field"
                autoFocus
                value={typed}
                placeholder={card.kind === "cloze" ? "Fill the gap" : "Type your answer"}
                aria-label="Your answer"
                onChange={(e) => setTyped(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={!typed.trim()}>
                Check
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => submitTyped(true)}>
                I don&apos;t know
              </Button>
            </form>
          )}

          {shown.mode === "flip" && !isRevealed && (
            <div className="fc__actions">
              <Button onClick={() => reveal()}>
                Show answer <kbd className="fc__kbd fc__kbd--on">Space</kbd>
              </Button>
            </div>
          )}

          {isRevealed && (
            <div className="fc__after">
              {check && (
                <div className={`fc__verdict fc__verdict--${verdict}`}>
                  <p className="fc__verdict-head">
                    {verdict === "right"
                      ? "Right"
                      : verdict === "close"
                        ? "Nearly"
                        : typed.trim()
                          ? "Not quite"
                          : "Here's the answer"}
                    {aiVerdict?.busy && (
                      <span className="fc__checking">
                        <Loader2 size={12} className="fc__spin" /> Checking the meaning…
                      </span>
                    )}
                  </p>
                  {typed.trim() && (
                    <p className="fc__yours">
                      <span>You wrote</span> {typed}
                    </p>
                  )}
                  {aiVerdict && !aiVerdict.busy && aiVerdict.feedback && (
                    <p className="fc__feedback">{aiVerdict.feedback}</p>
                  )}
                  {!aiVerdict && check.verdict !== "right" && canAskAi(typed, check.verdict) && (
                    <button
                      type="button"
                      className="fc__link fc__ask-ai"
                      onClick={() => askAi(typed)}
                    >
                      <Sparkles size={12} />
                      Ask the AI if I meant the same thing
                    </button>
                  )}
                  {typed.trim() && words(card.back).length > 3 && verdict !== "right" && (
                    <p className="fc__marks" aria-label="Key words you had">
                      {check.marks.map((m, i) => (
                        <span key={i} className={m.got ? "is-got" : undefined}>
                          {m.word}{" "}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )}

              {prefs.showQuote && card.quote && card.kind === "qa" && (
                <blockquote className="fc__quote">
                  <span>From {card.sourceTitle}</span>“{card.quote}”
                </blockquote>
              )}

              {isLeech(card) && (
                <p className="fc__leech">
                  <AlertTriangle size={13} />
                  <span>
                    You&apos;ve forgotten this {card.lapses} times. Rewording it in your own words
                    usually helps more than seeing it again.
                  </span>
                  <button type="button" className="fc__link" onClick={() => setEditing(true)}>
                    Reword
                  </button>
                </p>
              )}

              {ai !== "off" &&
                (explain ? (
                  <div className="fc__explain">
                    {explain.text ? (
                      <Markdown text={explain.text} className="fc__md" />
                    ) : explain.error && !explain.busy ? (
                      <p className="fc__error">{explain.error}</p>
                    ) : (
                      <p className="fc__thinking">
                        <Loader2 size={12} className="fc__spin" />
                        {explain.error || "Thinking…"}
                      </p>
                    )}
                  </div>
                ) : (
                  <button type="button" className="fc__link fc__explain-btn" onClick={runExplain}>
                    <Lightbulb size={12} />
                    Explain this
                  </button>
                ))}
            </div>
          )}

          {isRevealed && preview && (
            <div className="fc__grades" role="group" aria-label="How well did you know it?">
              {([1, 2, 3, 4] as Grade[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`fc__grade fc__grade--${g}${suggested === g ? " is-suggested" : ""}`}
                  onClick={() => grade(g)}
                  title={`${GRADE_LABEL[g]} (${g})`}
                >
                  <span className="fc__grade-label">{GRADE_LABEL[g]}</span>
                  <span className="fc__grade-when num">
                    {intervalLabel(preview[g].due, Date.now())}
                  </span>
                </button>
              ))}
            </div>
          )}
          {isRevealed && (
            <p className="fc__keys">
              <kbd className="fc__kbd">1</kbd>–<kbd className="fc__kbd">4</kbd> to rate ·{" "}
              <kbd className="fc__kbd">Space</kbd> for {GRADE_LABEL[suggested]}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function splitGap(front: string): [string, string] {
  const i = front.indexOf(GAP);
  return i < 0 ? [front, ""] : [front.slice(0, i), front.slice(i + GAP.length)];
}

/** Edits a card in place. A cloze keeps its gap as "____" while editing. */
export function EditCard({
  card,
  onSave,
  onCancel,
}: {
  card: Flashcard;
  onSave: (card: Flashcard) => void;
  onCancel: () => void;
}) {
  const [front, setFront] = useState(card.front.replace(GAP, "____"));
  const [back, setBack] = useState(card.back);
  const [wrong, setWrong] = useState(card.wrong.join(" | "));
  const cloze = /_{3,}/.test(front);
  const save = () => {
    const f = front.trim();
    const b = back.trim();
    if (!f || !b) return;
    onSave({
      ...card,
      kind: cloze ? "cloze" : "qa",
      front: cloze ? f.replace(/_{3,}/, GAP) : f,
      back: b,
      wrong: wrong
        .split("|")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 5),
    });
  };
  return (
    <form
      className="fc__edit"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label>
        <span>{cloze ? "Sentence (the gap is ____)" : "Question"}</span>
        <textarea
          className="field fc__textarea"
          rows={3}
          value={front}
          autoFocus
          onChange={(e) => setFront(e.target.value)}
        />
      </label>
      <label>
        <span>Answer</span>
        <input className="field" value={back} onChange={(e) => setBack(e.target.value)} />
      </label>
      <label>
        <span>Wrong answers for multiple choice, separated by |</span>
        <input
          className="field"
          value={wrong}
          placeholder="Optional"
          onChange={(e) => setWrong(e.target.value)}
        />
      </label>
      <p className="fc__hint">Tip: write “____” in the question to make it fill-in-the-blank.</p>
      <div className="fc__actions">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!front.trim() || !back.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}
