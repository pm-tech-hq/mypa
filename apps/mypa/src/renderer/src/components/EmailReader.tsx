import { useEffect, useRef, useState } from "react";

import {
  Archive,
  ArrowLeft,
  Download,
  Forward,
  ImageOff,
  Inbox,
  ListPlus,
  Loader2,
  Mail,
  Paperclip,
  Reply,
  ReplyAll,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";

import type {
  EmailAccount,
  EmailAction,
  EmailMessage,
  EmailSummary,
} from "../../../shared/email";
import {
  forwardCompose,
  formatAddress,
  formatSize,
  fullWhen,
  personName,
  replyCompose,
  summaryMessages,
  type ComposeState,
} from "../lib/email";
import { streamChat, type ChatHandle } from "../lib/flashcards";
import { useReadyStore } from "../lib/store";
import { errorText } from "../lib/tutor";
import { Avatar, CategoryPicker } from "./EmailBits";
import { Markdown } from "./Markdown";

/** Styles every email gets inside its frame: readable defaults that the email's own CSS can override. */
const FRAME_BASE = `<style>
html{background:#fff;color:#1a1a1a}
body{margin:0;padding:14px 16px;font:14px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}
img{max-width:100%;height:auto}
a{color:#2563eb}
blockquote{margin:0 0 0 8px;padding-left:10px;border-left:2px solid #ddd;color:#555}
pre{white-space:pre-wrap}
</style>`;

export function EmailReader({
  summary,
  account,
  aiTarget,
  categories,
  onBack,
  onCompose,
  onAct,
  onCategory,
  onFlags,
}: {
  summary: EmailSummary;
  account: EmailAccount | undefined;
  aiTarget: string;
  categories: string[];
  onBack: () => void;
  onCompose: (draft: ComposeState) => void;
  onAct: (action: EmailAction) => Promise<void>;
  onCategory: (category: string | null) => void;
  onFlags: (patch: Partial<EmailSummary>) => void;
}) {
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingImages, setLoadingImages] = useState(false);
  const [flagged, setFlagged] = useState(summary.flagged);
  const [saving, setSaving] = useState<number | null>(null);
  const [aiSummary, setAiSummary] = useState<{ text: string; busy: boolean; error?: string } | null>(
    null,
  );
  const handle = useRef<ChatHandle | null>(null);
  const { actions } = useReadyStore();
  const [tasked, setTasked] = useState(false);

  useEffect(() => {
    let live = true;
    window.mypa.email
      .open(summary.id)
      .then((m) => live && setMessage(m))
      .catch((err: unknown) => live && setError(errorText(err)));
    return () => {
      live = false;
      handle.current?.cancel();
    };
  }, [summary.id]);

  const showImages = async () => {
    setLoadingImages(true);
    try {
      setMessage(await window.mypa.email.loadImages(summary.id));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingImages(false);
    }
  };

  const summarize = async () => {
    if (!message) return;
    handle.current?.cancel();
    setAiSummary({ text: "", busy: true });
    const h = streamChat(aiTarget, summaryMessages(message), {
      delta: (text) => setAiSummary({ text, busy: true }),
    });
    handle.current = h;
    try {
      const text = await h.done;
      if (handle.current === h) setAiSummary({ text, busy: false });
    } catch (err) {
      setAiSummary({ text: "", busy: false, error: errorText(err) });
    }
  };

  const toggleStar = async () => {
    const next = !flagged;
    setFlagged(next);
    onFlags({ flagged: next });
    try {
      await window.mypa.email.act([summary.id], next ? "star" : "unstar");
    } catch (err) {
      setFlagged(!next);
      onFlags({ flagged: !next });
      setError(errorText(err));
    }
  };

  const save = async (index: number) => {
    setSaving(index);
    try {
      await window.mypa.email.saveAttachment(summary.id, index);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(null);
    }
  };

  const m = message;
  const folder = summary.folder;

  return (
    <div className="email email--reader">
      <div className="email__bar">
        <button type="button" className="email__icon" aria-label="Back to the list" onClick={onBack}>
          <ArrowLeft size={15} />
        </button>
        <span className="email__spacer" />
        <CategoryPicker choices={categories} current={summary.category} onPick={onCategory} />
        {folder === "inbox" || folder === "starred" ? (
          <button
            type="button"
            className="email__icon"
            title="Archive"
            aria-label="Archive"
            onClick={() => void onAct("archive")}
          >
            <Archive size={14} />
          </button>
        ) : (
          folder !== "sent" && (
            <button
              type="button"
              className="email__icon"
              title="Move to inbox"
              aria-label="Move to inbox"
              onClick={() => void onAct("inbox")}
            >
              <Inbox size={14} />
            </button>
          )
        )}
        <button
          type="button"
          className="email__icon"
          title={folder === "trash" ? "Delete for good" : "Delete"}
          aria-label={folder === "trash" ? "Delete for good" : "Delete"}
          onClick={() => void onAct("trash")}
        >
          <Trash2 size={14} />
        </button>
        <button
          type="button"
          className={`email__icon${tasked ? " is-on" : ""}`}
          title={tasked ? "Added to your to-do list" : "Add to your to-do list"}
          aria-label="Add to your to-do list"
          disabled={tasked}
          onClick={async () => {
            const subject = summary.subject || "(no subject)";
            await actions.createTask({ title: `${personName(summary.from)}: ${subject}`.slice(0, 200) });
            setTasked(true);
          }}
        >
          <ListPlus size={14} />
        </button>
        <button
          type="button"
          className="email__icon"
          title="Mark as unread"
          aria-label="Mark as unread"
          onClick={() => {
            onFlags({ seen: false });
            void window.mypa.email.act([summary.id], "unread");
            onBack();
          }}
        >
          <Mail size={14} />
        </button>
        <button
          type="button"
          className={`email__icon${flagged ? " is-starred" : ""}`}
          title={flagged ? "Remove star" : "Star"}
          aria-label={flagged ? "Remove star" : "Star"}
          onClick={() => void toggleStar()}
        >
          <Star size={14} />
        </button>
      </div>

      <div className="email__head">
        <h3 className="email__title">{(m ?? summary).subject || "(no subject)"}</h3>
        <div className="email__byline">
          <Avatar person={(m ?? summary).from} />
          <div className="email__byline-text">
            <div className="email__people">
              <span className="email__sender" title={formatAddress((m ?? summary).from)}>
                {personName((m ?? summary).from)}
                {(m ?? summary).from.name && (
                  <span className="email__address"> {(m ?? summary).from.address}</span>
                )}
              </span>
              <span className="email__date num">{fullWhen((m ?? summary).date)}</span>
            </div>
            <div className="email__to">
              to {(m ?? summary).to.map(personName).join(", ") || "—"}
              {(m ?? summary).cc.length > 0 && (
                <> · cc {(m ?? summary).cc.map(personName).join(", ")}</>
              )}
              {account && <> · {account.label}</>}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="email__notice" role="alert">
          <span>{error}</span>
        </div>
      )}

      {aiSummary && (
        <div className="email__catchup">
          <div className="email__catchup-head">
            <Sparkles size={13} aria-hidden="true" />
            <span>Summary</span>
            {aiSummary.busy && <Loader2 size={12} className="email__spin" aria-label="Writing" />}
            <span className="email__spacer" />
            <button
              type="button"
              className="email__icon email__icon--sm"
              aria-label="Close summary"
              onClick={() => {
                handle.current?.cancel();
                handle.current = null;
                setAiSummary(null);
              }}
            >
              <X size={12} />
            </button>
          </div>
          {aiSummary.error ? (
            <p className="email__catchup-error">{aiSummary.error}</p>
          ) : aiSummary.text ? (
            <Markdown text={aiSummary.text} className="email__catchup-body note__md" />
          ) : (
            <p className="email__catchup-wait">Reading…</p>
          )}
        </div>
      )}

      {m && m.blockedImages > 0 && (
        <div className="email__images">
          <ImageOff size={13} aria-hidden="true" />
          <span>
            {m.blockedImages} {m.blockedImages === 1 ? "image" : "images"} hidden, so the sender
            can't tell you opened this.
          </span>
          <button
            type="button"
            className="email__link"
            disabled={loadingImages}
            onClick={() => void showImages()}
          >
            {loadingImages ? "Loading…" : "Show images"}
          </button>
        </div>
      )}

      <div className="email__body">
        {!m ? (
          !error && (
            <p className="email__empty-text email__list-msg">
              <Loader2 size={13} className="email__spin" /> Opening…
            </p>
          )
        ) : m.html ? (
          <iframe
            className="email__frame"
            title="Email"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={FRAME_BASE + m.html}
          />
        ) : (
          <div className="email__text">{m.text || "This email has no text."}</div>
        )}
      </div>

      {m && m.attachments.length > 0 && (
        <div className="email__files">
          {m.attachments.map((a) => (
            <button
              key={a.index}
              type="button"
              className="email__file"
              title={`Save ${a.filename}`}
              disabled={saving === a.index}
              onClick={() => void save(a.index)}
            >
              <Paperclip size={12} aria-hidden="true" />
              <span className="email__file-name">{a.filename}</span>
              <span className="email__file-size num">{formatSize(a.size)}</span>
              {saving === a.index ? (
                <Loader2 size={12} className="email__spin" />
              ) : (
                <Download size={12} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}

      <div className="email__replybar">
        <button
          type="button"
          className="email__btn"
          disabled={!m}
          onClick={() => m && onCompose(replyCompose(m, account, false))}
        >
          <Reply size={13} />
          Reply
        </button>
        {m && m.to.length + m.cc.length > 1 && (
          <button
            type="button"
            className="email__btn"
            onClick={() => onCompose(replyCompose(m, account, true))}
          >
            <ReplyAll size={13} />
            Reply all
          </button>
        )}
        <button
          type="button"
          className="email__btn"
          disabled={!m}
          onClick={() => m && onCompose(forwardCompose(m, account))}
        >
          <Forward size={13} />
          Forward
        </button>
        <span className="email__spacer" />
        {aiTarget !== "off" && (
          <>
            <button type="button" className="email__btn" disabled={!m} onClick={() => void summarize()}>
              <Sparkles size={13} />
              Summarize
            </button>
            <button
              type="button"
              className="email__btn"
              disabled={!m}
              onClick={() => m && onCompose({ ...replyCompose(m, account, false), aiStart: true })}
            >
              <Sparkles size={13} />
              Draft reply
            </button>
          </>
        )}
      </div>
    </div>
  );
}
