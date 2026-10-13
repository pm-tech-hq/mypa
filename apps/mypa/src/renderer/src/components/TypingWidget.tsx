import { useEffect, useMemo, useState } from "react";

import { BookOpen, Check, ChevronDown, Flame, Keyboard, Play, Timer, X, Zap } from "lucide-react";

import {
  DEFAULT_TYPING_PREFS,
  type TypingCard,
  type TypingDay,
  type TypingPrefs,
  type WidgetRow,
} from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import {
  collectSources,
  dayKey,
  drillRound,
  history,
  nextCard,
  nextDue,
  PASS,
  passagesOf,
  pickRound,
  sourceProgress,
  speedRound,
  sprintText,
  STAGE_HINT,
  STAGE_LABEL,
  streak,
  typeable,
  when,
  wpm,
  type RoundItem,
  type Stage,
} from "../lib/typing";
import "../styles/typing.css";
import { Recall, Typer, type Attempt } from "./TypingPlay";
import { Button } from "./ui/button";

const MAX_HUMAN_WPM = 250;
const SPRINTS = [30, 60, 120];

const EMPTY_DAY: TypingDay = { ms: 0, chars: 0, keystrokes: 0, errors: 0, passages: 0 };

type Round = { items: RoundItem[]; kind: "learn" | "speed" | "drill" | "sprint" };

/**
 * A typing trainer over your own transcripts and notes. Each passage climbs
 * three steps — copy it, fill in hidden words, recall it from a cue — and
 * comes back on a widening schedule, so you get faster and remember more.
 * Speed practice, drills and timed sprints sit alongside for pure speed.
 */
export function TypingWidget({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const s = widget.settings;
  const prefs: TypingPrefs = { ...DEFAULT_TYPING_PREFS, ...s.typingPrefs };
  const chosen = s.typingSources ?? null;
  const cards = useMemo(() => s.typingCards ?? {}, [s.typingCards]);
  const days = useMemo(() => s.typingDays ?? {}, [s.typingDays]);
  const keys = useMemo(() => s.typingKeys ?? {}, [s.typingKeys]);
  const sprintBest = s.typingSprintBest ?? {};
  const best = s.typingBestWpm ?? 0;

  const sources = useMemo(
    () => collectSources(snapshot.transcripts, snapshot.widgets),
    [snapshot.transcripts, snapshot.widgets],
  );
  const selected = useMemo(
    () => (chosen === null ? sources : sources.filter((x) => chosen.includes(x.id))),
    [sources, chosen],
  );
  const bySource = useMemo(
    () => new Map(sources.map((x) => [x.id, passagesOf(x, prefs.length)])),
    [sources, prefs.length],
  );
  const passages = useMemo(
    () => selected.flatMap((x) => bySource.get(x.id) ?? []),
    [selected, bySource],
  );

  const [now, setNow] = useState(() => Date.now());
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [round, setRound] = useState<Round | null>(null);
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [current, setCurrent] = useState<Attempt | null>(null);

  // Keep "due" counts honest while the widget sits on the board.
  useEffect(() => {
    if (round) return;
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [round]);

  const setPrefs = (patch: Partial<TypingPrefs>) =>
    void actions.updateWidgetSettings(widget.id, { typingPrefs: { ...s.typingPrefs, ...patch } });

  const upNext = useMemo(
    () => pickRound(passages, cards, now, false, prefs.roundSize, prefs.skipCopy),
    [passages, cards, now, prefs.roundSize, prefs.skipCopy],
  );
  const reviews = upNext.filter((r) => cards[r.passage.id]).length;
  const fresh = upNext.length - reviews;
  const soonest = useMemo(() => nextDue(passages, cards), [passages, cards]);
  const progress = sourceProgress(passages, cards);
  const today = days[dayKey(now)] ?? EMPTY_DAY;
  const run = streak(days, now);
  const chart = useMemo(() => history(days, now, 14), [days, now]);
  const week = chart.slice(-7).filter((d) => d.wpm > 0 && d.wpm <= MAX_HUMAN_WPM);
  const weekWpm = week.length ? Math.round(week.reduce((n, d) => n + d.wpm, 0) / week.length) : 0;
  const weakKeys = Object.entries(keys)
    .filter(([k, n]) => n >= 3 && k.trim())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
  const goalMin = prefs.dailyGoalMin;
  const todayMin = today.ms / 60_000;

  const toggleSource = (id: string) => {
    const cur = chosen ?? sources.map((x) => x.id);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    void actions.updateWidgetSettings(widget.id, {
      typingSources: next.length === sources.length ? null : next,
    });
  };

  const begin = (items: RoundItem[], kind: Round["kind"]) => {
    if (!items.length) return;
    setNow(Date.now());
    setRound({ items, kind });
    setIndex(0);
    setAttempts([]);
    setCurrent(null);
  };

  const startLearn = (practiceAnyway = false, from = passages) =>
    begin(
      pickRound(from, cards, Date.now(), practiceAnyway, prefs.roundSize, prefs.skipCopy),
      "learn",
    );
  const startSpeed = () => begin(speedRound(passages, prefs.roundSize), "speed");
  const startDrill = (opts: { keys?: string[]; words?: string[] }) =>
    begin(drillRound(passages, opts, Math.min(3, prefs.roundSize)), "drill");
  const startSprint = () =>
    begin(
      [
        {
          passage: {
            id: `sprint-${Date.now()}`,
            sourceId: "sprint",
            sourceTitle: `${prefs.sprintSeconds}-second sprint`,
            text: sprintText(passages),
          },
          stage: 0,
          free: true,
        },
      ],
      "sprint",
    );

  const quit = () => {
    setRound(null);
    setCurrent(null);
    setNow(Date.now());
  };

  /** Saves one attempt: the passage's schedule, today's totals, missed keys, bests. */
  const record = (item: RoundItem, a: Attempt) => {
    const t = Date.now();
    const key = dayKey(t);
    const d = days[key] ?? EMPTY_DAY;
    const nextKeys = { ...keys };
    for (const [k, n] of Object.entries(a.missed ?? {})) nextKeys[k] = (nextKeys[k] ?? 0) + n;
    const speed = a.chars !== undefined ? wpm(a.chars, a.ms) : 0;
    const accurate = !!a.keystrokes && (a.keystrokes - (a.errors ?? 0)) / a.keystrokes >= 0.95;
    // A lucky burst doesn't count, and neither does text that arrived faster
    // than anyone types (autofill, IME).
    const believable = accurate && speed <= MAX_HUMAN_WPM;
    const patch: Parameters<typeof actions.updateWidgetSettings>[1] = {
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
    };
    if (!item.free) {
      const card: TypingCard = nextCard(cards[item.passage.id], item.stage, a.score, t);
      patch.typingCards = { ...cards, [item.passage.id]: card };
    }
    let newBest = false;
    if (a.sprint) {
      if (believable && speed > (sprintBest[a.sprint] ?? 0)) {
        patch.typingSprintBest = { ...sprintBest, [a.sprint]: speed };
        newBest = true;
      }
    } else if (believable && speed > best && speed > 0) {
      patch.typingBestWpm = speed;
      newBest = true;
    }
    void actions.updateWidgetSettings(widget.id, patch);
    const done = { ...a, newBest };
    setCurrent(done);
    setAttempts((xs) => [...xs, done]);
  };

  const next = () => {
    setCurrent(null);
    setIndex((i) => i + 1);
  };

  const fontClass = `typ typ--fs-${prefs.fontSize}`;
  const options = {
    stopOnError: prefs.stopOnError,
    ignoreCase: prefs.ignoreCase,
    sounds: prefs.sounds,
    showLive: prefs.showLive,
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

  /* ----- playing ----- */
  if (round && index < round.items.length) {
    const item = round.items[index]!;
    const isSprint = round.kind === "sprint";
    const label = isSprint
      ? "Sprint"
      : round.kind === "drill"
        ? "Drill"
        : round.kind === "speed"
          ? "Speed"
          : STAGE_LABEL[item.stage];
    const text = typeable(item.passage.text, prefs.ignorePunctuation);
    return (
      <div className={fontClass}>
        <div className="typ__bar">
          {round.items.length > 1 && (
            <span
              className="typ__progress num"
              aria-label={`Passage ${index + 1} of ${round.items.length}`}
            >
              {round.items.map((r, i) => (
                <i
                  key={r.passage.id}
                  className={i < index ? "is-done" : i === index ? "is-current" : undefined}
                />
              ))}
            </span>
          )}
          <span
            className={`typ__stage typ__stage--${round.kind === "learn" ? item.stage : "free"}`}
          >
            {label}
          </span>
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
        <p className="typ__hint">
          {isSprint
            ? "Type as much as you can before the clock runs out. It starts on your first key."
            : round.kind === "drill"
              ? "Real words from your sources that use the keys you want to practise."
              : round.kind === "speed"
                ? "Copy it as fast and clean as you can."
                : STAGE_HINT[item.stage]}
        </p>

        {item.stage === 2 && !item.free ? (
          <Recall
            key={`${index}-${item.passage.id}`}
            text={item.passage.text}
            done={current !== null}
            onDone={(a) => record(item, a)}
          />
        ) : (
          <Typer
            key={`${index}-${item.passage.id}`}
            text={text}
            gaps={item.stage === 1 && !item.free ? prefs.gapDensity : null}
            options={options}
            timeLimitMs={isSprint ? prefs.sprintSeconds * 1000 : undefined}
            onDone={(a) => record(item, a)}
          />
        )}

        {current && (
          <div className="typ__result" role="status">
            <span
              className={
                resultPass(round.kind, item.stage, current)
                  ? "typ__verdict is-pass"
                  : "typ__verdict"
              }
            >
              {verdict(round.kind, item.stage, current)}
            </span>
            <span className="typ__result-detail num">{detail(current)}</span>
            <Button size="sm" autoFocus onClick={next}>
              {index + 1 < round.items.length ? "Next" : "Finish"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  /* ----- summary ----- */
  if (round) {
    const typed = attempts.filter((a) => a.chars !== undefined);
    const ms = typed.reduce((n, a) => n + a.ms, 0);
    const chars = typed.reduce((n, a) => n + (a.chars ?? 0), 0);
    const strokes = typed.reduce((n, a) => n + (a.keystrokes ?? 0), 0);
    const errors = typed.reduce((n, a) => n + (a.errors ?? 0), 0);
    const recalls = attempts.filter((a) => a.recalled);
    const moved = attempts.filter((a) => a.score >= PASS[a.stage]).length;
    const slow = slowestWords(attempts);
    return (
      <div className={fontClass}>
        <div className="typ__summary">
          <p className="typ__summary-title">
            {round.kind === "sprint" ? "Sprint done" : "Round done"}
          </p>
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
            {round.kind === "learn" && (
              <div>
                <dt>Moved up</dt>
                <dd className="num">
                  {moved} of {attempts.length}
                </dd>
              </div>
            )}
            {round.kind === "sprint" && (
              <div>
                <dt>Best {prefs.sprintSeconds}s</dt>
                <dd className="num">{sprintBest[prefs.sprintSeconds] ?? 0} wpm</dd>
              </div>
            )}
          </dl>

          {slow.length > 0 && (
            <div className="typ__slow">
              <span>Slowest words</span>
              <div>
                {slow.map((w) => (
                  <kbd key={w}>{w}</kbd>
                ))}
              </div>
              <button
                type="button"
                className="typ__link"
                onClick={() => startDrill({ words: slow })}
              >
                Drill these
              </button>
            </div>
          )}

          <div className="typ__summary-actions">
            <Button variant="outline" size="sm" onClick={quit}>
              Done
            </Button>
            <Button
              size="sm"
              autoFocus
              onClick={() =>
                round.kind === "sprint"
                  ? startSprint()
                  : round.kind === "speed"
                    ? startSpeed()
                    : round.kind === "drill"
                      ? startDrill(slow.length ? { words: slow } : { keys: weakKeys })
                      : startLearn(true)
              }
            >
              {round.kind === "sprint" ? "Sprint again" : "Another round"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ----- home ----- */
  return (
    <div className={fontClass}>
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
          {sources.map((x) => {
            const ps = bySource.get(x.id) ?? [];
            const pr = sourceProgress(ps, cards);
            const on = chosen === null || chosen.includes(x.id);
            return (
              <div key={x.id} className="typ__source">
                <label>
                  <input type="checkbox" checked={on} onChange={() => toggleSource(x.id)} />
                  <span>{x.title}</span>
                </label>
                <em className="num" title={`${pr.started} started, ${pr.learned} learned`}>
                  {x.kind === "note" ? "Note" : "Transcript"} · {pr.learned}/{pr.total}
                </em>
                <button
                  type="button"
                  className="typ__source-go"
                  disabled={!ps.length}
                  aria-label={`Practise ${x.title} now`}
                  title="Practise this one now"
                  onClick={() => startLearn(true, ps)}
                >
                  <Play size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {goalMin > 0 && (
        <div className="typ__goal">
          <span className="typ__goal-label num">
            {todayMin >= goalMin ? (
              <>
                <Check size={12} aria-hidden="true" /> Daily goal met
              </>
            ) : (
              <>
                {Math.floor(todayMin)} of {goalMin} min today
              </>
            )}
          </span>
          <span className="typ__goal-track" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.min(1, todayMin / goalMin)})` }} />
          </span>
        </div>
      )}

      <div className="seg typ__tabs" role="tablist" aria-label="Practice">
        {(
          [
            ["learn", "Learn", BookOpen],
            ["speed", "Speed", Zap],
            ["sprint", "Sprint", Timer],
          ] as const
        ).map(([id, name, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={prefs.tab === id}
            className={`seg__btn${prefs.tab === id ? " is-active" : ""}`}
            onClick={() => setPrefs({ tab: id })}
          >
            <Icon size={13} />
            {name}
          </button>
        ))}
      </div>

      <div className="typ__home">
        {passages.length === 0 ? (
          <>
            <p className="typ__lead">Nothing long enough to practise</p>
            <p className="typ__sub">
              Pick more sources above, choose shorter passages in settings, or add a longer note.
            </p>
          </>
        ) : prefs.tab === "learn" ? (
          upNext.length > 0 ? (
            <>
              <p className="typ__lead">
                {reviews > 0 && fresh > 0
                  ? `${reviews} to review, ${fresh} new`
                  : reviews > 0
                    ? `${reviews} to review`
                    : `${fresh} new passage${fresh === 1 ? "" : "s"}`}
              </p>
              <p className="typ__sub">
                Copy, fill the gaps, then recall from memory. Each passage comes back on a widening
                schedule.
              </p>
              <figure className="typ__peek">
                <figcaption>
                  Up first · {STAGE_LABEL[upNext[0]!.stage]} · {upNext[0]!.passage.sourceTitle}
                </figcaption>
                <p>{upNext[0]!.passage.text}</p>
              </figure>
              <Button onClick={() => startLearn()}>Start round</Button>
            </>
          ) : (
            <>
              <p className="typ__lead">All caught up</p>
              <p className="typ__sub">
                {soonest !== null ? `The next review is ${when(soonest, now)}.` : "Nothing is due."}
              </p>
              <Button variant="outline" onClick={() => startLearn(true)}>
                Practise anyway
              </Button>
            </>
          )
        ) : prefs.tab === "speed" ? (
          <>
            <p className="typ__lead">Type for speed</p>
            <p className="typ__sub">
              Random passages to copy. This doesn't change what you're learning.
            </p>
            <div className="typ__home-actions">
              <Button onClick={startSpeed}>
                Start {Math.min(prefs.roundSize, passages.length)} passages
              </Button>
              {weakKeys.length > 0 && (
                <Button variant="outline" onClick={() => startDrill({ keys: weakKeys })}>
                  Drill weak keys
                </Button>
              )}
            </div>
            {weakKeys.length > 0 && (
              <p className="typ__keys">
                <span>Keys you miss most</span>
                {weakKeys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="typ__lead">{prefs.sprintSeconds}-second sprint</p>
            <p className="typ__sub">
              One long run of your own text against the clock.{" "}
              {sprintBest[prefs.sprintSeconds]
                ? `Your best is ${sprintBest[prefs.sprintSeconds]} wpm.`
                : "No best yet."}
            </p>
            <div className="typ__home-actions">
              <div className="seg" role="radiogroup" aria-label="Sprint length">
                {SPRINTS.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    role="radio"
                    aria-checked={prefs.sprintSeconds === sec}
                    className={`seg__btn${prefs.sprintSeconds === sec ? " is-active" : ""}`}
                    onClick={() => setPrefs({ sprintSeconds: sec })}
                  >
                    {sec < 60 ? `${sec}s` : `${sec / 60} min`}
                  </button>
                ))}
              </div>
              <Button onClick={startSprint}>Start sprint</Button>
            </div>
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
          <dt>This week</dt>
          <dd className="num">{weekWpm ? `${weekWpm} wpm` : "–"}</dd>
        </div>
        <div>
          <dt>Best</dt>
          <dd className="num">{best} wpm</dd>
        </div>
        <div>
          <dt>Learned</dt>
          <dd className="num">
            {progress.learned} of {progress.total}
          </dd>
        </div>
      </dl>

      <Chart data={chart} goal={goalMin} />
    </div>
  );
}

/* ------------------------------------------------------------ helpers ---- */

function Chart({
  data,
  goal,
}: {
  data: { key: string; label: string; minutes: number; wpm: number }[];
  goal: number;
}) {
  const top = Math.max(goal, ...data.map((d) => d.minutes), 1);
  const active = data.filter((d) => d.minutes > 0).length;
  return (
    <figure className="typ__chart">
      <figcaption>
        <span>Last 14 days</span>
        <span className="num">
          {active} {active === 1 ? "day" : "days"} practised
        </span>
      </figcaption>
      <div
        className="typ__bars"
        role="img"
        aria-label={`Practised on ${active} of the last 14 days`}
      >
        {goal > 0 && <i className="typ__goal-line" style={{ bottom: `${(goal / top) * 100}%` }} />}
        {data.map((d) => (
          <span
            key={d.key}
            className={d.minutes >= goal && goal > 0 ? "is-met" : undefined}
            title={
              d.minutes > 0
                ? `${d.label}: ${Math.max(1, Math.round(d.minutes))} min, ${d.wpm} wpm`
                : `${d.label}: no practice`
            }
          >
            <i style={{ height: `${Math.max(d.minutes > 0 ? 8 : 0, (d.minutes / top) * 100)}%` }} />
          </span>
        ))}
      </div>
    </figure>
  );
}

/** The three words that took longest per character across the round. */
function slowestWords(attempts: Attempt[]): string[] {
  const times = new Map<string, number[]>();
  for (const a of attempts)
    for (const [w, ms] of a.wordTimes ?? []) times.set(w, [...(times.get(w) ?? []), ms]);
  const avg = [...times.entries()].map(
    ([w, xs]) => [w, xs.reduce((n, x) => n + x, 0) / xs.length] as const,
  );
  if (avg.length < 6) return [];
  return avg
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);
}

function resultPass(kind: Round["kind"], stage: Stage, a: Attempt): boolean {
  if (kind !== "learn")
    return !!a.keystrokes && (a.keystrokes - (a.errors ?? 0)) / a.keystrokes >= 0.95;
  return a.score >= PASS[stage];
}

function verdict(kind: Round["kind"], stage: Stage, a: Attempt): string {
  if (kind === "sprint") return a.newBest ? "New best sprint" : "Time";
  if (kind !== "learn") {
    if (a.newBest) return "New best speed";
    return resultPass(kind, stage, a) ? "Clean" : "Watch the mistakes";
  }
  const passed = a.score >= PASS[stage];
  if (stage === 0)
    return passed ? "Next time: fill the gaps" : "Again soon, a little more carefully";
  if (stage === 1) return passed ? "Next: recall it tomorrow" : "Again soon";
  return passed ? "Remembered. It comes back later" : "Back to the gaps for this one";
}

function detail(a: Attempt): string {
  const parts: string[] = [];
  if (a.gaps) parts.push(`${a.gaps[0]} of ${a.gaps[1]} hidden words`);
  if (a.recalled)
    parts.push(`${a.recalled[0]} of ${a.recalled[1]} key words${a.hinted ? " (with a hint)" : ""}`);
  if (a.chars !== undefined) {
    parts.push(`${wpm(a.chars, a.ms)} wpm`);
    if (a.keystrokes)
      parts.push(
        `${Math.round(((a.keystrokes - (a.errors ?? 0)) / a.keystrokes) * 100)}% accuracy`,
      );
  }
  return parts.join(" · ");
}
