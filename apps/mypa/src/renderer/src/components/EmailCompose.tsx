import { useEffect, useRef, useState } from "react";

import { ArrowLeft, Loader2, Paperclip, Send, Sparkles, Square, X } from "lucide-react";

import type { EmailAccount, EmailMessage } from "../../../shared/email";
import { formatSize, splitBody, writeMessages, type ComposeState } from "../lib/email";
import { streamChat, type ChatHandle } from "../lib/flashcards";
import { errorText } from "../lib/tutor";

const unsentKey = (widgetId: string) => `mypa.email.unsent.${widgetId}`;

/** An email you started and left without sending, kept for this widget. */
export function readUnsent(widgetId: string): ComposeState | null {
  try {
    const raw = localStorage.getItem(unsentKey(widgetId));
    return raw ? (JSON.parse(raw) as ComposeState) : null;
  } catch {
    return null;
  }
}

export function clearUnsent(widgetId: string): void {
  try {
    localStorage.removeItem(unsentKey(widgetId));
  } catch {
    /* nothing kept */
  }
}

function keepUnsent(widgetId: string, c: ComposeState): void {
  try {
    // picked files can't outlive the session; the rest can
    localStorage.setItem(unsentKey(widgetId), JSON.stringify({ ...c, files: [], aiStart: false }));
  } catch {
    /* storage full or blocked: the draft just isn't kept */
  }
}

export function EmailCompose({
  widgetId,
  initial,
  accounts,
  aiTarget,
  onClose,
}: {
  widgetId: string;
  initial: ComposeState;
  accounts: EmailAccount[];
  aiTarget: string;
  /** `sent` is false when the user left it (kept as unsent) or discarded it. */
  onClose: (sent: boolean) => void;
}) {
  const [c, setC] = useState<ComposeState>(() => ({
    ...initial,
    accountId: accounts.some((a) => a.id === initial.accountId)
      ? initial.accountId
      : (accounts[0]?.id ?? ""),
  }));
  const [showCc, setShowCc] = useState(Boolean(initial.cc || initial.bcc));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [writing, setWriting] = useState(false);
  const handle = useRef<ChatHandle | null>(null);
  const original = useRef<EmailMessage | null>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const touched = useRef(false);

  const set = (patch: Partial<ComposeState>) => {
    touched.current = true;
    setC((cur) => ({ ...cur, ...patch }));
  };

  // the unsent copy follows every change
  useEffect(() => {
    if (touched.current) keepUnsent(widgetId, c);
  }, [c, widgetId]);

  useEffect(() => {
    if (initial.aiStart) void write("");
    else {
      body.current?.focus();
      body.current?.setSelectionRange(0, 0);
    }
    return () => handle.current?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  const account = accounts.find((a) => a.id === c.accountId);

  /** Lets the AI write the part above the quote, keeping the quote and signature. */
  const write = async (ask: string) => {
    handle.current?.cancel();
    setError(null);
    setWriting(true);
    try {
      if (c.replyToId && !original.current)
        original.current = await window.mypa.email.open(c.replyToId);
      const { top, rest } = splitBody(c.text);
      const h = streamChat(
        aiTarget,
        writeMessages({
          instruction: ask,
          draft: top,
          original: original.current,
          fromName: account?.displayName || "",
        }),
        { delta: (text) => setC((cur) => ({ ...cur, text: `${text.trim()}\n${rest}` })) },
      );
      handle.current = h;
      const text = await h.done;
      if (handle.current === h) {
        touched.current = true;
        setC((cur) => ({ ...cur, text: `${text.trim()}\n${rest}` }));
        setInstruction("");
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setWriting(false);
    }
  };

  const attach = async () => {
    const files = await window.mypa.email.pickFiles();
    if (files.length) set({ files: [...c.files, ...files] });
  };

  const send = async () => {
    handle.current?.cancel();
    setSending(true);
    setError(null);
    try {
      await window.mypa.email.send({
        accountId: c.accountId,
        to: c.to,
        cc: c.cc,
        bcc: c.bcc,
        subject: c.subject,
        text: c.text,
        files: c.files.map((f) => f.token),
        replyToId: c.replyToId,
        forwardOfId: c.forwardOfId,
        dropAttachments: c.dropAttachments,
      });
      clearUnsent(widgetId);
      onClose(true);
    } catch (err) {
      setError(errorText(err));
      setSending(false);
    }
  };

  const canSend = Boolean(c.accountId && (c.to.trim() || c.cc.trim() || c.bcc.trim())) && !sending;

  return (
    <div
      className="email email--compose"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSend) {
          e.preventDefault();
          void send();
        }
      }}
    >
      <div className="email__bar">
        <button
          type="button"
          className="email__icon"
          aria-label="Back (keeps this as unsent)"
          title="Back. The email is kept until you send or discard it."
          onClick={() => {
            handle.current?.cancel();
            if (touched.current) keepUnsent(widgetId, c);
            onClose(false);
          }}
        >
          <ArrowLeft size={15} />
        </button>
        <span className="email__compose-title">
          {c.replyToId ? "Reply" : c.forwardOfId ? "Forward" : "New email"}
        </span>
        <span className="email__spacer" />
        <button
          type="button"
          className="email__link"
          onClick={() => {
            handle.current?.cancel();
            clearUnsent(widgetId);
            onClose(false);
          }}
        >
          Discard
        </button>
        <button type="button" className="email__send" disabled={!canSend} onClick={() => void send()}>
          {sending ? <Loader2 size={13} className="email__spin" /> : <Send size={13} />}
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      <div className="email__fields">
        {accounts.length > 1 && (
          <label className="email__field">
            <span>From</span>
            <select value={c.accountId} onChange={(e) => set({ accountId: e.target.value })}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName ? `${a.displayName} <${a.address}>` : a.address}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="email__field">
          <span>To</span>
          <input value={c.to} onChange={(e) => set({ to: e.target.value })} autoComplete="off" />
          {!showCc && (
            <button type="button" className="email__link" onClick={() => setShowCc(true)}>
              Cc/Bcc
            </button>
          )}
        </label>
        {showCc && (
          <>
            <label className="email__field">
              <span>Cc</span>
              <input value={c.cc} onChange={(e) => set({ cc: e.target.value })} autoComplete="off" />
            </label>
            <label className="email__field">
              <span>Bcc</span>
              <input value={c.bcc} onChange={(e) => set({ bcc: e.target.value })} autoComplete="off" />
            </label>
          </>
        )}
        <label className="email__field">
          <span>Subject</span>
          <input value={c.subject} onChange={(e) => set({ subject: e.target.value })} />
        </label>
      </div>

      <textarea
        ref={body}
        className="email__editor"
        aria-label="Message"
        value={c.text}
        readOnly={writing}
        onChange={(e) => set({ text: e.target.value })}
      />

      {(c.files.length > 0 || (c.forwardAttachments ?? 0) > 0) && (
        <div className="email__files">
          {(c.forwardAttachments ?? 0) > 0 && (
            <label className="email__fwd-files">
              <input
                type="checkbox"
                checked={!c.dropAttachments}
                onChange={(e) => set({ dropAttachments: !e.target.checked })}
              />
              Include {c.forwardAttachments} original{" "}
              {c.forwardAttachments === 1 ? "attachment" : "attachments"}
            </label>
          )}
          {c.files.map((f) => (
            <span key={f.token} className="email__file">
              <Paperclip size={12} aria-hidden="true" />
              <span className="email__file-name">{f.name}</span>
              <span className="email__file-size num">{formatSize(f.size)}</span>
              <button
                type="button"
                className="email__icon email__icon--sm"
                aria-label={`Remove ${f.name}`}
                onClick={() => set({ files: c.files.filter((x) => x.token !== f.token) })}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="email__notice" role="alert">
          <span>{error}</span>
        </div>
      )}

      <div className="email__composebar">
        <button type="button" className="email__btn" onClick={() => void attach()}>
          <Paperclip size={13} />
          Attach
        </button>
        {aiTarget !== "off" && (
          <form
            className="email__ai"
            onSubmit={(e) => {
              e.preventDefault();
              if (!writing) void write(instruction);
            }}
          >
            <Sparkles size={13} className="email__ai-icon" aria-hidden="true" />
            <input
              className="email__ai-input"
              placeholder={
                c.replyToId
                  ? "Tell the AI what to say, e.g. “yes to Thursday, ask about parking”"
                  : "Tell the AI what to write, or how to change it"
              }
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={writing}
            />
            {writing ? (
              <button
                type="button"
                className="email__btn"
                onClick={() => {
                  handle.current?.cancel();
                  handle.current = null;
                  setWriting(false);
                }}
              >
                <Square size={11} />
                Stop
              </button>
            ) : (
              <button type="submit" className="email__btn">
                Write
              </button>
            )}
          </form>
        )}
      </div>
      <p className="email__fine">
        {aiTarget !== "off" && "The AI only writes; nothing is sent until you press Send. "}
        Ctrl+Enter sends.
      </p>
    </div>
  );
}
