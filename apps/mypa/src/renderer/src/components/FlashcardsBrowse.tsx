import { useEffect, useMemo, useState } from "react";

import { Eye, EyeOff, Pencil, Play, Plus, RotateCcw, Search, Trash2 } from "lucide-react";

import type { Flashcard } from "../../../shared/types";
import { forget, GAP, isLeech, newCard, recallNow, when } from "../lib/flashcards";
import { EditCard } from "./FlashcardsSession";
import { Button } from "./ui/button";
import { UndoToast } from "./UndoToast";

type Filter = "all" | "due" | "new" | "learned" | "hard" | "suspended";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["due", "Due"],
  ["new", "New"],
  ["learned", "Learned"],
  ["hard", "Hard"],
  ["suspended", "Suspended"],
];

/** Rows shown before "Show more"; a deck can hold thousands of cards. */
const PAGE = 60;

export function FlashcardsBrowse({
  cards,
  decks,
  now,
  onSave,
  onDelete,
  onRestore,
  onStudy,
}: {
  cards: Flashcard[];
  decks: { id: string; title: string }[];
  now: number;
  onSave: (card: Flashcard) => void;
  onDelete: (ids: string[]) => void;
  onRestore: (cards: Flashcard[]) => void;
  onStudy: (cards: Flashcard[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [deck, setDeck] = useState("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [deleted, setDeleted] = useState<Flashcard[] | null>(null);

  useEffect(() => setLimit(PAGE), [query, deck, filter]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards
      .filter((c) => deck === "all" || c.sourceId === deck)
      .filter((c) => {
        switch (filter) {
          case "due":
            return !c.suspended && c.state !== 0 && c.due <= now;
          case "new":
            return !c.suspended && c.state === 0;
          case "learned":
            return !c.suspended && c.state === 2;
          case "hard":
            return c.lapses > 0 || c.difficulty >= 7;
          case "suspended":
            return !!c.suspended;
          default:
            return true;
        }
      })
      .filter((c) => !q || `${c.front} ${c.back}`.toLowerCase().includes(q))
      .sort((a, b) =>
        filter === "hard"
          ? b.lapses - a.lapses || b.difficulty - a.difficulty
          : a.createdAt - b.createdAt,
      );
  }, [cards, deck, filter, query, now]);

  const remove = (list: Flashcard[]) => {
    if (!list.length) return;
    onDelete(list.map((c) => c.id));
    setDeleted(list);
  };

  const manualDeck = deck !== "all" ? deck : (decks[0]?.id ?? "manual");
  const manualTitle = decks.find((d) => d.id === manualDeck)?.title ?? "My cards";

  return (
    <div className="fc__browse">
      <div className="fc__browse-bar">
        <label className="fc__search">
          <Search size={13} aria-hidden="true" />
          <input
            value={query}
            placeholder="Search cards"
            aria-label="Search cards"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          className="field fc__deck-select"
          aria-label="Deck"
          value={deck}
          onChange={(e) => setDeck(e.target.value)}
        >
          <option value="all">All decks</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Add a card"
          title="Add a card"
          onClick={() => setAdding((v) => !v)}
        >
          <Plus size={14} />
        </Button>
      </div>

      <div className="wsettings__chips fc__filters">
        {FILTERS.map(([f, label]) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            className={`chip${filter === f ? " chip--on" : ""}`}
            onClick={() => setFilter(f)}
          >
            {label}
          </button>
        ))}
      </div>

      {adding && (
        <div className="fc__add">
          <p className="fc__hint">New card in “{manualTitle}”</p>
          <EditCard
            card={newCard(
              {
                sourceId: manualDeck,
                sourceTitle: manualTitle,
                kind: "qa",
                front: "",
                back: "",
                origin: "manual",
              },
              now,
            )}
            onCancel={() => setAdding(false)}
            onSave={(c) => {
              onSave({ ...c, createdAt: Date.now(), due: Date.now() });
              setAdding(false);
            }}
          />
        </div>
      )}

      <div className="fc__decks-head">
        <span className="num">
          {shown.length} card{shown.length === 1 ? "" : "s"}
        </span>
        <span className="fc__browse-actions">
          {shown.length > 0 && (
            <button type="button" className="fc__link" onClick={() => onStudy(shown.slice(0, 50))}>
              <Play size={11} />
              Study {Math.min(50, shown.length)}
            </button>
          )}
          {shown.length > 0 && (deck !== "all" || filter !== "all" || query) && (
            <button
              type="button"
              className="fc__link fc__link--danger"
              onClick={() => remove(shown)}
            >
              <Trash2 size={11} />
              Delete these
            </button>
          )}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="fc__sub">
          {cards.length === 0 ? "No cards yet. Make some on the Study tab." : "No cards match."}
        </p>
      ) : (
        <ul className="fc__list">
          {shown.slice(0, limit).map((c) =>
            editing === c.id ? (
              <li key={c.id} className="fc__row is-editing">
                <EditCard
                  card={c}
                  onCancel={() => setEditing(null)}
                  onSave={(next) => {
                    onSave(next);
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={c.id} className={`fc__row${c.suspended ? " is-off" : ""}`}>
                <div className="fc__row-main">
                  <p className="fc__row-q">
                    {c.kind === "cloze" ? c.front.replace(GAP, "____") : c.front}
                  </p>
                  <p className="fc__row-a">{c.back}</p>
                  <p className="fc__row-meta num">
                    <Status card={c} now={now} />
                    {deck === "all" && <span title={c.sourceTitle}>{c.sourceTitle}</span>}
                  </p>
                </div>
                <div className="fc__row-tools">
                  <button
                    type="button"
                    className="fc__icon"
                    aria-label="Edit"
                    title="Edit"
                    onClick={() => setEditing(c.id)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="fc__icon"
                    aria-label={c.suspended ? "Unsuspend" : "Suspend"}
                    title={c.suspended ? "Show this card again" : "Suspend: stop showing this card"}
                    onClick={() => onSave({ ...c, suspended: !c.suspended })}
                  >
                    {c.suspended ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  {c.reps > 0 && (
                    <button
                      type="button"
                      className="fc__icon"
                      aria-label="Start over"
                      title="Start over: make it a new card again"
                      onClick={() => onSave(forget(c, Date.now()))}
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="fc__icon"
                    aria-label="Delete"
                    title="Delete"
                    onClick={() => remove([c])}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {shown.length > limit && (
        <button
          type="button"
          className="fc__link fc__more"
          onClick={() => setLimit((n) => n + PAGE)}
        >
          Show more ({shown.length - limit} left)
        </button>
      )}

      {deleted && (
        <UndoToast
          label={`Deleted ${deleted.length} card${deleted.length === 1 ? "" : "s"}`}
          onUndo={() => {
            onRestore(deleted);
            setDeleted(null);
          }}
          onDismiss={() => setDeleted(null)}
        />
      )}
    </div>
  );
}

function Status({ card, now }: { card: Flashcard; now: number }) {
  if (card.suspended) return <span>Suspended</span>;
  if (card.state === 0) return <span>New</span>;
  const r = recallNow(card, now);
  const due = card.due <= now ? "due now" : `due ${when(card.due, now)}`;
  return (
    <>
      {isLeech(card) && <span className="is-leech">Leech</span>}
      <span>
        {card.state === 2 ? "Learned" : "Learning"} · {due}
      </span>
      {r !== null && card.state === 2 && (
        <span title="Chance you'd remember it right now">{Math.round(r * 100)}% recall</span>
      )}
    </>
  );
}
