import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  FileText,
  GraduationCap,
  Headphones,
  SlidersHorizontal,
  ListPlus,
  Loader2,
  Mic,
  RotateCcw,
  Send,
  Settings2,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";

import type { ChatEvent, TutorConfig } from "../../../shared/tutor";
import type { WidgetRow } from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import {
  buildMaterial,
  buildMessages,
  CLOUD_BUDGET,
  errorText,
  extractItems,
  LESSON_LENGTH,
  LESSON_STYLES,
  lessonMaterial,
  lessonPrompt,
  lessonStyleLabel,
  lessonTitle,
  LEVEL_LABEL,
  LOCAL_BUDGET,
  MODE_LABEL,
  modePrompt,
  Recorder,
  Speaker,
  titleFor,
  type Engine,
  type LessonLength,
  type LessonStyle,
  type Level,
  type Mode,
} from "../lib/tutor";
import "../styles/tutor.css";
import { Markdown } from "./Markdown";
import { TutorSave } from "./TutorSave";
import { TutorSettings } from "./TutorSettings";
import { Button } from "./ui/button";
import { UndoToast } from "./UndoToast";

interface Msg {
  id: string;
  role: "user" | "assistant";
  /** What the model receives. */
  content: string;
  /** What the learner sees, when different (mode buttons). */
  shown?: string;
  /** Part of a "Teach me" lesson (its request or the lesson itself). */
  lesson?: boolean;
}

interface Prefs {
  target: string;
  level: Level;
  engine: Engine;
  voice: string;
  autoRead: boolean;
  /** null = every finished transcript */
  sources: string[] | null;
  lessonStyle: LessonStyle;
  lessonCustom: string;
  lessonLength: LessonLength;
  /** Read lessons aloud even when answers aren't. */
  lessonVoice: boolean;
  /** Start the next lesson once one has been read out. */
  lessonKeepGoing: boolean;
}

const DEFAULT_PREFS: Prefs = {
  target: "local",
  level: "beginner",
  engine: "system",
  voice: "",
  autoRead: false,
  sources: null,
  lessonStyle: "storyteller",
  lessonCustom: "",
  lessonLength: "short",
  lessonVoice: true,
  lessonKeepGoing: false,
};

/** Material per lesson for cloud models: one focused stretch, not everything. */
const LESSON_BUDGET = 16_000;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the chat just won't persist */
  }
}

const uid = (): string => crypto.randomUUID();

export function TutorWidget({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const chatKey = `mypa.tutor.chat.${widget.id}`;
  const prefsKey = `mypa.tutor.prefs.${widget.id}`;
  /** Titles of lessons already taught, so the next one picks something new. */
  const taughtKey = `mypa.tutor.taught.${widget.id}`;

  const [prefs, setPrefs] = useState<Prefs>(() => ({
    ...DEFAULT_PREFS,
    ...readJson<Partial<Prefs>>(prefsKey, {}),
  }));
  const [messages, setMessages] = useState<Msg[]>(() => readJson<Msg[]>(chatKey, []));
  const [input, setInput] = useState("");
  const [config, setConfig] = useState<TutorConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const [lessonOpen, setLessonOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Settings were opened to pick a voice: show that part first. */
  const [voiceSettings, setVoiceSettings] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [handsFree, setHandsFree] = useState(false);
  const [micState, setMicState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** The chat as it was before "Clear", kept briefly so it can be undone. */
  const [cleared, setCleared] = useState<Msg[] | null>(null);
  const clearTimer = useRef<number | undefined>(undefined);
  /** Follow new text only while the learner is at the bottom of the chat. */
  const stickRef = useRef(true);

  const requestRef = useRef<string | null>(null);
  const replyRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const speaker = useMemo(() => new Speaker(), []);
  const recorder = useMemo(() => new Recorder(), []);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const handsFreeRef = useRef(false);
  handsFreeRef.current = handsFree;
  /** Always-fresh hands-free actions, callable from timers and event handlers. */
  const latest = useRef<{ listen: () => Promise<void>; teach: (auto: boolean) => void }>({
    listen: async () => undefined,
    teach: () => undefined,
  });

  const patchPrefs = useCallback(
    (patch: Partial<Prefs>) => {
      setPrefs((p) => {
        const next = { ...p, ...patch };
        writeJson(prefsKey, next);
        return next;
      });
    },
    [prefsKey],
  );

  useEffect(() => {
    void window.mypa.tutor.getConfig().then(setConfig);
  }, []);

  // A provider that was deleted must not stay selected.
  useEffect(() => {
    if (
      config &&
      prefs.target !== "local" &&
      !config.providers.some((p) => p.id === prefs.target)
    ) {
      patchPrefs({ target: "local" });
    }
  }, [config, prefs.target, patchPrefs]);

  useEffect(
    () => () => {
      speaker.stop();
      recorder.cancel();
    },
    [speaker, recorder],
  );

  useEffect(() => {
    if (!busy) writeJson(chatKey, messages.slice(-60));
  }, [messages, busy, chatKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, status, error, notice]);

  useEffect(() => () => window.clearTimeout(clearTimer.current), []);

  const speak = useCallback(
    /** Resolves `true` if the answer was read to the end. */
    async (id: string, text: string): Promise<boolean> => {
      setSpeakingId(id);
      setVoiceBusy(prefsRef.current.engine !== "system");
      try {
        return await speaker.speak(text, {
          engine: prefsRef.current.engine,
          voice: prefsRef.current.voice || (prefsRef.current.engine === "neural" ? "af_heart" : ""),
        });
      } catch (err) {
        setError(`Voice failed: ${errorText(err)}`);
        return false;
      } finally {
        setVoiceBusy(false);
        setSpeakingId((cur) => (cur === id ? null : cur));
      }
    },
    [speaker],
  );

  // Streamed reply events from the main process.
  useEffect(() => {
    return window.mypa.tutor.onChatEvent((e: ChatEvent) => {
      if (e.requestId !== requestRef.current) return;
      const replyId = replyRef.current;
      if (e.type === "delta") {
        setStatus("");
        setMessages((ms) =>
          ms.map((m) => (m.id === replyId ? { ...m, content: m.content + e.text } : m)),
        );
      } else if (e.type === "status") {
        setStatus(e.text);
      } else {
        setBusy(false);
        setStatus("");
        requestRef.current = null;
        setMessages((ms) => ms.filter((m) => m.id !== replyId || m.content !== ""));
        if (e.type === "error") {
          setError(e.message);
          setHandsFree(false);
          return;
        }
        const reply = messagesRef.current.find((m) => m.id === replyId);
        const p = prefsRef.current;
        if (reply?.lesson) {
          const title = lessonTitle(reply.content);
          if (title) {
            const taught = readJson<string[]>(taughtKey, []).filter((t) => t !== title);
            writeJson(taughtKey, [...taught, title].slice(-40));
          }
        }
        const read = p.autoRead || handsFreeRef.current || (reply?.lesson && p.lessonVoice);
        if (read && reply?.content) {
          void speak(reply.id, reply.content).then((finished) => {
            if (!finished) return;
            const now = prefsRef.current;
            // keep going: the next lesson, like an episode ending and the next one starting
            if (reply.lesson && now.lessonKeepGoing && now.lessonVoice) {
              window.setTimeout(() => latest.current.teach(true), 1_200);
            } else if (handsFreeRef.current) {
              // hands-free: once the answer has been read out, listen for the next question
              void latest.current.listen();
            }
          });
        } else if (handsFreeRef.current) void latest.current.listen();
      }
    });
  }, [speak, taughtKey]);

  const ready = useMemo(
    () => snapshot.transcripts.filter((t) => t.status === "done" && t.text.trim() !== ""),
    [snapshot.transcripts],
  );
  const selected = useMemo(
    () => (prefs.sources === null ? ready : ready.filter((t) => prefs.sources!.includes(t.id))),
    [ready, prefs.sources],
  );

  const toggleSource = (id: string) => {
    const current = prefs.sources ?? ready.map((t) => t.id);
    patchPrefs({
      sources: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    });
  };

  const sourceFilter = sourceQuery.trim().toLowerCase();
  const listed = sourceFilter
    ? ready.filter((t) => t.title.toLowerCase().includes(sourceFilter))
    : ready;

  /** Selects or unselects every listed source at once. */
  const setSources = (ids: string[], on: boolean) => {
    const current = new Set(prefs.sources ?? ready.map((t) => t.id));
    for (const id of ids) {
      if (on) current.add(id);
      else current.delete(id);
    }
    patchPrefs({ sources: ready.every((t) => current.has(t.id)) ? null : [...current] });
  };

  /** Sends `user` after `before` and streams the answer in. A lesson starts
   *  fresh: the model sees only its request, with material picked for it. */
  const ask = (
    before: Msg[],
    user: Msg,
    topic: string,
    lesson?: { material: string },
  ) => {
    speaker.stop();
    setSpeakingId(null);
    setError(null);
    stickRef.current = true;

    const reply: Msg = { id: uid(), role: "assistant", content: "", lesson: lesson ? true : undefined };
    const history = [...before, user];
    const local = prefs.target === "local";
    const material =
      lesson?.material ??
      buildMaterial(selected, topic || user.content, local ? LOCAL_BUDGET : CLOUD_BUDGET);
    const requestId = uid();
    requestRef.current = requestId;
    replyRef.current = reply.id;

    setMessages([...history, reply]);
    setBusy(true);
    setStatus(local ? "Thinking…" : "");
    void window.mypa.tutor.chat({
      requestId,
      target: prefs.target,
      messages: buildMessages(lesson ? [user] : history, material, prefs.level, local ? 6 : 16),
    });
  };

  /** "Teach me": a lesson on what's typed, or on an idea it picks from the material. */
  const teach = (auto: boolean) => {
    if (requestRef.current) return;
    const topic = auto ? "" : input.trim();
    if (!auto) setInput("");
    const local = prefs.target === "local";
    const budget = local ? LOCAL_BUDGET : LESSON_BUDGET;
    const material = !selected.length
      ? ""
      : topic
        ? buildMaterial(selected, topic, budget)
        : lessonMaterial(selected, budget);
    const content = lessonPrompt({
      topic,
      style: prefs.lessonStyle,
      custom: prefs.lessonCustom,
      length: prefs.lessonLength,
      covered: readJson<string[]>(taughtKey, []),
      hasMaterial: material !== "",
    });
    const style = lessonStyleLabel(prefs.lessonStyle, prefs.lessonCustom);
    const shown = topic ? `Teach me: ${topic} (${style})` : `Teach me something (${style})`;
    ask(messagesRef.current, { id: uid(), role: "user", content, shown, lesson: true }, topic, {
      material,
    });
  };
  latest.current.teach = teach;

  const sendRef = useRef<(mode: Mode, topic: string) => void>(() => undefined);
  const send = (mode: Mode, topic: string) => {
    const text = topic.trim();
    if (busy || (mode === "ask" && !text)) return;
    const content = modePrompt(mode, text);
    const shown =
      mode === "ask"
        ? undefined
        : `${MODE_LABEL[mode]}${text && mode !== "topics" ? `: ${text}` : ""}`;
    setInput("");
    ask(messagesRef.current, { id: uid(), role: "user", content, shown }, text);
  };

  /** Asks the last question again (after an error, or for a different answer). */
  const retry = () => {
    if (busy) return;
    const ms = messagesRef.current;
    let i = ms.length - 1;
    while (i >= 0 && ms[i]!.role !== "user") i -= 1;
    if (i < 0) return;
    const user = ms[i]!;
    if (user.lesson) {
      const budget = prefs.target === "local" ? LOCAL_BUDGET : LESSON_BUDGET;
      const material = selected.length ? lessonMaterial(selected, budget) : "";
      ask(ms.slice(0, i), { ...user, id: uid() }, "", { material });
      return;
    }
    ask(ms.slice(0, i), { ...user, id: uid() }, user.shown ? "" : user.content);
  };

  sendRef.current = send;

  const toggleMic = async () => {
    if (micState === "transcribing") return;
    setError(null);
    if (micState === "idle") {
      speaker.stop();
      setSpeakingId(null);
      try {
        await recorder.start();
        setMicState("recording");
      } catch {
        setError("Couldn't access the microphone. Check that it's connected and allowed.");
      }
      return;
    }
    setMicState("transcribing");
    try {
      const samples = await recorder.stop();
      // under ~0.3 s is just a mis-click
      const text = samples.length > 4_800 ? await window.mypa.tutor.transcribeMic(samples) : "";
      if (text.trim()) setInput((cur) => (cur ? `${cur} ${text.trim()}` : text.trim()));
      else setError("I didn't catch anything. Try again a little closer to the mic.");
    } catch (err) {
      setError(`Voice input failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMicState("idle");
    }
  };

  /** Hands-free: listen until you stop talking, then ask what you said. */
  const listen = async () => {
    if (!handsFreeRef.current) return;
    try {
      await recorder.start({
        onAutoStop: (heard) => {
          void (async () => {
            if (!heard) {
              recorder.cancel();
              setMicState("idle");
              setHandsFree(false);
              setError("Hands-free stopped. I didn't hear anything.");
              return;
            }
            setMicState("transcribing");
            let text = "";
            try {
              const samples = await recorder.stop();
              text = await window.mypa.tutor.transcribeMic(samples);
            } catch (err) {
              setError(`Voice input failed: ${err instanceof Error ? err.message : String(err)}`);
              setHandsFree(false);
            } finally {
              setMicState("idle");
            }
            if (!handsFreeRef.current) return;
            if (text.trim()) sendRef.current("ask", text);
            else void latest.current.listen();
          })();
        },
      });
      setMicState("recording");
    } catch {
      setError("Couldn't access the microphone. Check that it's connected and allowed.");
      setHandsFree(false);
    }
  };
  latest.current.listen = listen;

  const toggleHandsFree = () => {
    if (handsFree) {
      setHandsFree(false);
      recorder.cancel();
      speaker.stop();
      setSpeakingId(null);
      setMicState("idle");
      return;
    }
    setHandsFree(true);
    handsFreeRef.current = true;
    setError(null);
    if (!busy && micState === "idle") void listen();
  };

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((cur) => (cur === message ? null : cur)), 5_000);
  };

  /** The learner's question that produced the answer at `index`. */
  const questionFor = (index: number): string => {
    const q = messages
      .slice(0, index)
      .reverse()
      .find((m) => m.role === "user");
    return q ? (q.shown ?? q.content) : "";
  };

  const saveAsNote = async (index: number) => {
    const answer = messages[index];
    if (!answer) return;
    try {
      await actions.createWidget("blank", widget.pageId);
      const fresh = await window.mypa.db.snapshot();
      const created = fresh.widgets
        .filter((w) => w.pageId === widget.pageId && w.kind === "blank")
        .reduce((a, b) => (b.createdAt >= a.createdAt ? b : a));
      await actions.updateWidgetSettings(created.id, { note: answer.content });
      await actions.updateWidget(created.id, {
        title:
          titleFor(questionFor(index))
            .replace(/^Learn: /, "")
            .slice(0, 40) || "Note",
      });
      flash("Saved as a note widget on this page.");
    } catch (err) {
      setError(`Couldn't save the note: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const stop = () => {
    if (!requestRef.current) return;
    void window.mypa.tutor.cancel(requestRef.current);
    // settle now rather than waiting for the model to notice, and drop a reply that never started
    requestRef.current = null;
    setBusy(false);
    setStatus("");
    const replyId = replyRef.current;
    setMessages((ms) => ms.filter((m) => m.id !== replyId || m.content !== ""));
  };

  const clear = () => {
    stop();
    speaker.stop();
    setSpeakingId(null);
    setCleared(messagesRef.current);
    setMessages([]);
    setError(null);
    window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => setCleared(null), 6_000);
  };

  const undoClear = () => {
    window.clearTimeout(clearTimer.current);
    if (cleared) setMessages(cleared);
    setCleared(null);
  };

  const copy = (m: Msg) => {
    window.mypa.copyText(m.content);
    setCopiedId(m.id);
    window.setTimeout(() => setCopiedId((cur) => (cur === m.id ? null : cur)), 1_500);
  };

  /** A key or provider problem is fixed in settings, not by asking again. */
  const settingsError = error !== null && /key|401|403|unauthori[sz]ed|provider/i.test(error);
  const lastAnswerId = [...messages].reverse().find((m) => m.role === "assistant" && m.content)?.id;
  const recent = ready.slice().sort((a, b) => b.createdAt - a.createdAt)[0];

  const targetLabel =
    prefs.target === "local"
      ? "Built-in (offline)"
      : (config?.providers.find((p) => p.id === prefs.target)?.name ?? "…");

  return (
    <div className="tut">
      <div className="tut__bar">
        <select
          className="field tut__select"
          aria-label="AI model"
          title={`Answering with: ${targetLabel}`}
          value={prefs.target}
          disabled={busy}
          onChange={(e) => patchPrefs({ target: e.target.value })}
        >
          <option value="local">Built-in (offline)</option>
          {config?.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="field tut__select tut__select--narrow"
          aria-label="Explanation level"
          value={prefs.level}
          onChange={(e) => patchPrefs({ level: e.target.value as Level })}
        >
          {(Object.keys(LEVEL_LABEL) as Level[]).map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABEL[l]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`tut__icon${prefs.autoRead ? " is-on" : ""}`}
          aria-pressed={prefs.autoRead}
          title="Read answers aloud automatically"
          aria-label="Read answers aloud automatically"
          onClick={() => {
            if (prefs.autoRead) {
              speaker.stop();
              setSpeakingId(null);
            }
            patchPrefs({ autoRead: !prefs.autoRead });
          }}
        >
          {prefs.autoRead ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>
        <button
          type="button"
          className={`tut__icon${handsFree ? " is-on" : ""}`}
          aria-pressed={handsFree}
          title="Hands-free conversation: it reads answers aloud, then listens for your next question"
          aria-label="Hands-free conversation"
          onClick={toggleHandsFree}
        >
          <Headphones size={14} />
        </button>
        <button
          type="button"
          className="tut__icon"
          title="Clear chat"
          aria-label="Clear chat"
          disabled={messages.length === 0}
          onClick={clear}
        >
          <Trash2 size={14} />
        </button>
        <button
          type="button"
          className="tut__icon"
          title="Tutor settings"
          aria-label="Tutor settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={14} />
        </button>
      </div>

      <button
        type="button"
        className="tut__sources-toggle"
        aria-expanded={sourcesOpen}
        onClick={() => setSourcesOpen((v) => !v)}
      >
        <BookOpen size={13} />
        <span>
          {ready.length === 0
            ? "No material yet"
            : `Learning from ${selected.length} of ${ready.length} transcript${ready.length === 1 ? "" : "s"}`}
        </span>
        <ChevronDown size={13} className="tut__sources-caret" />
      </button>
      {sourcesOpen && (
        <div className="tut__sources">
          {ready.length === 0 && (
            <p>
              Add a video, PDF, article or link in the Transcribe widget, then it shows up here.
            </p>
          )}
          {ready.length > 0 && (
            <div className="tut__sources-tools">
              {ready.length > 4 && (
                <input
                  type="search"
                  className="tut__sources-search"
                  placeholder="Filter by title"
                  aria-label="Filter transcripts by title"
                  value={sourceQuery}
                  onChange={(e) => setSourceQuery(e.target.value)}
                />
              )}
              <button
                type="button"
                disabled={listed.every((t) => selected.some((s) => s.id === t.id))}
                onClick={() =>
                  setSources(
                    listed.map((t) => t.id),
                    true,
                  )
                }
              >
                {sourceFilter ? "Select these" : "Select all"}
              </button>
              <button
                type="button"
                disabled={!listed.some((t) => selected.some((s) => s.id === t.id))}
                onClick={() =>
                  setSources(
                    listed.map((t) => t.id),
                    false,
                  )
                }
              >
                {sourceFilter ? "Unselect these" : "Unselect all"}
              </button>
            </div>
          )}
          {sourceFilter && listed.length === 0 && <p>No titles match “{sourceQuery.trim()}”.</p>}
          {listed.map((t) => (
            <label key={t.id}>
              <input
                type="checkbox"
                checked={selected.some((s) => s.id === t.id)}
                onChange={() => toggleSource(t.id)}
              />
              <span>{t.title}</span>
              <em>{t.wordCount.toLocaleString()} words</em>
            </label>
          ))}
        </div>
      )}

      <div
        className="tut__chat"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {messages.length === 0 && (
          <div className="blankstate">
            <span className="blankstate__icon">
              <GraduationCap size={16} />
            </span>
            <p className="blankstate__title">What do you want to learn?</p>
            {recent ? (
              <>
                <p className="blankstate__text">Start with one of these, or just ask.</p>
                <div className="tut__starters">
                  <button type="button" disabled={busy} onClick={() => teach(false)}>
                    Teach me something from my material
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => send("takeaways", recent.title)}
                  >
                    Key takeaways from “{recent.title}”
                  </button>
                  <button type="button" disabled={busy} onClick={() => send("topics", "")}>
                    What does my material cover?
                  </button>
                  <button type="button" disabled={busy} onClick={() => send("quiz", recent.title)}>
                    Quiz me on “{recent.title}”
                  </button>
                </div>
              </>
            ) : (
              <p className="blankstate__text">
                Transcribe a video, podcast or article first, and I&apos;ll teach you from it. You
                can also just ask.
              </p>
            )}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`tut__msg tut__msg--${m.role}`}>
            {m.role === "assistant" ? (
              m.content ? (
                <>
                  <Markdown text={m.content} className="tut__md" />
                  {!(busy && m.id === replyRef.current) && (
                    <div className="tut__msg-actions">
                      <button
                        type="button"
                        aria-label={speakingId === m.id ? "Stop reading" : "Read aloud"}
                        title={speakingId === m.id ? "Stop reading" : "Read aloud"}
                        onClick={() => {
                          if (speakingId === m.id) {
                            speaker.stop();
                            setSpeakingId(null);
                          } else void speak(m.id, m.content);
                        }}
                      >
                        {speakingId === m.id ? (
                          voiceBusy ? (
                            <Loader2 size={13} className="tut__spin" />
                          ) : (
                            <Square size={13} />
                          )
                        ) : (
                          <Volume2 size={13} />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="Add to my to-do list"
                        title="Add to my to-do list"
                        onClick={() => setSavingId((cur) => (cur === m.id ? null : m.id))}
                      >
                        <ListPlus size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label="Save as a note"
                        title="Save as a note"
                        onClick={() => void saveAsNote(messages.indexOf(m))}
                      >
                        <FileText size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label={copiedId === m.id ? "Copied" : "Copy"}
                        title={copiedId === m.id ? "Copied" : "Copy"}
                        onClick={() => copy(m)}
                      >
                        {copiedId === m.id ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                      {m.id === lastAnswerId && (
                        <button
                          type="button"
                          aria-label={m.lesson ? "Teach it again differently" : "Answer again"}
                          title={m.lesson ? "Teach it again differently" : "Answer again"}
                          disabled={busy}
                          onClick={retry}
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                      {m.lesson && m.id === lastAnswerId && (
                        <button
                          type="button"
                          className="tut__next"
                          disabled={busy}
                          onClick={() => teach(true)}
                        >
                          <GraduationCap size={13} />
                          Next lesson
                        </button>
                      )}
                    </div>
                  )}
                  {savingId === m.id && (
                    <TutorSave
                      items={extractItems(m.content)}
                      defaultTitle={titleFor(questionFor(messages.indexOf(m)))}
                      onCancel={() => setSavingId(null)}
                      onDone={(message) => {
                        setSavingId(null);
                        flash(message);
                      }}
                    />
                  )}
                </>
              ) : (
                <span className="tut__thinking">
                  <Loader2 size={13} className="tut__spin" />
                  {status || "Thinking…"}
                </span>
              )
            ) : (
              (m.shown ?? m.content)
            )}
          </div>
        ))}
        {busy && status && messages.at(-1)?.content !== "" && (
          <p className="tut__status">{status}</p>
        )}
        {notice && (
          <p className="tut__notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <div className="tut__error" role="alert">
            <AlertCircle size={14} />
            <div className="tut__error-body">
              <span>{error}</span>
              <div className="tut__error-actions">
                {messages.some((m) => m.role === "user") && (
                  <button type="button" disabled={busy} onClick={retry}>
                    Try again
                  </button>
                )}
                {settingsError && (
                  <button type="button" onClick={() => setSettingsOpen(true)}>
                    Open settings
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {lessonOpen && (
        <div className="tut__lesson">
          <div className="tut__lesson-row">
            <label className="tut__lesson-field">
              <span>Teaching style</span>
              <select
                className="field tut__select"
                value={prefs.lessonStyle}
                onChange={(e) => patchPrefs({ lessonStyle: e.target.value as LessonStyle })}
              >
                {LESSON_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="tut__lesson-field tut__lesson-field--narrow">
              <span>Length</span>
              <select
                className="field tut__select"
                value={prefs.lessonLength}
                onChange={(e) => patchPrefs({ lessonLength: e.target.value as LessonLength })}
              >
                {(Object.keys(LESSON_LENGTH) as LessonLength[]).map((l) => (
                  <option key={l} value={l}>
                    {LESSON_LENGTH[l].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {prefs.lessonStyle === "custom" ? (
            <input
              className="field tut__lesson-custom"
              aria-label="Describe the teaching style"
              placeholder="e.g. like Jim Rohn: calm, philosophical, lots of stories"
              value={prefs.lessonCustom}
              onChange={(e) => patchPrefs({ lessonCustom: e.target.value })}
            />
          ) : (
            <p className="tut__lesson-hint">
              {LESSON_STYLES.find((s) => s.id === prefs.lessonStyle)?.hint}.
            </p>
          )}
          <label className="tut__lesson-check">
            <input
              type="checkbox"
              checked={prefs.lessonVoice}
              onChange={(e) => patchPrefs({ lessonVoice: e.target.checked })}
            />
            Read lessons aloud
            <button
              type="button"
              className="tut__link"
              onClick={(e) => {
                e.preventDefault(); // don't toggle the checkbox this sits in
                setVoiceSettings(true);
                setSettingsOpen(true);
              }}
            >
              Choose voice
            </button>
          </label>
          <label className={`tut__lesson-check${prefs.lessonVoice ? "" : " is-off"}`}>
            <input
              type="checkbox"
              checked={prefs.lessonKeepGoing && prefs.lessonVoice}
              disabled={!prefs.lessonVoice}
              onChange={(e) => patchPrefs({ lessonKeepGoing: e.target.checked })}
            />
            Keep going: start the next lesson when one ends
          </label>
          <p className="tut__lesson-hint">
            Type a topic below to choose what it teaches. Otherwise it picks an idea from your
            selected material.
          </p>
        </div>
      )}

      <div className="tut__modes">
        <button
          type="button"
          className="tut__teach"
          disabled={busy}
          title={
            input.trim()
              ? `Teach me about “${input.trim()}”`
              : "Pick an idea from my material and teach it to me"
          }
          onClick={() => teach(false)}
        >
          <GraduationCap size={13} />
          Teach me
        </button>
        <button
          type="button"
          className={`tut__teach-opts${lessonOpen ? " is-on" : ""}`}
          aria-label="Lesson options"
          aria-expanded={lessonOpen}
          title="Lesson options: style, length, voice"
          onClick={() => setLessonOpen((v) => !v)}
        >
          <SlidersHorizontal size={13} />
        </button>
        {(Object.keys(MODE_LABEL) as (keyof typeof MODE_LABEL)[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={busy}
            title={
              m === "topics"
                ? "List what the material covers"
                : "Uses what you typed below as the topic (or the whole material)"
            }
            onClick={() => send(m, input)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <form
        className="tut__input"
        onSubmit={(e) => {
          e.preventDefault();
          send("ask", input);
        }}
      >
        <textarea
          rows={1}
          value={input}
          placeholder="Ask a question or name a topic"
          aria-label="Ask a question or name a topic"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send("ask", input);
            }
          }}
        />
        <Button
          type="button"
          size="icon-sm"
          variant={micState === "recording" ? "default" : "ghost"}
          aria-label={micState === "recording" ? "Stop recording" : "Speak your question"}
          title={micState === "recording" ? "Stop recording" : "Speak your question"}
          disabled={micState === "transcribing" || busy}
          onClick={() => void toggleMic()}
        >
          {micState === "transcribing" ? (
            <Loader2 size={14} className="tut__spin" />
          ) : micState === "recording" ? (
            <Square size={14} />
          ) : (
            <Mic size={14} />
          )}
        </Button>
        {busy ? (
          <Button type="button" size="icon-sm" variant="outline" aria-label="Stop" onClick={stop}>
            <Square size={14} />
          </Button>
        ) : (
          <Button type="submit" size="icon-sm" aria-label="Send" disabled={!input.trim()}>
            <Send size={14} />
          </Button>
        )}
      </form>

      {cleared && (
        <UndoToast label="Chat cleared" onUndo={undoClear} onDismiss={() => setCleared(null)} />
      )}

      <TutorSettings
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setVoiceSettings(false);
        }}
        showVoice={voiceSettings}
        config={config}
        onConfigChange={setConfig}
        engine={prefs.engine}
        onEngineChange={(engine) => patchPrefs({ engine })}
        voice={prefs.voice}
        onVoiceChange={(voice) => patchPrefs({ voice })}
      />
    </div>
  );
}
