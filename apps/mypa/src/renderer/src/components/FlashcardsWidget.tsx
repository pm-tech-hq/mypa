import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BarChart3, Flame, Layers, Library, Play, Plus, Sparkles } from "lucide-react";

import type { TutorConfig } from "../../../shared/tutor";
import {
  DEFAULT_FLASHCARDS_PREFS,
  type FlashDay,
  type Flashcard,
  type FlashcardsPrefs,
  type WidgetRow,
  type WidgetSettings,
} from "../../../shared/types";
import {
  buildQueue,
  counts,
  EMPTY_DAY,
  forecast,
  hardest,
  history,
  interleave,
  outcomes,
  retention,
  streak,
  studyDay,
  when,
  type Grade,
} from "../lib/flashcards";
import { useReadyStore } from "../lib/store";
import { collectSources, type Source } from "../lib/typing";
import "../styles/flashcards.css";
import { FlashcardsBrowse } from "./FlashcardsBrowse";
import { FlashcardsMake } from "./FlashcardsMake";
import { FlashcardsSession, type SessionResult } from "./FlashcardsSession";
import { TutorSettings } from "./TutorSettings";
import { Button } from "./ui/button";

export interface Session {
  ids: string[];
  /** Cards already in their learning steps, picked up as they come due. */
  learning: string[];
  title: string;
}

/**
 * Widget settings with this widget's own writes applied straight away, so
 * answering quickly never reads a card from before the last answer.
 */
function useSettings(widget: WidgetRow) {
  const { actions } = useReadyStore();
  const [pending, setPending] = useState<WidgetSettings | null>(null);
  const pendingRef = useRef<WidgetSettings | null>(null);
  const inflight = useRef(0);
  const view = useMemo(
    () => (pending ? { ...widget.settings, ...pending } : widget.settings),
    [widget.settings, pending],
  );
  const viewRef = useRef(view);
  viewRef.current = view;

  const write = useCallback(
    (patch: WidgetSettings | ((s: WidgetSettings) => WidgetSettings)) => {
      const p = typeof patch === "function" ? patch(viewRef.current) : patch;
      const next = { ...pendingRef.current, ...p };
      pendingRef.current = next;
      viewRef.current = { ...viewRef.current, ...p };
      setPending(next);
      inflight.current++;
      void actions.updateWidgetSettings(widget.id, p).finally(() => {
        if (--inflight.current === 0) {
          pendingRef.current = null;
          setPending(null);
        }
      });
    },
    [actions, widget.id],
  );
  return { view, write };
}

/**
 * Flashcards made from your transcripts and notes, by AI or by quick rules.
 * Each card is asked in a way that fits how well you know it — pick from
 * four, type it, then recall it — and comes back on an FSRS schedule tuned to
 * the share of cards you want to still remember.
 */
export function FlashcardsWidget({ widget }: { widget: WidgetRow }) {
  const { snapshot } = useReadyStore();
  const { view, write } = useSettings(widget);
  const prefs: FlashcardsPrefs = {
    ...DEFAULT_FLASHCARDS_PREFS,
    ...view.flashPrefs,
  };
  const cardMap = useMemo(() => view.flashCards ?? {}, [view.flashCards]);
  const cards = useMemo(() => Object.values(cardMap), [cardMap]);
  const days = useMemo(() => view.flashDays ?? {}, [view.flashDays]);

  const sources = useMemo(
    () => collectSources(snapshot.transcripts, snapshot.widgets),
    [snapshot.transcripts, snapshot.widgets],
  );
  const sourceById = useMemo(() => new Map(sources.map((x) => [x.id, x])), [sources]);

  const [now, setNow] = useState(() => Date.now());
  const [config, setConfig] = useState<TutorConfig | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [making, setMaking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void window.mypa.tutor.getConfig().then(setConfig);
  }, []);

  // A provider that was deleted must not stay selected.
  useEffect(() => {
    if (
      config &&
      !["off", "local"].includes(prefs.ai) &&
      !config.providers.some((p) => p.id === prefs.ai)
    )
      write((s) => ({ flashPrefs: { ...s.flashPrefs, ai: "local" } }));
  }, [config, prefs.ai, write]);

  // Keep "due" counts honest while the widget sits on the board.
  useEffect(() => {
    if (session) return;
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [session]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const setPrefs = (patch: Partial<FlashcardsPrefs>) =>
    write((s) => ({ flashPrefs: { ...s.flashPrefs, ...patch } }));

  const today = days[studyDay(now)] ?? EMPTY_DAY;
  const queue = useMemo(() => buildQueue(cards, now, prefs, today), [cards, now, prefs, today]);
  const learningDue = queue.learning.filter((c) => c.due <= now).length;
  const dueTotal = queue.reviews.length + queue.fresh.length + learningDue;
  const soonest = useMemo(() => {
    const live = cards.filter((c) => !c.suspended && c.state !== 0);
    return live.length ? Math.min(...live.map((c) => c.due)) : null;
  }, [cards]);
  const c = counts(cards);
  const run = streak(days, now);
  const kept = retention(days, now);

  /** Cards per deck (source), including decks whose source was deleted. */
  const decks = useMemo(() => {
    const by = new Map<string, Flashcard[]>();
    for (const card of cards) by.set(card.sourceId, [...(by.get(card.sourceId) ?? []), card]);
    const list: {
      id: string;
      title: string;
      source: Source | undefined;
      cards: Flashcard[];
    }[] = sources.map((x) => ({
      id: x.id,
      title: x.title,
      source: x,
      cards: by.get(x.id) ?? [],
    }));
    for (const [id, cs] of by)
      if (!sourceById.has(id))
        list.push({
          id,
          title: cs[0]!.sourceTitle || "My cards",
          source: undefined,
          cards: cs,
        });
    return list.sort((a, b) => Number(b.cards.length > 0) - Number(a.cards.length > 0));
  }, [cards, sources, sourceById]);

  const begin = (from: Flashcard[], title: string, ahead = false) => {
    const t = Date.now();
    const q = buildQueue(from, t, prefs, days[studyDay(t)] ?? EMPTY_DAY, ahead);
    const ids = interleave(q);
    const learning = q.learning.map((x) => x.id);
    if (!ids.length && !learning.some((id) => cardMap[id]!.due <= t + 20 * 60_000)) {
      setNotice(
        ahead ? "Nothing is coming up in the next few days." : "Nothing is due here right now.",
      );
      return;
    }
    setNow(t);
    setResult(null);
    setSession({ ids, learning, title });
  };

  const cram = (list: Flashcard[], title: string) => {
    if (!list.length) return;
    setResult(null);
    setSession({ ids: list.map((x) => x.id), learning: [], title });
  };

  /** Saves one answer: the card's new schedule and today's totals. */
  const grade = (card: Flashcard, g: Grade, ms: number): Flashcard => {
    const t = Date.now();
    const next = outcomes(card, t, prefs.retention)[g];
    write((s) => {
      const key = studyDay(t);
      const d = s.flashDays?.[key] ?? EMPTY_DAY;
      const learned = card.state === 2;
      const day: FlashDay = {
        reviews: d.reviews + 1,
        fresh: d.fresh + (card.state === 0 ? 1 : 0),
        rev: d.rev + (learned ? 1 : 0),
        revOk: d.revOk + (learned && g > 1 ? 1 : 0),
        // someone who walked away mid-card hasn't been studying
        ms: d.ms + Math.min(ms, 90_000),
      };
      return {
        flashCards: { ...s.flashCards, [card.id]: next },
        flashDays: { ...s.flashDays, [key]: day },
      };
    });
    return next;
  };

  /** Puts a card and the day's totals back the way they were. */
  const restore = (card: Flashcard, day: { key: string; value: FlashDay | undefined }) =>
    write((s) => {
      const flashDays = { ...s.flashDays };
      if (day.value) flashDays[day.key] = day.value;
      else delete flashDays[day.key];
      return { flashCards: { ...s.flashCards, [card.id]: card }, flashDays };
    });

  const saveCard = (card: Flashcard) =>
    write((s) => ({ flashCards: { ...s.flashCards, [card.id]: card } }));

  const aiDialog = (
    <TutorSettings
      open={aiOpen}
      onOpenChange={setAiOpen}
      config={config}
      onConfigChange={setConfig}
      title="AI models"
    />
  );

  /* ---------------------------------------------------------------- views */

  if (session) {
    return (
      <>
        <FlashcardsSession
          key={session.ids.join() + session.title}
          session={session}
          cards={cardMap}
          all={cards}
          prefs={prefs}
          sources={sourceById}
          ai={prefs.ai}
          days={days}
          onGrade={grade}
          onRestore={restore}
          onSave={saveCard}
          onExit={(r) => {
            setSession(null);
            setNow(Date.now());
            setResult(r);
          }}
        />
        {aiDialog}
      </>
    );
  }

  if (making !== null) {
    return (
      <>
        <FlashcardsMake
          sources={sources}
          initialSourceId={making}
          cards={cards}
          made={view.flashMade ?? {}}
          prefs={prefs}
          config={config}
          setPrefs={setPrefs}
          onOpenAi={() => setAiOpen(true)}
          onAdd={(added, sourceId, parts) => {
            write((s) => {
              const map = { ...s.flashCards };
              for (const x of added) map[x.id] = x;
              const made = s.flashMade ?? {};
              return {
                flashCards: map,
                flashMade: {
                  ...made,
                  [sourceId]: [...new Set([...(made[sourceId] ?? []), ...parts])],
                },
              };
            });
            setMaking(null);
            setNow(Date.now());
            if (added.length)
              setNotice(`Added ${added.length} card${added.length === 1 ? "" : "s"}.`);
          }}
          onMarkUnmade={(sourceId) =>
            write((s) => ({ flashMade: { ...s.flashMade, [sourceId]: [] } }))
          }
          onClose={() => setMaking(null)}
        />
        {aiDialog}
      </>
    );
  }

  if (!sources.length && !cards.length) {
    return (
      <div className="fc">
        <div className="blankstate">
          <span className="blankstate__icon">
            <Layers size={16} />
          </span>
          <p className="blankstate__title">Nothing to learn from yet</p>
          <p className="blankstate__text">
            Transcribe a video, podcast or article, or write a note. It turns into flashcards here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fc">
      <div className="seg fc__tabs" role="tablist" aria-label="Flashcards">
        {(
          [
            ["study", "Study", Play],
            ["cards", "Cards", Library],
            ["stats", "Progress", BarChart3],
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

      {notice && (
        <p className="fc__notice" role="status">
          {notice}
        </p>
      )}

      {prefs.tab === "study" && (
        <>
          {result && <Summary result={result} onDismiss={() => setResult(null)} />}

          <div className="fc__home">
            {cards.length === 0 ? (
              <>
                <p className="fc__lead">Make your first cards</p>
                <p className="fc__sub">
                  Pick a transcript or note below. AI writes questions that test understanding, or
                  quick mode turns key sentences into fill-in-the-blank cards in a second.
                </p>
                <Button onClick={() => setMaking(sources[0]?.id ?? "")}>
                  <Sparkles size={14} />
                  Make cards
                </Button>
              </>
            ) : dueTotal > 0 ? (
              <>
                <p className="fc__lead">
                  {[
                    queue.reviews.length + learningDue > 0 &&
                      `${queue.reviews.length + learningDue} to review`,
                    queue.fresh.length > 0 && `${queue.fresh.length} new`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p className="fc__sub">
                  New cards start as multiple choice, then you type or recall the answer. Each one
                  comes back just before you&apos;d forget it.
                </p>
                <Button onClick={() => begin(cards, "All decks")}>
                  <Play size={14} />
                  Study now
                </Button>
              </>
            ) : (
              <>
                <p className="fc__lead">All caught up</p>
                <p className="fc__sub">
                  {soonest !== null
                    ? `The next card comes back ${when(soonest, now)}.`
                    : c.fresh > 0
                      ? "You've met today's new cards. More tomorrow, or raise the limit in settings."
                      : "Make more cards to keep learning."}
                </p>
                <div className="fc__home-actions">
                  {c.young + c.mature + c.learning > 0 && (
                    <Button variant="outline" onClick={() => begin(cards, "Practise ahead", true)}>
                      Practise ahead
                    </Button>
                  )}
                  {c.fresh > 0 && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        cram(
                          cards
                            .filter((x) => x.state === 0 && !x.suspended)
                            .sort((a, b) => a.createdAt - b.createdAt)
                            .slice(0, 10),
                          "Extra new cards",
                        )
                      }
                    >
                      10 more new cards
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="fc__decks">
            <div className="fc__decks-head">
              <span>Decks</span>
              <button
                type="button"
                className="fc__link"
                onClick={() => setMaking(sources[0]?.id ?? "")}
                disabled={!sources.length}
              >
                <Plus size={12} />
                Make cards
              </button>
            </div>
            {decks.map((d) => {
              const q = buildQueue(d.cards, now, prefs, today);
              const due = q.reviews.length + q.learning.filter((x) => x.due <= now).length;
              const dc = counts(d.cards);
              const learned = dc.young + dc.mature;
              return (
                <div key={d.id} className="fc__deck">
                  <div className="fc__deck-main">
                    <span className="fc__deck-title" title={d.title}>
                      {d.title}
                    </span>
                    <span className="fc__deck-meta num">
                      {d.cards.length === 0
                        ? d.source?.kind === "note"
                          ? "Note · no cards yet"
                          : "No cards yet"
                        : `${d.cards.length} cards · ${learned} learned`}
                    </span>
                  </div>
                  {d.cards.length > 0 && (
                    <span className="fc__deck-due num">
                      {due > 0 && <em className="is-due">{due} due</em>}
                      {q.fresh.length > 0 && <em>{q.fresh.length} new</em>}
                    </span>
                  )}
                  {d.source && (
                    <button
                      type="button"
                      className="fc__deck-btn"
                      aria-label={`Make cards from ${d.title}`}
                      title="Make cards from this"
                      onClick={() => setMaking(d.id)}
                    >
                      <Sparkles size={13} />
                    </button>
                  )}
                  {d.cards.length > 0 && (
                    <button
                      type="button"
                      className="fc__deck-btn"
                      aria-label={`Study ${d.title}`}
                      title={
                        due + q.fresh.length ? "Study this deck" : "Nothing due: practise ahead"
                      }
                      onClick={() => begin(d.cards, d.title, due + q.fresh.length === 0)}
                    >
                      <Play size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <dl className="fc__stats">
            <div>
              <dt>Streak</dt>
              <dd className="num">
                {run > 0 && <Flame size={12} aria-hidden="true" />}
                {run} {run === 1 ? "day" : "days"}
              </dd>
            </div>
            <div>
              <dt>Today</dt>
              <dd className="num">{today.reviews} answered</dd>
            </div>
            <div>
              <dt>Remembered</dt>
              <dd className="num">{kept === null ? "–" : `${Math.round(kept * 100)}%`}</dd>
            </div>
            <div>
              <dt>Learned</dt>
              <dd className="num">
                {c.young + c.mature} of {cards.length}
              </dd>
            </div>
          </dl>
        </>
      )}

      {prefs.tab === "cards" && (
        <FlashcardsBrowse
          cards={cards}
          decks={decks.map((d) => ({ id: d.id, title: d.title }))}
          now={now}
          onSave={saveCard}
          onDelete={(ids) =>
            write((s) => {
              const map = { ...s.flashCards };
              for (const id of ids) delete map[id];
              return { flashCards: map };
            })
          }
          onRestore={(list) =>
            write((s) => {
              const map = { ...s.flashCards };
              for (const x of list) map[x.id] = x;
              return { flashCards: map };
            })
          }
          onStudy={(list) => cram(list, "Selected cards")}
        />
      )}

      {prefs.tab === "stats" && (
        <Progress
          cards={cards}
          days={days}
          now={now}
          retentionTarget={prefs.retention}
          onStudyHardest={(list) => cram(list, "Hardest cards")}
        />
      )}

      <div className="fc__foot" title="Writes cards, explains answers and checks what you type">
        <Sparkles size={12} aria-hidden="true" />
        <span>AI</span>
        <select
          className="fc__mini-select"
          aria-label="AI for flashcards"
          value={prefs.ai}
          onChange={(e) => setPrefs({ ai: e.target.value })}
        >
          <option value="local">Built-in (offline)</option>
          {config?.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="off">Off</option>
        </select>
        <button type="button" className="fc__link" onClick={() => setAiOpen(true)}>
          Manage models
        </button>
      </div>

      {aiDialog}
    </div>
  );
}

/* ------------------------------------------------------------ pieces ---- */

function Summary({ result, onDismiss }: { result: SessionResult; onDismiss: () => void }) {
  if (!result.answered) return null;
  const pct = Math.round((result.remembered / result.answered) * 100);
  return (
    <div className="fc__summary" role="status">
      <div className="fc__summary-head">
        <span>{result.title} · done</span>
        <button type="button" className="fc__link" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <dl className="fc__figures">
        <div>
          <dt>Answered</dt>
          <dd className="num">{result.answered}</dd>
        </div>
        <div>
          <dt>Remembered</dt>
          <dd className="num">{pct}%</dd>
        </div>
        <div>
          <dt>New</dt>
          <dd className="num">{result.fresh}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd className="num">{Math.max(1, Math.round(result.ms / 60_000))} min</dd>
        </div>
      </dl>
      {result.later > 0 && (
        <p className="fc__sub">
          {result.later} card{result.later === 1 ? " is" : "s are"} still in their learning steps
          and come{result.later === 1 ? "s" : ""} back shortly.
        </p>
      )}
    </div>
  );
}

function Progress({
  cards,
  days,
  now,
  retentionTarget,
  onStudyHardest,
}: {
  cards: Flashcard[];
  days: Record<string, FlashDay>;
  now: number;
  retentionTarget: number;
  onStudyHardest: (cards: Flashcard[]) => void;
}) {
  const c = counts(cards);
  const total = cards.length || 1;
  const kept = retention(days, now);
  const past = history(days, now, 14);
  const ahead = forecast(cards, now, 14);
  const hard = hardest(cards, 5);
  const top = Math.max(1, ...past.map((d) => d.reviews));
  const topAhead = Math.max(1, ...ahead.map((d) => d.due));
  const minutes = past.reduce((n, d) => n + d.minutes, 0);
  const segments: [keyof typeof c, string][] = [
    ["mature", "Mature"],
    ["young", "Young"],
    ["learning", "Learning"],
    ["fresh", "New"],
    ["suspended", "Suspended"],
  ];

  return (
    <div className="fc__progress">
      <figure className="fc__mix">
        <figcaption>
          <span>{cards.length} cards</span>
          <span className="num">
            {kept === null
              ? "No reviews yet"
              : `${Math.round(kept * 100)}% remembered · aim ${Math.round(retentionTarget * 100)}%`}
          </span>
        </figcaption>
        <div className="fc__mix-bar" role="img" aria-label="Cards by stage">
          {segments.map(([k]) =>
            c[k] > 0 ? (
              <span key={k} className={`fc__mix--${k}`} style={{ flexGrow: c[k] / total }} />
            ) : null,
          )}
        </div>
        <ul className="fc__mix-legend">
          {segments.map(([k, label]) => (
            <li key={k}>
              <i className={`fc__mix--${k}`} aria-hidden="true" />
              {label} <span className="num">{c[k]}</span>
            </li>
          ))}
        </ul>
        <p className="fc__hint">
          Mature cards would hold for three weeks or more without a review.
        </p>
      </figure>

      <Bars
        title="Coming up"
        aside={`${ahead.slice(0, 7).reduce((n, d) => n + d.due, 0)} in the next 7 days`}
        data={ahead.map((d) => ({
          key: d.key,
          value: d.due,
          label: `${d.label}: ${d.due} card${d.due === 1 ? "" : "s"}`,
        }))}
        top={topAhead}
        accent
      />

      <Bars
        title="Last 14 days"
        aside={`${Math.round(minutes)} min studied`}
        data={past.map((d) => ({
          key: d.key,
          value: d.reviews,
          label:
            d.reviews > 0
              ? `${d.label}: ${d.reviews} answers, ${Math.max(1, Math.round(d.minutes))} min`
              : `${d.label}: no study`,
        }))}
        top={top}
      />

      {hard.length > 0 && (
        <div className="fc__hardest">
          <div className="fc__decks-head">
            <span>Hardest cards</span>
            <button type="button" className="fc__link" onClick={() => onStudyHardest(hard)}>
              <Play size={11} />
              Study these
            </button>
          </div>
          <ul>
            {hard.map((x) => (
              <li key={x.id}>
                <span>{x.kind === "cloze" ? x.front.replace("{{}}", "____") : x.front}</span>
                <em className="num">{x.lapses > 0 ? `forgot ${x.lapses}×` : "rated hard"}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Bars({
  title,
  aside,
  data,
  top,
  accent,
}: {
  title: string;
  aside: string;
  data: { key: string; value: number; label: string }[];
  top: number;
  accent?: boolean;
}) {
  return (
    <figure className="fc__chart">
      <figcaption>
        <span>{title}</span>
        <span className="num">{aside}</span>
      </figcaption>
      <div
        className={`fc__bars${accent ? " is-accent" : ""}`}
        role="img"
        aria-label={`${title}: ${aside}`}
      >
        {data.map((d) => (
          <span key={d.key} title={d.label}>
            <i
              style={{
                height: `${Math.max(d.value > 0 ? 8 : 0, (d.value / top) * 100)}%`,
              }}
            />
          </span>
        ))}
      </div>
    </figure>
  );
}
