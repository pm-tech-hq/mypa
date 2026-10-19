import { useEffect, useMemo, useRef, useState } from "react";

import { AlertCircle, ArrowLeft, Loader2, Settings2, Sparkles, Trash2, Zap } from "lucide-react";

import type { TutorConfig } from "../../../shared/tutor";
import type { Flashcard, FlashcardsPrefs } from "../../../shared/types";
import {
  draftPrompt,
  GAP,
  newCard,
  normAnswer,
  parseDrafts,
  partsOf,
  questionKey,
  quickDrafts,
  streamChat,
  type ChatHandle,
  type Draft,
} from "../lib/flashcards";
import type { Source } from "../lib/typing";
import { Button } from "./ui/button";

interface Props {
  sources: Source[];
  initialSourceId: string;
  cards: Flashcard[];
  made: Record<string, number[]>;
  prefs: FlashcardsPrefs;
  config: TutorConfig | null;
  setPrefs: (patch: Partial<FlashcardsPrefs>) => void;
  onOpenAi: () => void;
  onAdd: (cards: Flashcard[], sourceId: string, parts: number[]) => void;
  onMarkUnmade: (sourceId: string) => void;
  onClose: () => void;
}

interface Item extends Draft {
  key: string;
  on: boolean;
}

/** Cards per part asked of the AI; a part is ~400 words. */
const PER_PART = 6;

/**
 * Turns the next unused parts of a source into draft cards, which you check
 * before they join the deck. AI writes understanding questions with wrong
 * answers for multiple choice; quick mode makes definition and
 * fill-in-the-blank cards instantly, offline.
 */
export function FlashcardsMake({
  sources,
  initialSourceId,
  cards,
  made,
  prefs,
  config,
  setPrefs,
  onOpenAi,
  onAdd,
  onMarkUnmade,
  onClose,
}: Props) {
  const [sourceId, setSourceId] = useState(
    sources.some((x) => x.id === initialSourceId) ? initialSourceId : (sources[0]?.id ?? ""),
  );
  const source = sources.find((x) => x.id === sourceId);
  const parts = useMemo(() => (source ? partsOf(source) : []), [source]);
  const done = useMemo(() => new Set(made[sourceId] ?? []), [made, sourceId]);
  const left = parts.filter((p) => !done.has(p.index));

  const hasProvider = (config?.providers.length ?? 0) > 0;
  const useAi = prefs.ai !== "off" && (prefs.useAi ?? hasProvider);

  const [items, setItems] = useState<Item[]>([]);
  const [usedParts, setUsedParts] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<ChatHandle | null>(null);
  const stopped = useRef(false);

  useEffect(() => () => handle.current?.cancel(), []);

  const existing = useMemo(
    () => new Set(cards.filter((c) => c.sourceId === sourceId).map((c) => questionKey(c.front))),
    [cards, sourceId],
  );

  const reset = () => {
    setItems([]);
    setUsedParts([]);
    setError(null);
    setStatus("");
  };

  const generate = async () => {
    if (!source || busy) return;
    stopped.current = false;
    setBusy(true);
    setError(null);
    const want = prefs.batchSize;
    const seen = new Set(existing);
    const answers = new Set(
      [...cards.filter((c) => c.sourceId === sourceId), ...items].map((c) => normAnswer(c.back)),
    );
    for (const it of items) seen.add(it.key);
    let have = items.length;
    const used: number[] = [...usedParts];
    const todo = left.filter((p) => !used.includes(p.index));

    const accept = (drafts: Draft[]): Item[] => {
      const out: Item[] = [];
      for (const d of drafts) {
        const key = questionKey(d.front);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...d, key, on: true });
      }
      return out;
    };

    try {
      for (let i = 0; i < todo.length && have < want && !stopped.current; i++) {
        const part = todo[i]!;
        setStatus(`Reading part ${part.index + 1} of ${parts.length}…`);
        let fresh: Item[];
        if (!useAi) {
          fresh = accept(quickDrafts(source, part, parts, Math.min(5, want - have), answers));
        } else {
          const questions = [
            ...cards.filter((c) => c.sourceId === sourceId).map((c) => c.front),
            ...items.map((x) => x.front),
          ];
          const h = streamChat(
            prefs.ai,
            draftPrompt(
              prefs.focus,
              source.title,
              part,
              parts.length,
              Math.min(PER_PART, want - have),
              questions,
            ),
            {
              delta: (text) => {
                const live = parseDrafts(text, part.index, false).length;
                setStatus(
                  `Writing cards from part ${part.index + 1} of ${parts.length}… ${live > 0 ? `(${live})` : ""}`,
                );
              },
              status: (text) => setStatus(text),
            },
          );
          handle.current = h;
          const text = await h.done;
          handle.current = null;
          if (stopped.current) break;
          fresh = accept(parseDrafts(text, part.index, true));
          if (!fresh.length && !text.trim()) throw new Error("The AI didn't reply.");
        }
        used.push(part.index);
        have += fresh.length;
        setUsedParts([...used]);
        setItems((xs) => [...xs, ...fresh]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      handle.current = null;
      setBusy(false);
      setStatus("");
    }
  };

  const stop = () => {
    stopped.current = true;
    handle.current?.cancel();
  };

  const add = () => {
    if (!source) return;
    const now = Date.now();
    const chosen = items.filter((x) => x.on);
    onAdd(
      chosen.map((d, i) =>
        newCard(
          {
            sourceId: source.id,
            sourceTitle: source.title,
            kind: d.kind,
            front: d.front,
            back: d.back,
            quote: d.quote,
            wrong: d.wrong,
            origin: useAi ? "ai" : "rules",
          },
          // keep reading order when new cards are introduced
          now + i,
        ),
      ),
      source.id,
      usedParts,
    );
  };

  const onCount = items.filter((x) => x.on).length;
  const settingsError = error !== null && /key|401|403|unauthori[sz]ed|provider|model/i.test(error);

  return (
    <div className="fc fc--make">
      <div className="fc__bar">
        <button
          type="button"
          className="fc__icon"
          aria-label="Back"
          title="Back"
          onClick={() => {
            stop();
            onClose();
          }}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="fc__title">Make cards</span>
      </div>

      <label className="fc__field">
        <span>From</span>
        <select
          className="field"
          value={sourceId}
          disabled={busy}
          onChange={(e) => {
            setSourceId(e.target.value);
            reset();
          }}
        >
          {sources.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
              {x.kind === "note" ? " (note)" : ""}
            </option>
          ))}
        </select>
        {source && (
          <span className="fc__hint num">
            {parts.length === 0
              ? "Too short to make cards from."
              : left.length === 0
                ? "Every part of this has been made into cards."
                : `${parts.length - left.length} of ${parts.length} parts used · ${cards.filter((c) => c.sourceId === sourceId).length} cards so far`}
          </span>
        )}
      </label>

      <div className="fc__field">
        <span>How</span>
        <div className="seg" role="radiogroup" aria-label="How to make cards">
          <button
            type="button"
            role="radio"
            aria-checked={useAi}
            className={`seg__btn${useAi ? " is-active" : ""}`}
            disabled={busy}
            onClick={() =>
              setPrefs({
                useAi: true,
                ...(prefs.ai === "off" ? { ai: "local" } : {}),
              })
            }
          >
            <Sparkles size={13} />
            With AI
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!useAi}
            className={`seg__btn${!useAi ? " is-active" : ""}`}
            disabled={busy}
            onClick={() => setPrefs({ useAi: false })}
          >
            <Zap size={13} />
            Quick, no AI
          </button>
        </div>
        <span className="fc__hint">
          {useAi
            ? "Questions about meaning, causes and how to use it, with wrong answers for multiple choice."
            : "Definitions and fill-in-the-blank from key sentences. Instant and offline."}
        </span>
      </div>

      {useAi && (
        <div className="fc__field fc__field--row">
          <select
            className="field"
            aria-label="AI model"
            value={prefs.ai}
            disabled={busy}
            onChange={(e) => setPrefs({ ai: e.target.value })}
          >
            <option value="local">Built-in (offline)</option>
            {config?.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="fc__icon"
            aria-label="AI models"
            title="Add or change AI models"
            onClick={onOpenAi}
          >
            <Settings2 size={14} />
          </button>
        </div>
      )}

      {useAi && (
        <div className="fc__field">
          <span>Focus on</span>
          <div className="wsettings__chips">
            {(
              [
                ["understanding", "Understanding"],
                ["mixed", "Both"],
                ["facts", "Facts"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={prefs.focus === v}
                className={`chip${prefs.focus === v ? " chip--on" : ""}`}
                disabled={busy}
                onClick={() => setPrefs({ focus: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="fc__field">
        <span>About</span>
        <div className="wsettings__chips">
          {[10, 20, 40].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={prefs.batchSize === n}
              className={`chip${prefs.batchSize === n ? " chip--on" : ""}`}
              disabled={busy}
              onClick={() => setPrefs({ batchSize: n })}
            >
              {n} cards
            </button>
          ))}
        </div>
      </div>

      <div className="fc__actions">
        {busy ? (
          <Button variant="outline" onClick={stop}>
            Stop
          </Button>
        ) : left.length > 0 ? (
          <Button
            variant={items.length ? "outline" : "default"}
            onClick={() => void generate()}
            disabled={!source || left.length === usedParts.length}
          >
            <Sparkles size={14} />
            {items.length ? "Make more" : "Make cards"}
          </Button>
        ) : (
          parts.length > 0 && (
            <Button variant="outline" onClick={() => onMarkUnmade(sourceId)}>
              Go through it again
            </Button>
          )
        )}
        {busy && (
          <span className="fc__thinking">
            <Loader2 size={13} className="fc__spin" />
            {status || "Working…"}
          </span>
        )}
      </div>

      {error && (
        <div className="fc__alert" role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
          {settingsError && (
            <button type="button" className="fc__link" onClick={onOpenAi}>
              Check AI models
            </button>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="fc__drafts">
          <div className="fc__decks-head">
            <span className="num">
              {onCount} of {items.length} selected
            </span>
            <button
              type="button"
              className="fc__link"
              onClick={() =>
                setItems((xs) => xs.map((x) => ({ ...x, on: !xs.every((y) => y.on) })))
              }
            >
              {items.every((x) => x.on) ? "Select none" : "Select all"}
            </button>
          </div>
          <ul>
            {items.map((it) => (
              <li key={it.key} className={it.on ? undefined : "is-off"}>
                <input
                  type="checkbox"
                  checked={it.on}
                  aria-label="Keep this card"
                  onChange={() =>
                    setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, on: !x.on } : x)))
                  }
                />
                <div className="fc__draft">
                  <p className="fc__draft-q">
                    {it.kind === "cloze" ? it.front.replace(GAP, "____") : it.front}
                  </p>
                  <p className="fc__draft-a">{it.back}</p>
                  {it.wrong.length > 0 && (
                    <p className="fc__draft-w">Not: {it.wrong.join(" · ")}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="fc__icon"
                  aria-label="Discard"
                  title="Discard"
                  onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length > 0 && (
        <div className="fc__make-foot">
          <Button variant="outline" onClick={reset} disabled={busy}>
            Discard all
          </Button>
          <Button onClick={add} disabled={busy || onCount === 0}>
            Add {onCount} card{onCount === 1 ? "" : "s"}
          </Button>
        </div>
      )}
      {!busy && usedParts.length > 0 && items.length === 0 && !error && (
        <p className="fc__sub">
          Nothing worth a card in the parts read so far. Try Make more, or the other method.
        </p>
      )}
    </div>
  );
}
