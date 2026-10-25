import { useEffect, useMemo, useState } from "react";

import { ArrowLeft, Copy, Loader2, RotateCcw, X } from "lucide-react";

import type { NoteVersion } from "../../../shared/types";
import { Markdown } from "./Markdown";
import { Button } from "./ui/button";

const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const dayYear = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function when(at: number): string {
  const d = new Date(at);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - start.getTime()) / 86_400_000);
  if (days === 0) return `Today, ${time.format(d)}`;
  if (days === 1) return `Yesterday, ${time.format(d)}`;
  const fmt = d.getFullYear() === today.getFullYear() ? day : dayYear;
  return `${fmt.format(d)}, ${time.format(d)}`;
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** The opening lines, so versions under the same heading still look different. */
function preview(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(#+|[-*]\s+\[[ xX]\]|[-*]|\d+\.)\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ");
}

type DiffLine = { type: "same" | "add" | "del"; text: string };

/** Line diff from `from` to `to` (longest common subsequence). */
function diffLines(from: string, to: string): DiffLine[] {
  const a = from.split("\n");
  const b = to.split("\n");
  // too big to compare line by line cheaply: show it as replaced
  if (a.length * b.length > 4_000_000) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * w + j + 1]! + 1
          : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      out.push({ type: "del", text: a[i++]! });
    } else {
      out.push({ type: "add", text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ type: "del", text: a[i++]! });
  while (j < b.length) out.push({ type: "add", text: b[j++]! });
  return out;
}

/**
 * The note's earlier versions: each stretch of writing is kept as one. Pick
 * one to read it, see what changed since, copy it or put it back.
 */
export function NoteHistory({
  widgetId,
  onRestore,
  onClose,
}: {
  widgetId: string;
  /** Resolves once the note shows the restored text. */
  onRestore: (version: NoteVersion, current: NoteVersion | undefined) => Promise<void>;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let live = true;
    window.mypa.db
      .noteHistory(widgetId)
      .then((vs) => live && setVersions(vs))
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [widgetId]);

  const current = versions?.[0];
  const open = versions?.find((v) => v.id === openId);
  const diff = useMemo(
    () => (open && current && compare ? diffLines(open.text, current.text) : null),
    [open, current, compare],
  );
  const changed = diff ? diff.filter((l) => l.type !== "same").length : 0;

  const restore = async (v: NoteVersion) => {
    setRestoring(true);
    try {
      await onRestore(v, current);
      onClose();
    } catch (err) {
      setError(`Couldn't restore: ${err instanceof Error ? err.message : String(err)}`);
      setRestoring(false);
    }
  };

  const copy = (v: NoteVersion) => {
    window.mypa.copyText(v.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="nhist" role="dialog" aria-label="Note history">
      <div className="wsettings__head">
        {open ? (
          <button
            type="button"
            className="nhist__back"
            onClick={() => {
              setOpenId(null);
              setCompare(false);
            }}
          >
            <ArrowLeft size={14} />
            {when(open.updatedAt)}
          </button>
        ) : (
          <span>History</span>
        )}
        <button
          type="button"
          className="widget__icon widget__close"
          aria-label="Close history"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      {error && (
        <p className="nhist__error" role="alert">
          {error}
        </p>
      )}

      {!versions ? (
        !error && (
          <p className="nhist__empty">
            <Loader2 size={13} className="nhist__spin" /> Loading…
          </p>
        )
      ) : open ? (
        <>
          <div className="nhist__view">
            {diff ? (
              changed === 0 ? (
                <p className="nhist__empty">Same as the current note.</p>
              ) : (
                <pre className="nhist__diff">
                  {diff.map((l, i) => (
                    <div key={i} className={`nhist__line nhist__line--${l.type}`}>
                      <span aria-hidden>
                        {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
                      </span>
                      {l.text || " "}
                    </div>
                  ))}
                </pre>
              )
            ) : open.text.trim() ? (
              <Markdown text={open.text} className="note__md" />
            ) : (
              <p className="nhist__empty">The note was empty.</p>
            )}
          </div>
          <div className="nhist__actions">
            {open.id !== current?.id && (
              <label className="nhist__toggle">
                <input
                  type="checkbox"
                  checked={compare}
                  onChange={(e) => setCompare(e.target.checked)}
                />
                Compare with now
              </label>
            )}
            <span className="nhist__spacer" />
            <Button variant="outline" size="sm" onClick={() => copy(open)}>
              <Copy size={13} />
              {copied ? "Copied" : "Copy"}
            </Button>
            {open.id !== current?.id && (
              <Button size="sm" disabled={restoring} onClick={() => void restore(open)}>
                <RotateCcw size={13} />
                Restore
              </Button>
            )}
          </div>
        </>
      ) : versions.length === 0 ? (
        <p className="nhist__empty">
          No history yet. Versions are kept as you write, one for each stretch of editing.
        </p>
      ) : (
        <ul className="nhist__list">
          {versions.map((v, i) => {
            const words = wordCount(v.text);
            return (
              <li key={v.id}>
                <button type="button" className="nhist__item" onClick={() => setOpenId(v.id)}>
                  <span className="nhist__meta num">
                    <span className="nhist__when">{when(v.updatedAt)}</span>
                    {i === 0 && <span className="nhist__tag">Current</span>}
                    <span className="nhist__words">
                      {words} {words === 1 ? "word" : "words"}
                    </span>
                  </span>
                  <span className="nhist__preview">{preview(v.text) || "Empty note"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
