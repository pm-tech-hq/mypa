import { useEffect, useMemo, useRef, useState } from "react";

import { Check, Eye, EyeOff, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Sparkles, Trash2, X } from "lucide-react";

import type { Access } from "../../../shared/assistant";
import {
  guessKind,
  MEMORY_KINDS,
  MEMORY_TEXT_MAX,
  memoryKindLabel,
  searchMemories,
  sortMemories,
  type MemoryKind,
  type MemoryRecord,
  type MemoryWidgetSettings,
} from "../../../shared/memory";
import type { WidgetRow } from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { UndoToast } from "./UndoToast";
import "../styles/memory.css";

type Filter = NonNullable<MemoryWidgetSettings["memFilter"]>;

const dateLabel = (ms: number) => {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
};

const ACCESS_EVENT = "mypa:memory-access";

/** What the Assistant may do with memories, kept fresh while the widget is open. */
function useMemoryAccess(): [Access | null, (a: Access) => Promise<void>] {
  const [access, setAccess] = useState<Access | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void window.mypa.assistant
        .scopes()
        .then((list) => live && setAccess(list.find((s) => s.id === "memory")?.access ?? "none"))
        .catch(() => undefined);
    load();
    window.addEventListener("focus", load);
    window.addEventListener(ACCESS_EVENT, load);
    const t = window.setInterval(load, 15_000);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
      window.removeEventListener(ACCESS_EVENT, load);
      window.clearInterval(t);
    };
  }, []);
  const set = async (a: Access) => {
    const s = await window.mypa.assistant.getSettings();
    await window.mypa.assistant.saveSettings({ ...s, access: { ...s.access, memory: a } });
    setAccess(a);
    window.dispatchEvent(new Event(ACCESS_EVENT));
  };
  return [access, set];
}

export function MemoryWidget({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const memories = snapshot.memories;
  const filter: Filter = widget.settings.memFilter ?? "all";
  const setFilter = (f: Filter) => void actions.updateWidgetSettings(widget.id, { memFilter: f });
  const [access] = useMemoryAccess();

  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<MemoryKind | "auto">("auto");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; id?: string } | null>(null);
  const [undo, setUndo] = useState<{ key: number; label: string; rows: MemoryRecord[] } | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2600);
    return () => window.clearTimeout(t);
  }, [flash]);

  const counts = useMemo(() => {
    const c = { all: memories.length, review: 0, hidden: 0 } as Record<string, number>;
    for (const m of memories) {
      c[m.kind] = (c[m.kind] ?? 0) + 1;
      if (!m.reviewed) c.review!++;
      if (!m.assistantCanUse) c.hidden!++;
    }
    return c;
  }, [memories]);

  // a filter that has emptied out falls back to everything
  useEffect(() => {
    if (filter !== "all" && !counts[filter]) setFilter("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, counts]);

  const shown = useMemo(() => {
    let list = memories;
    if (filter === "review") list = list.filter((m) => !m.reviewed);
    else if (filter === "hidden") list = list.filter((m) => !m.assistantCanUse);
    else if (filter !== "all") list = list.filter((m) => m.kind === filter);
    return query.trim() ? searchMemories(list, query) : sortMemories(list);
  }, [memories, filter, query]);

  /** Grouped by kind when browsing everything; one list otherwise. */
  const groups = useMemo(() => {
    if (filter !== "all" || query.trim()) return [{ kind: null as MemoryKind | null, items: shown }];
    return MEMORY_KINDS.map((k) => ({ kind: k.id as MemoryKind | null, items: shown.filter((m) => m.kind === k.id) })).filter(
      (g) => g.items.length,
    );
  }, [shown, filter, query]);

  const guess = draft.trim() ? guessKind(draft) : null;

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      const r = await actions.addMemory({ text, kind: draftKind === "auto" ? null : draftKind });
      setDraft("");
      setDraftKind("auto");
      setFlash({ text: r.created ? "Remembered." : "That was already saved, so it was updated.", id: r.id });
      if (filter !== "all") setFilter("all");
    } catch (e) {
      setFlash({ text: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e) });
    }
  };

  const remove = async (rows: MemoryRecord[], label: string) => {
    await actions.deleteMemories(rows.map((m) => m.id));
    setUndo({ key: Date.now(), label, rows });
  };

  const learned = counts.review ?? 0;

  return (
    <div className="mem">
      <div className="mem__body">
        <form
          className="mem__add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <textarea
            className="mem__add-input"
            value={draft}
            rows={1}
            maxLength={MEMORY_TEXT_MAX}
            ref={(el) => {
              // grow with the text
              if (!el) return;
              el.style.height = "auto";
              el.style.height = `${Math.max(el.scrollHeight, 40)}px`;
            }}
            placeholder="Something to remember, like “My sister is called Ada”"
            aria-label="Something to remember"
            onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void add();
              }
            }}
          />
          <div className="mem__add-row">
            <select
              className="mem__kind"
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value as MemoryKind | "auto")}
              aria-label="Kind"
            >
              <option value="auto">{guess ? `${memoryKindLabel(guess)} (guessed)` : "Kind: automatic"}</option>
              {MEMORY_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <button type="submit" className="mem__add-go" disabled={!draft.trim()}>
              <Plus size={14} /> Remember
            </button>
          </div>
        </form>

        {flash && (
          <p className="mem__flash" role="status">
            {flash.text}
          </p>
        )}

        {access === "none" && (
          <p className="mem__note">
            <EyeOff size={13} /> The Assistant can't see your memories. Turn it on in this widget's settings.
          </p>
        )}

        {learned > 0 && filter !== "review" && (
          <button type="button" className="mem__review" onClick={() => setFilter("review")}>
            <Sparkles size={14} />
            <span>
              The Assistant learned {learned === 1 ? "something" : `${learned} things`} in chat. <u>Check {learned === 1 ? "it" : "them"}</u>
            </span>
          </button>
        )}

        {memories.length > 0 && (
          <>
            <div className="mem__search">
              <Search size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your memories"
                aria-label="Search your memories"
                onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              />
              {query && (
                <button type="button" className="mem__icon" onClick={() => setQuery("")} aria-label="Clear the search">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="mem__filters" role="tablist" aria-label="Show">
              {(
                [
                  ["all", "All"],
                  ["review", "To check"],
                  ...MEMORY_KINDS.map((k) => [k.id, k.label] as const),
                  ["hidden", "Hidden"],
                ] as [Filter, string][]
              )
                .filter(([id]) => id === "all" || counts[id])
                .map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={filter === id}
                    className={`mem__chip${filter === id ? " is-on" : ""}${id === "review" ? " is-review" : ""}`}
                    onClick={() => setFilter(id)}
                  >
                    {label} <span className="mem__count">{counts[id]}</span>
                  </button>
                ))}
            </div>
          </>
        )}

        {memories.length === 0 ? (
          <div className="mem__empty">
            <p className="mem__empty-title">Nothing remembered yet</p>
            <p>
              Add things you'd like the Assistant to keep in mind: people's names and birthdays, what you eat, when you work. Or
              tell it in chat, “remember that I'm vegetarian”.
            </p>
            <p className="mem__empty-small">Everything here stays on this computer. You can fix, hide or delete any of it.</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="mem__none">Nothing matches “{query}”.</p>
        ) : (
          groups.map((g) => (
            <section key={g.kind ?? "list"} className="mem__group">
              {g.kind && <h4>{memoryKindLabel(g.kind)}</h4>}
              <ul>
                {g.items.map((m) => (
                  <MemoryItem
                    key={m.id}
                    m={m}
                    fresh={flash?.id === m.id}
                    editing={editing === m.id}
                    showWhy={why === m.id}
                    onEdit={(on) => setEditing(on ? m.id : null)}
                    onWhy={() => setWhy(why === m.id ? null : m.id)}
                    onDelete={() => void remove([m], m.source === "assistant" && !m.reviewed ? "Forgotten" : "Deleted")}
                  />
                ))}
              </ul>
            </section>
          ))
        )}

        {filter === "review" && learned > 1 && (
          <div className="mem__review-all">
            <button
              type="button"
              className="mem__btn"
              onClick={() => {
                for (const m of memories.filter((x) => !x.reviewed)) void actions.updateMemory(m.id, { reviewed: true });
              }}
            >
              <Check size={13} /> Keep all {learned}
            </button>
          </div>
        )}

        {memories.length > 0 && access && access !== "none" && (
          <p className="mem__foot">
            The Assistant uses {memories.length - (counts.hidden ?? 0)} of {memories.length}
            {access === "read" ? ", and can't add new ones" : ""}.
          </p>
        )}
      </div>

      {undo && (
        <UndoToast
          key={undo.key}
          label={undo.label}
          onUndo={() => {
            void actions.putMemories(undo.rows);
            setUndo(null);
          }}
          onDismiss={() => setUndo(null)}
        />
      )}
    </div>
  );
}

function MemoryItem({
  m,
  fresh,
  editing,
  showWhy,
  onEdit,
  onWhy,
  onDelete,
}: {
  m: MemoryRecord;
  fresh: boolean;
  editing: boolean;
  showWhy: boolean;
  onEdit: (on: boolean) => void;
  onWhy: () => void;
  onDelete: () => void;
}) {
  const { actions } = useReadyStore();
  const [text, setText] = useState(m.text);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    setText(m.text);
    setError(null);
    const el = boxRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // grow with the text
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, editing]);

  const save = async () => {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) {
      setError("A memory can't be empty. Delete it instead.");
      return;
    }
    if (t !== m.text) await actions.updateMemory(m.id, { text: t });
    else if (!m.reviewed) await actions.updateMemory(m.id, { reviewed: true });
    onEdit(false);
  };

  const learned = m.source === "assistant";

  return (
    <li className={`mem__item${!m.assistantCanUse ? " is-hidden" : ""}${!m.reviewed ? " is-new" : ""}${fresh ? " is-fresh" : ""}`}>
      {editing ? (
        <div className="mem__edit">
          <textarea
            ref={boxRef}
            className="mem__edit-box"
            value={text}
            rows={1}
            maxLength={MEMORY_TEXT_MAX}
            aria-label="Memory"
            onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                onEdit(false);
              }
            }}
          />
          {error && <p className="mem__error">{error}</p>}
          <div className="mem__edit-row">
            <select
              className="mem__kind"
              value={m.kind}
              aria-label="Kind"
              onChange={(e) => void actions.updateMemory(m.id, { kind: e.target.value as MemoryKind })}
            >
              {MEMORY_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <span className="mem__spacer" />
            <button type="button" className="mem__btn" onClick={() => onEdit(false)}>
              Cancel
            </button>
            <button type="button" className="mem__btn is-main" onClick={() => void save()}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mem__row">
            {m.pinned && <Pin size={12} className="mem__pin" aria-label="Pinned" />}
            <button type="button" className="mem__text" onClick={() => onEdit(true)} title="Click to correct">
              {m.text}
            </button>
            <div className="mem__actions">
              <button
                type="button"
                className="mem__icon"
                onClick={() => void actions.updateMemory(m.id, { assistantCanUse: !m.assistantCanUse })}
                aria-label={m.assistantCanUse ? "Hide from the Assistant" : "Let the Assistant use this"}
                title={m.assistantCanUse ? "Hide from the Assistant" : "Let the Assistant use this"}
              >
                {m.assistantCanUse ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="mem__icon" aria-label="More">
                    <MoreHorizontal size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="mem__menu">
                  <DropdownMenuItem onSelect={() => onEdit(true)}>
                    <Pencil size={14} /> Correct
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void actions.updateMemory(m.id, { pinned: !m.pinned })}>
                    {m.pinned ? <PinOff size={14} /> : <Pin size={14} />} {m.pinned ? "Unpin" : "Pin (always given to the Assistant first)"}
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {MEMORY_KINDS.filter((k) => k.id !== m.kind).map((k) => (
                        <DropdownMenuItem key={k.id} onSelect={() => void actions.updateMemory(m.id, { kind: k.id })}>
                          {k.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="mem__danger" onSelect={onDelete}>
                    <Trash2 size={14} /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="mem__meta">
            {learned ? (
              <button type="button" className="mem__why" onClick={onWhy} aria-expanded={showWhy}>
                <Sparkles size={11} /> Learned in chat · {dateLabel(m.createdAt)}
              </button>
            ) : (
              <span>You added this · {dateLabel(m.createdAt)}</span>
            )}
            {m.updatedAt - m.createdAt > 60_000 && <span>· changed {dateLabel(m.updatedAt)}</span>}
            {!m.assistantCanUse && <span className="mem__tag">Hidden from the Assistant</span>}
          </div>
          {learned && showWhy && (
            <blockquote className="mem__context">
              {m.context ? (
                <>
                  You said: “{m.context}”
                </>
              ) : (
                "The message it came from wasn't kept."
              )}
            </blockquote>
          )}
          {!m.reviewed && (
            <div className="mem__check">
              <span>Is this right?</span>
              <button type="button" className="mem__btn is-main" onClick={() => void actions.updateMemory(m.id, { reviewed: true })}>
                <Check size={13} /> Keep
              </button>
              <button type="button" className="mem__btn" onClick={() => onEdit(true)}>
                <Pencil size={13} /> Fix
              </button>
              <button type="button" className="mem__btn" onClick={onDelete}>
                <Trash2 size={13} /> Forget
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

export function MemorySettingsForm() {
  const { snapshot, actions } = useReadyStore();
  const [access, setAccess] = useMemoryAccess();
  const [confirm, setConfirm] = useState(false);
  const n = snapshot.memories.length;
  return (
    <>
      <div className="wsettings__field">
        <span className="wsettings__label">The Assistant</span>
        <div className="seg" role="radiogroup" aria-label="What the Assistant may do with your memories">
          {(
            [
              ["none", "Off"],
              ["read", "Uses them"],
              ["write", "Uses and learns"],
            ] as [Access, string][]
          ).map(([a, label]) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={access === a}
              className={`seg__btn${access === a ? " is-active" : ""}`}
              onClick={() => void setAccess(a)}
            >
              {label}
            </button>
          ))}
        </div>
        <small className="wsettings__hint">
          {access === "none"
            ? "The Assistant doesn't see your memories and can't add any."
            : access === "read"
              ? "Every chat starts with the memories you haven't hidden. It can't add new ones."
              : "Every chat starts with the memories you haven't hidden, and when you tell it something worth keeping it saves it here for you to check."}{" "}
          This is the same switch as “Personal Memory” in Assistant settings.
        </small>
      </div>
      <small className="wsettings__hint">
        Your memories are kept on this computer. When the Assistant uses an online AI provider, the memories it may use are sent
        with each message, like the rest of the chat. Hide any you'd rather it never sees.
      </small>
      {n > 0 &&
        (confirm ? (
          <div className="mem__confirm">
            <span>Delete all {n} memories? This can't be undone.</span>
            <button
              type="button"
              className="mem__btn is-danger"
              onClick={() => {
                void actions.deleteMemories(snapshot.memories.map((m) => m.id));
                setConfirm(false);
              }}
            >
              Delete all
            </button>
            <button type="button" className="mem__btn" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="wsettings__link" onClick={() => setConfirm(true)}>
            Forget everything…
          </button>
        ))}
    </>
  );
}
