import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AlertCircle,
  ArrowUp,
  Check,
  Loader2,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  SquarePen,
  Undo2,
  X,
} from "lucide-react";

import type {
  ActionCard,
  AssistantEvent,
  AssistantModelInfo,
  AssistantTurn,
} from "../../../shared/assistant";
import { AssistantSettingsView } from "./AssistantSettings";
import { Markdown } from "./Markdown";
import "../styles/assistant.css";

const STORE_KEY = "mypa.assistant.turns";
const uid = () => crypto.randomUUID();

const SUGGESTIONS = [
  "What's on my plate today?",
  "Add “Drink 2L of water” to my habits",
  "Plan my week around my calendar",
  "Make me a widget that tracks my water intake",
];

function loadTurns(): AssistantTurn[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as AssistantTurn[]) : [];
  } catch {
    return [];
  }
}

/** Actions the model can still act on are summarised into the turn text it
 *  sees next time, so "undo that" or "do it again" have context. */
function turnForModel(t: AssistantTurn): { role: "user" | "assistant"; text: string } {
  if (t.role === "user" || !t.actions?.length) return { role: t.role, text: t.text };
  const done = t.actions.map((a) => `- ${a.label} (${a.status})`).join("\n");
  return { role: "assistant", text: `${t.text}\n\n[Actions]\n${done}`.trim() };
}

export function AssistantPanel({
  open,
  onClose,
  pageId,
}: {
  open: boolean;
  onClose: () => void;
  pageId: string | null;
}) {
  const [turns, setTurns] = useState<AssistantTurn[]>(loadTurns);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [model, setModel] = useState<AssistantModelInfo | null>(null);
  const requestRef = useRef<string | null>(null);
  const replyRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshModel = useCallback(() => {
    void window.mypa.assistant.modelInfo().then(setModel);
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshModel();
    window.setTimeout(() => inputRef.current?.focus(), 60);
  }, [open, refreshModel]);

  useEffect(() => {
    if (busy) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(turns.slice(-60)));
    } catch {
      /* storage unavailable: the chat just won't persist */
    }
  }, [turns, busy]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [turns, status, error]);

  const patchReply = useCallback((fn: (t: AssistantTurn) => AssistantTurn) => {
    const id = replyRef.current;
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  useEffect(
    () =>
      window.mypa.assistant.onEvent((e: AssistantEvent) => {
        if (e.requestId !== requestRef.current) return;
        if (e.type === "delta") {
          setStatus("");
          patchReply((t) => ({ ...t, text: t.text + e.text }));
        } else if (e.type === "status") setStatus(e.text);
        else if (e.type === "retract") patchReply((t) => ({ ...t, text: "" }));
        else if (e.type === "action") {
          setStatus("");
          patchReply((t) => {
            const actions = t.actions ?? [];
            const i = actions.findIndex((a) => a.id === e.action.id);
            const next =
              i >= 0 ? actions.map((a, j) => (j === i ? e.action : a)) : [...actions, e.action];
            return { ...t, actions: next };
          });
        } else if (e.type === "error") {
          setError(e.message);
          setBusy(false);
          setStatus("");
          requestRef.current = null;
          patchReply((t) => ({ ...t, text: t.text.trim() }));
        } else if (e.type === "done") {
          setBusy(false);
          setStatus("");
          requestRef.current = null;
          patchReply((t) => ({ ...t, text: t.text.trim() }));
        }
      }),
    [patchReply],
  );

  const send = (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    stickRef.current = true;
    const user: AssistantTurn = { id: uid(), role: "user", text: message, createdAt: Date.now() };
    const reply: AssistantTurn = {
      id: uid(),
      role: "assistant",
      text: "",
      actions: [],
      createdAt: Date.now(),
    };
    const history = [...turns, user];
    setTurns([...history, reply]);
    setInput("");
    setBusy(true);
    setStatus("Thinking…");
    const requestId = uid();
    requestRef.current = requestId;
    replyRef.current = reply.id;
    void window.mypa.assistant.send({
      requestId,
      pageId,
      turns: history.map(turnForModel),
    });
  };

  const stop = () => {
    if (requestRef.current) void window.mypa.assistant.cancel(requestRef.current);
  };

  const setActionStatus = (turnId: string, actionId: string, patch: Partial<ActionCard>) =>
    setTurns((ts) =>
      ts.map((t) =>
        t.id === turnId
          ? { ...t, actions: t.actions?.map((a) => (a.id === actionId ? { ...a, ...patch } : a)) }
          : t,
      ),
    );

  const undo = async (turnId: string, action: ActionCard) => {
    const ok = await window.mypa.assistant.undo(action.id);
    setActionStatus(
      turnId,
      action.id,
      ok ? { status: "undone", undoable: false } : { undoable: false },
    );
    if (!ok) setError("That can't be undone any more (undo lasts until you restart myPA).");
  };

  const lastUser = useMemo(() => [...turns].reverse().find((t) => t.role === "user"), [turns]);

  if (!open) return null;

  return (
    <aside className="asst" aria-label="Assistant">
      <header className="asst__head">
        <span className="asst__title">
          <Sparkles size={15} aria-hidden />
          Assistant
        </span>
        {model && view === "chat" && (
          <button
            type="button"
            className={`asst__model${model.capable ? "" : " is-weak"}`}
            title={
              model.capable
                ? "The model answering. Change it in settings."
                : "The small built-in model can chat but often fumbles actions. Add a provider or a local server in settings."
            }
            onClick={() => setView("settings")}
          >
            {model.label}
          </button>
        )}
        <span className="asst__head-actions">
          {view === "chat" && (
            <button
              type="button"
              className="asst__icon"
              aria-label="New chat"
              title="New chat"
              disabled={busy || turns.length === 0}
              onClick={() => {
                setTurns([]);
                setError(null);
              }}
            >
              <SquarePen size={15} />
            </button>
          )}
          <button
            type="button"
            className={`asst__icon${view === "settings" ? " is-on" : ""}`}
            aria-label="Assistant settings"
            aria-pressed={view === "settings"}
            title="Settings and permissions"
            onClick={() => {
              setView((v) => (v === "settings" ? "chat" : "settings"));
              refreshModel();
            }}
          >
            <Settings2 size={15} />
          </button>
          <button
            type="button"
            className="asst__icon"
            aria-label="Close assistant"
            title="Close (Esc)"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </span>
      </header>

      {view === "settings" ? (
        <AssistantSettingsView
          onDone={() => {
            setView("chat");
            refreshModel();
          }}
        />
      ) : (
        <>
          <div
            className="asst__chat"
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            }}
          >
            {turns.length === 0 && (
              <div className="asst__empty">
                <p className="asst__empty-title">What can I do for you?</p>
                <p className="asst__empty-text">
                  Ask about your day, or tell me to change things: tasks, events, notes, habits,
                  even new widgets. I only touch what you allow.
                </p>
                <div className="asst__suggest">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t) =>
              t.role === "user" ? (
                <div key={t.id} className="asst__msg asst__msg--user">
                  {t.text}
                </div>
              ) : (
                <div key={t.id} className="asst__msg asst__msg--assistant">
                  {t.actions && t.actions.length > 0 && (
                    <ul className="asst__actions">
                      {t.actions.map((a) => (
                        <ActionRow
                          key={a.id}
                          action={a}
                          onApprove={(allow) => {
                            setActionStatus(t.id, a.id, { status: allow ? "running" : "denied" });
                            void window.mypa.assistant.approve(a.id, allow);
                          }}
                          onUndo={() => void undo(t.id, a)}
                        />
                      ))}
                    </ul>
                  )}
                  {t.text ? (
                    <Markdown text={t.text} className="asst__md" />
                  ) : busy && t.id === replyRef.current && !t.actions?.length ? (
                    <span className="asst__thinking">
                      <Loader2 size={13} className="asst__spin" aria-hidden />
                      {status || "Thinking…"}
                    </span>
                  ) : null}
                </div>
              ),
            )}
            {busy && status && (turns.at(-1)?.text || turns.at(-1)?.actions?.length) ? (
              <p className="asst__status">
                <Loader2 size={12} className="asst__spin" aria-hidden />
                {status}
              </p>
            ) : null}
            {error && (
              <div className="asst__error" role="alert">
                <AlertCircle size={14} aria-hidden />
                <div>
                  <p>{error}</p>
                  <div className="asst__error-actions">
                    {lastUser && (
                      <button type="button" onClick={() => send(lastUser.text)}>
                        <RotateCcw size={12} aria-hidden />
                        Try again
                      </button>
                    )}
                    <button type="button" onClick={() => setView("settings")}>
                      Settings
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <form
            className="asst__input"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              placeholder="Ask, or tell me what to do…"
              aria-label="Message the assistant"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            {busy ? (
              <button
                type="button"
                className="asst__send"
                aria-label="Stop"
                title="Stop"
                onClick={stop}
              >
                <Square size={13} />
              </button>
            ) : (
              <button
                type="submit"
                className="asst__send"
                aria-label="Send"
                title="Send (Enter)"
                disabled={!input.trim()}
              >
                <ArrowUp size={15} />
              </button>
            )}
          </form>
        </>
      )}
    </aside>
  );
}

function ActionRow({
  action,
  onApprove,
  onUndo,
}: {
  action: ActionCard;
  onApprove: (allow: boolean) => void;
  onUndo: () => void;
}) {
  return (
    <li className={`asst-action asst-action--${action.status}`}>
      <span className="asst-action__icon" aria-hidden>
        {action.status === "running" ? (
          <Loader2 size={13} className="asst__spin" />
        ) : action.status === "done" ? (
          <Check size={13} />
        ) : action.status === "needs-approval" ? (
          <ShieldCheck size={13} />
        ) : action.status === "error" ? (
          <AlertCircle size={13} />
        ) : action.status === "undone" ? (
          <Undo2 size={13} />
        ) : (
          <X size={13} />
        )}
      </span>
      <span className="asst-action__body">
        <span className="asst-action__label">{action.label}</span>
        {action.status === "needs-approval" && (
          <span className="asst-action__note">Needs your OK</span>
        )}
        {action.status === "denied" && <span className="asst-action__note">Skipped</span>}
        {action.status === "undone" && <span className="asst-action__note">Undone</span>}
        {action.status === "error" && action.error && (
          <span className="asst-action__note">{action.error}</span>
        )}
      </span>
      {action.status === "needs-approval" && (
        <span className="asst-action__buttons">
          <button type="button" className="is-primary" onClick={() => onApprove(true)}>
            Allow
          </button>
          <button type="button" onClick={() => onApprove(false)}>
            Don't
          </button>
        </span>
      )}
      {action.status === "done" && action.undoable && (
        <button type="button" className="asst-action__undo" onClick={onUndo}>
          Undo
        </button>
      )}
    </li>
  );
}
