import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";

import {
  AlertCircle,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileAudio,
  Globe,
  Link2,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  DEFAULT_TRANSCRIBE_SETTINGS,
  type TranscribeSettings,
  type TranscriptRow,
  type WidgetRow,
} from "../../../shared/types";
import { formatCreatedAt, formatDuration, KIND_LABEL, looksLikeMedia } from "../lib/transcribe";
import { useReadyStore } from "../lib/store";
import { useUndo } from "../lib/useUndo";
import "../styles/transcribe.css";
import { EditableText } from "./EditableText";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";
import { UndoToast } from "./UndoToast";

const KIND_ICON: Record<TranscriptRow["kind"], typeof FileAudio> = {
  file: FileAudio,
  url_media: Link2,
  page: Globe,
};

const MEDIA_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus|mp4|mov|mkv|webm|avi|m4v)$/i;
const SEARCH_FROM = 4;

export function TranscribeWidget({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const settings: TranscribeSettings = { ...DEFAULT_TRANSCRIBE_SETTINGS, ...widget.settings };
  const undo = useUndo(widget.id);

  const [linkOpen, setLinkOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  /** null = follow the detection; otherwise the user's explicit choice. */
  const [modeOverride, setModeOverride] = useState<"media" | "page" | null>(null);
  const [picking, setPicking] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dropping, setDropping] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragDepth = useRef(0);

  const all = useMemo(
    () => snapshot.transcripts.filter((t) => !undo.hidden.has(t.id)),
    [snapshot.transcripts, undo.hidden],
  );
  const q = query.trim().toLowerCase();
  const transcripts = useMemo(
    () =>
      q
        ? all.filter((t) => t.title.toLowerCase().includes(q) || t.text.toLowerCase().includes(q))
        : all,
    [all, q],
  );

  const detected = looksLikeMedia(urlInput) ? "media" : "page";
  const mode = modeOverride ?? detected;

  const pickFile = async () => {
    setPicking(true);
    await actions.pickAndTranscribeFile(settings.modelSize);
    setPicking(false);
  };

  const submitUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    if (mode === "media") {
      await actions.transcribeUrlMedia({
        url,
        modelSize: settings.modelSize,
        ytdlpPath: settings.ytdlpPath,
      });
    } else {
      await actions.transcribePage({ url });
    }
    setUrlInput("");
    setModeOverride(null);
    setLinkOpen(false);
  };

  /* ---- drop files on the widget ---------------------------------------- */
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current += 1;
    setDropping(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDropping(false);
    const files = Array.from(e.dataTransfer.files);
    const media = files.filter((f) => MEDIA_EXT.test(f.name));
    const skipped = files.length - media.length;
    setDropError(
      skipped > 0
        ? `${skipped === 1 ? "One file isn't" : `${skipped} files aren't`} audio or video, so ${skipped === 1 ? "it was" : "they were"} skipped.`
        : null,
    );
    const paths = media.map((f) => window.mypa.db.pathForFile(f)).filter(Boolean);
    if (paths.length) void actions.transcribeFiles(paths, settings.modelSize);
  };

  const remove = (t: TranscriptRow) => {
    if (expandedId === t.id) setExpandedId(null);
    undo.schedule(t.id, `Deleted “${t.title}”`, () => void actions.deleteTranscript(t.id));
  };

  return (
    <div
      className={`xcr${dropping ? " xcr--dropping" : ""}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="xcr__head">
        <div className="xcr__sources" role="group" aria-label="Transcribe from">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void pickFile()}
            disabled={picking}
          >
            {picking ? <Loader2 className="xcr__spin" /> : <FileAudio />}
            File
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={linkOpen ? "xcr__mode-btn is-active" : "xcr__mode-btn"}
            aria-pressed={linkOpen}
            onClick={() => {
              setLinkOpen((v) => !v);
              setUrlInput("");
              setModeOverride(null);
            }}
          >
            <Link2 />
            Link
          </Button>
        </div>
        {all.length >= SEARCH_FROM && (
          <label className="xcr__search">
            <Search size={13} aria-hidden />
            <input
              value={query}
              placeholder="Search transcripts"
              aria-label="Search transcripts"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                <X size={12} />
              </button>
            )}
          </label>
        )}
      </div>

      {linkOpen && (
        <div className="xcr__link">
          <div className="xcr__url-row">
            <Input
              autoFocus
              placeholder="Paste a video, podcast or web page link…"
              aria-label="Link to transcribe"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitUrl();
                if (e.key === "Escape") setLinkOpen(false);
              }}
            />
            <Button type="button" onClick={() => void submitUrl()} disabled={!urlInput.trim()}>
              Transcribe
            </Button>
          </div>
          {urlInput.trim() && (
            <div className="xcr__mode" role="radiogroup" aria-label="What to take from the link">
              <span className="xcr__mode-label">Take</span>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "media"}
                className={mode === "media" ? "is-on" : ""}
                onClick={() => setModeOverride("media")}
              >
                the audio
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "page"}
                className={mode === "page" ? "is-on" : ""}
                onClick={() => setModeOverride("page")}
              >
                the page text
              </button>
            </div>
          )}
        </div>
      )}

      {dropError && (
        <p className="xcr__notice" role="status">
          <AlertCircle size={13} aria-hidden />
          <span>{dropError}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setDropError(null)}>
            <X size={12} />
          </button>
        </p>
      )}

      <div className="xcr__scroll">
        {all.length === 0 && (
          <div className="blankstate">
            <span className="blankstate__icon">
              <FileAudio size={16} />
            </span>
            <p className="blankstate__title">Nothing transcribed yet</p>
            <p className="blankstate__text">
              Drop an audio or video file here, pick one, or paste a link to a video or a web page.
              Everything runs on this computer.
            </p>
          </div>
        )}
        {all.length > 0 && transcripts.length === 0 && (
          <p className="xcr__empty">No transcript mentions “{query.trim()}”.</p>
        )}
        <ul className="xcr__list">
          {transcripts.map((t) => (
            <TranscriptItem
              key={t.id}
              row={t}
              query={q}
              expanded={expandedId === t.id}
              onToggle={() => setExpandedId((cur) => (cur === t.id ? null : t.id))}
              onDelete={() => remove(t)}
              onRename={(title) => void actions.renameTranscript(t.id, title)}
              onRetry={() =>
                void actions.retryTranscript({
                  id: t.id,
                  modelSize: settings.modelSize,
                  ytdlpPath: settings.ytdlpPath,
                })
              }
            />
          ))}
        </ul>
      </div>

      {dropping && (
        <div className="xcr__drop" aria-hidden>
          <Upload size={18} />
          <span>Drop audio or video to transcribe</span>
        </div>
      )}

      {undo.latest && (
        <UndoToast
          key={undo.latest.id}
          label={undo.latest.label}
          onUndo={() => undo.undo(undo.latest!.id)}
          onDismiss={() => undo.finish(undo.latest!.id)}
        />
      )}
    </div>
  );
}

function TranscriptItem({
  row,
  query,
  expanded,
  onToggle,
  onDelete,
  onRename,
  onRetry,
}: {
  row: TranscriptRow;
  query: string;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onRetry: () => void;
}) {
  const Icon = KIND_ICON[row.kind];
  const duration = formatDuration(row.durationMs);
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [saved, setSaved] = useState(false);
  const done = row.status === "done";
  const isUrl = /^https?:\/\//i.test(row.source);

  const copy = () => {
    window.mypa.copyText(row.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const save = async () => {
    if (await window.mypa.db.exportTranscript(row.id)) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  };

  const meta = (
    <span className="xcr__row-meta num">
      <span>{KIND_LABEL[row.kind]}</span>
      {duration && <span>{duration}</span>}
      {done && <span>{row.wordCount.toLocaleString()} words</span>}
      {row.status === "processing" && <span>{Math.round(row.progress)}%</span>}
      {row.status === "pending" && <span>Waiting…</span>}
      <span>{formatCreatedAt(row.createdAt)}</span>
    </span>
  );

  return (
    <li className={`xcr__item${expanded ? " xcr__item--open" : ""}`}>
      <div className="xcr__row">
        <Icon size={15} className="xcr__row-icon" aria-hidden />
        {renaming ? (
          <div className="xcr__row-main">
            <EditableText
              autoEdit
              className="xcr__row-title"
              label="Transcript name"
              value={row.title}
              onSave={onRename}
              onEditEnd={() => setRenaming(false)}
            />
            {meta}
          </div>
        ) : done ? (
          <button
            type="button"
            className="xcr__row-main xcr__row-main--clickable"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            <span className="xcr__row-title">{row.title}</span>
            {meta}
          </button>
        ) : (
          <div className="xcr__row-main">
            <span className="xcr__row-title">{row.title}</span>
            {meta}
            {row.status === "processing" && (
              <Progress value={row.progress} className="xcr__progress" />
            )}
            {row.status === "error" && (
              <span className="xcr__error">
                <AlertCircle size={11} aria-hidden />
                {row.errorMessage ?? "Something went wrong."}
              </span>
            )}
          </div>
        )}
        <div className="xcr__row-actions">
          {(row.status === "processing" || row.status === "pending") && (
            <Loader2 size={14} className="xcr__spin" aria-label="Working" />
          )}
          {row.status === "error" && (
            <button type="button" className="xcr__retry" onClick={onRetry}>
              <RotateCcw size={12} aria-hidden />
              Retry
            </button>
          )}
          {!expanded && (
            <button
              type="button"
              className="icon-btn xcr__delete"
              aria-label={`Delete ${row.title}`}
              title="Delete"
              onClick={onDelete}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {expanded && done && (
        <div className="xcr__body">
          <div className="xcr__body-actions">
            <button type="button" onClick={copy}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" onClick={() => void save()}>
              {saved ? <Check size={12} /> : <Download size={12} />}
              {saved ? "Saved" : "Save as…"}
            </button>
            <button type="button" onClick={() => setRenaming(true)}>
              <Pencil size={12} aria-hidden />
              Rename
            </button>
            {isUrl && (
              <button
                type="button"
                onClick={() => void window.mypa.market.openExternal(row.source)}
              >
                <ExternalLink size={12} aria-hidden />
                Source
              </button>
            )}
            <button type="button" className="xcr__body-delete" onClick={onDelete}>
              <Trash2 size={12} aria-hidden />
              Delete
            </button>
          </div>
          <div className="xcr__text" tabIndex={0} aria-label={`Transcript of ${row.title}`}>
            {row.text ? highlight(row.text, query) : "(no speech detected)"}
          </div>
        </div>
      )}
    </li>
  );
}

/** Wraps every match of `query` in <mark>, so search hits are easy to find. */
function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let at = 0;
  let hit = lower.indexOf(query);
  while (hit !== -1 && parts.length < 400) {
    if (hit > at) parts.push(text.slice(at, hit));
    parts.push(<mark key={hit}>{text.slice(hit, hit + query.length)}</mark>);
    at = hit + query.length;
    hit = lower.indexOf(query, at);
  }
  parts.push(text.slice(at));
  return parts;
}
