import { useEffect, useRef, useState } from "react";

import { History } from "lucide-react";

import { useReadyStore } from "../lib/store";
import type { NoteVersion, WidgetRow } from "../../../shared/types";
import { Markdown, toggleTaskLine } from "./Markdown";
import { NoteHistory } from "./NoteHistory";

const SAVE_DELAY = 400;

/**
 * A note kept in the widget's own settings. It reads as formatted text and
 * turns into an editor on click; `- [ ]` lines are checkboxes you can tick
 * without leaving the reading view.
 */
export function BlankWidget({ widget }: { widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const stored = widget.settings.note ?? "";
  const [note, setNote] = useState(stored);
  const [editing, setEditing] = useState(stored.trim() === "");
  const [saved, setSaved] = useState(true);
  const editor = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const caret = useRef<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The text a restore replaced, for a few seconds of Undo. */
  const [undoTo, setUndoTo] = useState<NoteVersion | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);

  // Adopt external changes (another instance of the same widget, a Tutor save).
  useEffect(() => {
    if (pending.current === null) setNote(stored);
  }, [stored]);

  const flush = () => {
    window.clearTimeout(timer.current);
    if (pending.current === null) return;
    void actions.updateWidgetSettings(widget.id, { note: pending.current });
    pending.current = null;
    setSaved(true);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Never drop the last keystrokes: save whatever is pending when the widget goes away.
  useEffect(() => () => flushRef.current(), []);

  useEffect(() => {
    if (!editing) return;
    const el = editor.current;
    if (!el) return;
    el.focus();
    const at = caret.current ?? el.value.length;
    el.setSelectionRange(at, at);
    caret.current = null;
  }, [editing]);

  const change = (value: string, immediate = false) => {
    setNote(value);
    setSaved(false);
    setUndoTo(null);
    pending.current = value;
    window.clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = window.setTimeout(flush, SAVE_DELAY);
  };

  const openHistory = () => {
    flush();
    setHistoryOpen(true);
  };

  const restore = async (version: NoteVersion, current: NoteVersion | undefined) => {
    flush();
    await actions.restoreNoteVersion(widget.id, version.id);
    setEditing(false);
    window.clearTimeout(undoTimer.current);
    setUndoTo(current ?? null);
    undoTimer.current = window.setTimeout(() => setUndoTo(null), 8_000);
  };

  const undoRestore = () => {
    window.clearTimeout(undoTimer.current);
    if (undoTo) void actions.restoreNoteVersion(widget.id, undoTo.id);
    setUndoTo(null);
  };

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const words = note.trim() ? note.trim().split(/\s+/).length : 0;

  return (
    <div className="note">
      {historyOpen && (
        <NoteHistory
          widgetId={widget.id}
          onRestore={restore}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {editing ? (
        <textarea
          ref={editor}
          className="blank-note"
          value={note}
          aria-label="Note"
          placeholder={"Write anything.\n\n# A heading\n- a list item\n- [ ] something to tick off"}
          onChange={(e) => change(e.target.value)}
          onBlur={() => {
            flush();
            if (note.trim()) setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && note.trim()) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <div
          className="note__read"
          role="button"
          tabIndex={0}
          aria-label="Note. Click to edit"
          onClick={(e) => {
            // keep link clicks and text selection from flipping into edit mode
            if ((e.target as HTMLElement).closest("a, button")) return;
            if (window.getSelection()?.toString()) return;
            setEditing(true);
          }}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter") {
              e.preventDefault();
              setEditing(true);
            }
          }}
        >
          <Markdown
            text={note}
            className="note__md"
            onToggleTask={(line) => change(toggleTaskLine(note, line), true)}
          />
        </div>
      )}
      <div className="note__foot num" aria-live="polite">
        <span>
          {words} {words === 1 ? "word" : "words"}
        </span>
        <span className="note__foot-end">
          {undoTo ? (
            <>
              Restored
              <button type="button" className="note__foot-btn" onClick={undoRestore}>
                Undo
              </button>
            </>
          ) : (
            <>
              {saved ? "Saved" : "Saving…"}
              <button
                type="button"
                className="note__foot-btn"
                title="Earlier versions of this note"
                onClick={openHistory}
              >
                <History size={12} aria-hidden />
                History
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
