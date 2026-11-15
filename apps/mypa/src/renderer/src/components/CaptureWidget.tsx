import { useEffect, useMemo, useState } from "react";

import {
  Archive,
  ArchiveRestore,
  Check,
  Copy,
  CornerUpRight,
  Keyboard,
  MoreHorizontal,
  NotebookPen,
  Search,
  Trash2,
  X,
} from "lucide-react";

import {
  CAPTURE_KINDS,
  hotkeyLabel,
  KIND_LABEL,
  type CaptureKind,
  type CaptureRow,
  type CaptureWidgetSettings,
} from "../../../shared/capture";
import type { Snapshot, WidgetRow } from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import { useUndo } from "../lib/useUndo";
import { CaptureComposer, captureError, KIND_ICON, useCaptureTools } from "./CaptureComposer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { UndoToast } from "./UndoToast";
import "../styles/capture.css";

type Filter = CaptureWidgetSettings["capFilter"];
const IS_MAC = navigator.platform.toLowerCase().includes("mac");

function dayLabel(ms: number, now: number): string {
  const a = new Date(ms);
  const b = new Date(now);
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  const days = Math.round((da - db) / 86_400_000); // + ahead, - ago
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  if (Math.abs(days) < 7) return a.toLocaleDateString(undefined, { weekday: "long" });
  return a.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: a.getFullYear() === b.getFullYear() ? undefined : "numeric",
  });
}

function when(ms: number, now: number, timeToo = true): string {
  const d = new Date(ms);
  const day = dayLabel(ms, now);
  const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const d2 = ["Today", "Yesterday", "Tomorrow"].includes(day) ? day.toLowerCase() : day;
  return timeToo ? `${d2} ${t}` : d2;
}

/** What the capture became, as it is now (done, moved, deleted…). */
function outcome(
  c: CaptureRow,
  s: Snapshot,
  money: (c: number) => string,
  now: number,
): { text: string; done: boolean; gone: boolean } {
  if (c.kind === "note") return { text: c.done ? "Note · dealt with" : "Note · in your inbox", done: c.done, gone: false };
  const missing = { text: `${KIND_LABEL[c.kind]} · deleted since`, done: false, gone: true };
  switch (c.kind) {
    case "task": {
      const t = s.tasks.find((x) => x.id === c.targetId);
      if (!t) return missing;
      const where = t.section === "today" ? "To-do › Today" : t.section === "backlog" ? "To-do › Backlog" : "To-do";
      const due =
        t.due === null
          ? ""
          : new Date(t.due).getHours() === 23 && new Date(t.due).getMinutes() === 59
            ? ` · due ${when(t.due, now, false)}`
            : ` · due ${when(t.due, now)}`;
      return { text: `Task · ${where}${due}${t.done ? " · done" : ""}`, done: t.done, gone: false };
    }
    case "reminder": {
      const r = s.reminders.find((x) => x.id === c.targetId);
      if (!r) return missing;
      const at = r.snoozedUntil ?? r.dueAt;
      return {
        text: `Reminder · ${at === null ? "no date" : when(at, now)}${r.doneAt ? " · done" : ""}`,
        done: r.doneAt !== null,
        gone: false,
      };
    }
    case "event": {
      const e = s.calendarEvents.find((x) => x.id === c.targetId);
      if (!e) return missing;
      const end = new Date(e.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      return { text: `Event · ${when(e.start, now)}–${end}`, done: e.end < now, gone: false };
    }
    case "expense": {
      const x = s.expenses.find((e) => e.id === c.targetId);
      if (!x) return missing;
      const cat = s.expenseCategories.find((k) => k.id === x.categoryId)?.name ?? "Other";
      return { text: `Expense · ${money(x.amount)} · ${cat}`, done: false, gone: false };
    }
  }
}

export function CaptureWidget({ widget, onOpenSettings }: { widget: WidgetRow; onOpenSettings: () => void }) {
  const { snapshot, actions } = useReadyStore();
  const { money } = useCaptureTools();
  const undo = useUndo(widget.id);
  const filter: Filter = (widget.settings.capFilter as Filter | undefined) ?? "all";
  const setFilter = (f: Filter) => void actions.updateWidgetSettings(widget.id, { capFilter: f });
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [showDealt, setShowDealt] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; error?: boolean } | null>(null);
  const [saved, setSaved] = useState<{ key: number; label: string; undo: () => void } | null>(null);
  const [hotkey, setHotkey] = useState<{ active: boolean; error: string | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const settings = snapshot.meta.capture;

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    void window.mypa.db.captureHotkeyStatus().then(setHotkey);
  }, [settings.hotkey, settings.hotkeyOn]);
  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(null), 8000);
    return () => window.clearTimeout(t);
  }, [saved]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const live = useMemo(() => snapshot.captures.filter((c) => !undo.hidden.has(c.id)), [snapshot.captures, undo.hidden]);
  const counts = useMemo(() => {
    const n: Record<string, number> = { all: live.length, inbox: 0 };
    for (const k of CAPTURE_KINDS) n[k] = 0;
    for (const c of live) {
      n[c.kind] = (n[c.kind] ?? 0) + 1;
      if (c.kind === "note" && !c.done) n.inbox! += 1;
    }
    return n;
  }, [live]);

  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    let l = live;
    if (filter === "inbox") l = l.filter((c) => c.kind === "note" && (showDealt || !c.done));
    else if (filter !== "all") l = l.filter((c) => c.kind === filter);
    if (q) l = l.filter((c) => c.text.toLowerCase().includes(q));
    return l;
  }, [live, filter, showDealt, q]);
  const dealtCount = filter === "inbox" ? live.filter((c) => c.kind === "note" && c.done).length : 0;

  const groups = useMemo(() => {
    const out: { label: string; items: CaptureRow[] }[] = [];
    for (const c of list) {
      const label = dayLabel(c.createdAt, now);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(c);
      else out.push({ label, items: [c] });
    }
    return out;
  }, [list, now]);

  const notes = snapshot.widgets.filter((w) => w.kind === "blank");
  const noteName = (w: WidgetRow) => {
    const first = String(w.settings.note ?? "").trim().split("\n")[0]?.slice(0, 30);
    return w.title && w.title !== "Note" ? w.title : first || "Untitled note";
  };

  const tryRun = async (p: Promise<void>, ok?: string): Promise<boolean> => {
    try {
      await p;
      if (ok) setFlash({ text: ok });
      return true;
    } catch (e) {
      setSaved(null);
      setFlash({ text: captureError(e), error: true });
      return false;
    }
  };

  const convert = (c: CaptureRow, k: CaptureKind) => {
    const from = c.kind;
    void tryRun(actions.convertCapture(c.id, k)).then(
      (ok) =>
        ok &&
        setSaved({
          key: Date.now(),
          label: `Moved to ${KIND_LABEL[k]}`,
          undo: () => void tryRun(actions.convertCapture(c.id, from)),
        }),
    );
  };

  const remove = (c: CaptureRow, everywhere: boolean) => {
    const what = c.text.length > 32 ? `${c.text.slice(0, 30)}…` : c.text;
    undo.schedule(c.id, everywhere ? `Deleted “${what}”` : `Removed “${what}” from the list`, () =>
      void actions.deleteCaptures([c.id], everywhere),
    );
  };

  const clearDealt = () => {
    const ids = live.filter((c) => c.kind === "note" && c.done).map((c) => c.id);
    if (!ids.length) return;
    const key = `dealt:${ids.join(",").slice(0, 60)}`;
    undo.schedule(key, `Cleared ${ids.length} dealt-with note${ids.length === 1 ? "" : "s"}`, () =>
      void actions.deleteCaptures(ids, false),
    );
  };

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "inbox", label: "Inbox" },
    { id: "task", label: "Tasks" },
    { id: "reminder", label: "Reminders" },
    { id: "event", label: "Events" },
    { id: "expense", label: "Expenses" },
  ];

  return (
    <div className="cap">
      <div className="cap__compose">
        <CaptureComposer
          onSaved={(s) => {
            setFlash(null);
            setSaved({
              key: Date.now(),
              label: `Saved: ${s.summary}`,
              undo: () => {
                if (s.id) void actions.deleteCaptures([s.id], true);
              },
            });
          }}
        />
      </div>

      <div className="cap__bar">
        <div className="cap__filters" role="tablist" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`cap__filter${filter === f.id ? " is-on" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.id === "inbox" && counts.inbox ? <span className="cap__count">{counts.inbox}</span> : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`cap__icon${searching ? " is-on" : ""}`}
          aria-label="Search captures"
          title="Search"
          onClick={() => {
            setSearching((v) => !v);
            setQuery("");
          }}
        >
          <Search size={14} />
        </button>
      </div>
      {searching && (
        <div className="cap__search">
          <Search size={13} />
          <input
            autoFocus
            value={query}
            placeholder="Search what you captured"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearching(false);
                setQuery("");
              }
            }}
          />
          {query && (
            <button type="button" className="cap__icon" aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <div className="cap__list">
        {groups.length === 0 && (
          <div className="cap__empty">
            {q ? (
              <p>Nothing matches “{query.trim()}”.</p>
            ) : filter === "inbox" ? (
              <>
                <p className="cap__empty-title">Inbox zero</p>
                <p>Ideas and loose thoughts you capture wait here until you deal with them.</p>
              </>
            ) : (
              <>
                <p className="cap__empty-title">Nothing captured yet</p>
                <p>
                  Type anything above. “Buy milk” becomes a task, “Call mom tomorrow 5pm” a reminder, “Lunch with
                  Ana Friday 1pm” an event, “uber 18” an expense, and anything else a note.
                </p>
              </>
            )}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.label} className="cap__group">
            <h4 className="cap__day">{g.label}</h4>
            <ul>
              {g.items.map((c) => {
                const Icon = KIND_ICON[c.kind];
                const o = outcome(c, snapshot, money, now);
                const expanded = open === c.id;
                const long = c.text.includes("\n") || c.text.length > 90;
                return (
                  <li key={c.id} className={`cap__item kind-${c.kind}${o.done ? " is-done" : ""}${o.gone ? " is-gone" : ""}`}>
                    <span className="cap__kindicon" title={KIND_LABEL[c.kind]}>
                      <Icon size={14} />
                    </span>
                    <div
                      className="cap__body"
                      role={long ? "button" : undefined}
                      tabIndex={long ? 0 : undefined}
                      onClick={() => long && setOpen(expanded ? null : c.id)}
                      onKeyDown={(e) => {
                        if (long && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          setOpen(expanded ? null : c.id);
                        }
                      }}
                    >
                      <p className={`cap__text${expanded ? " is-open" : ""}`}>{c.text}</p>
                      <p className="cap__where">
                        <span>{o.text}</span>
                        <span className="cap__time">
                          {new Date(c.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        </span>
                      </p>
                    </div>
                    <div className="cap__actions">
                      {c.kind === "note" && (
                        <button
                          type="button"
                          className="cap__icon"
                          aria-label={c.done ? "Back to inbox" : "Dealt with"}
                          title={c.done ? "Back to inbox" : "Dealt with"}
                          onClick={() => void tryRun(actions.setCaptureDone(c.id, !c.done))}
                        >
                          {c.done ? <ArchiveRestore size={14} /> : <Check size={14} />}
                        </button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="cap__icon" aria-label="More">
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="cap__menu">
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <CornerUpRight size={14} /> {c.kind === "note" ? "Turn into" : "Save as something else"}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {CAPTURE_KINDS.filter((k) => k !== c.kind).map((k) => {
                                const KI = KIND_ICON[k];
                                return (
                                  <DropdownMenuItem key={k} onSelect={() => convert(c, k)}>
                                    <KI size={14} /> {KIND_LABEL[k]}
                                  </DropdownMenuItem>
                                );
                              })}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          {c.kind === "note" && (
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger disabled={!notes.length}>
                                <NotebookPen size={14} /> Add to a note
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                <DropdownMenuLabel>Adds it to the end, then files it away</DropdownMenuLabel>
                                {notes.map((w) => (
                                  <DropdownMenuItem
                                    key={w.id}
                                    onSelect={() =>
                                      void tryRun(actions.captureToNote(c.id, w.id), `Added to “${noteName(w)}”`)
                                    }
                                  >
                                    {noteName(w)}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          )}
                          {c.kind === "note" && (
                            <DropdownMenuItem onSelect={() => void tryRun(actions.setCaptureDone(c.id, !c.done))}>
                              {c.done ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                              {c.done ? "Back to inbox" : "Dealt with"}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onSelect={() => {
                              window.mypa.copyText(c.text);
                              setFlash({ text: "Copied" });
                            }}
                          >
                            <Copy size={14} /> Copy text
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {c.kind !== "note" && !o.gone && (
                            <DropdownMenuItem onSelect={() => remove(c, false)}>
                              <X size={14} /> Remove from this list
                              <span className="cap__menu-note">keeps the {KIND_LABEL[c.kind].toLowerCase()}</span>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem variant="destructive" onSelect={() => remove(c, true)}>
                            <Trash2 size={14} />
                            {c.kind === "note" || o.gone ? "Delete" : `Delete the ${KIND_LABEL[c.kind].toLowerCase()} too`}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {filter === "inbox" && dealtCount > 0 && (
          <div className="cap__dealt">
            <button type="button" className="cap__link" onClick={() => setShowDealt((v) => !v)}>
              {showDealt ? "Hide" : "Show"} {dealtCount} dealt with
            </button>
            {showDealt && (
              <button type="button" className="cap__link" onClick={clearDealt}>
                Clear them
              </button>
            )}
          </div>
        )}
      </div>

      {flash && (flash.error || (!saved && !undo.latest)) && (
        <p className={`cap__flash${flash.error ? " is-error" : ""}`} role="status">
          {flash.text}
        </p>
      )}

      <footer className="cap__foot">
        <Keyboard size={13} />
        {settings.hotkeyOn && hotkey?.active ? (
          <span>
            <kbd>{hotkeyLabel(settings.hotkey, IS_MAC)}</kbd> opens a capture box from anywhere
          </span>
        ) : settings.hotkeyOn && hotkey?.error ? (
          <span className="is-error">{hotkey.error}</span>
        ) : (
          <span>The capture shortcut is off</span>
        )}
        <button type="button" className="cap__link" onClick={onOpenSettings}>
          Change
        </button>
      </footer>

      {undo.latest ? (
        <UndoToast
          key={undo.latest.id}
          label={undo.latest.label}
          onUndo={() => undo.undo(undo.latest!.id)}
          onDismiss={() => undo.finish(undo.latest!.id)}
        />
      ) : (
        saved && (
          <UndoToast
            key={saved.key}
            label={saved.label}
            onUndo={() => {
              saved.undo();
              setSaved(null);
            }}
            onDismiss={() => setSaved(null)}
          />
        )
      )}
    </div>
  );
}
