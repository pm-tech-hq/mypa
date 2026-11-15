import { useEffect, useMemo, useRef, useState } from "react";

import {
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Flame,
  KeyRound,
  Lock,
  PenLine,
  Search,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";

import {
  countWords,
  dayLabel,
  extractTags,
  journalDay,
  journalStats,
  matchSnippet,
  monthGrid,
  MOODS,
  moodLabel,
  onThisDay,
  promptFor,
  searchEntries,
  shiftDay,
  type JournalEntry,
  type JournalWidgetSettings,
  type Mood,
} from "../../../shared/journal";
import type { WidgetRow } from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import { useUndo } from "../lib/useUndo";
import { captureError } from "./CaptureComposer";
import { JOURNAL_REMINDER } from "./JournalSettings";
import { UndoToast } from "./UndoToast";
import "../styles/journal.css";

type Tab = JournalWidgetSettings["journalTab"];

const TABS: [Tab, string, typeof PenLine][] = [
  ["write", "Write", PenLine],
  ["entries", "Entries", BookOpen],
  ["insights", "Insights", BarChart3],
];

/** The journal day, kept current across 3am. */
function useToday(): string {
  const [today, setToday] = useState(() => journalDay(Date.now()));
  useEffect(() => {
    const t = window.setInterval(() => setToday(journalDay(Date.now())), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return today;
}

export function JournalWidget({ widget, onOpenSettings }: { widget: WidgetRow; onOpenSettings: () => void }) {
  const { snapshot, actions } = useReadyStore();
  const j = snapshot.meta.journal;
  const undo = useUndo(widget.id);
  const today = useToday();
  const tab: Tab = widget.settings.journalTab ?? "write";
  const setTab = (t: Tab) => void actions.updateWidgetSettings(widget.id, { journalTab: t });
  const [day, setDay] = useState(today);
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<{ text: string; error?: boolean } | null>(null);

  // follow the day over when the date changes (unless looking at another day)
  const prevToday = useRef(today);
  useEffect(() => {
    if (day === prevToday.current) setDay(today);
    prevToday.current = today;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const entries = useMemo(
    () => snapshot.journalEntries.filter((e) => !undo.hidden.has(`j:${e.day}`)),
    [snapshot.journalEntries, undo.hidden],
  );
  const stats = useMemo(() => journalStats(entries, today), [entries, today]);

  const open = (d: string) => {
    setDay(d > today ? today : d);
    setTab("write");
  };

  const remove = (e: JournalEntry) =>
    undo.schedule(`j:${e.day}`, `Deleted the entry for ${dayLabel(e.day, today, { weekday: false })}`, () =>
      void actions.deleteJournal([e.day]).catch((err) => setFlash({ text: captureError(err), error: true })),
    );

  if (j.locked) return <LockScreen count={snapshot.journalEntries.length} />;

  return (
    <div className="jr">
      <div className="jr__bar">
        <div className="seg jr__tabs" role="tablist" aria-label="Journal">
          {TABS.map(([id, name, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`seg__btn${tab === id ? " is-active" : ""}`}
              onClick={() => setTab(id)}
            >
              <Icon size={13} />
              <span className="jr__tab-name">{name}</span>
            </button>
          ))}
        </div>
        <span className="jr__grow" />
        {stats.streak > 0 && (
          <span
            className="jr__streak"
            title={`${stats.streak} day${stats.streak === 1 ? "" : "s"} in a row${
              entries.some((e) => e.day === today) ? "" : ". Write today to keep it going"
            }`}
          >
            <Flame size={13} />
            {stats.streak}
          </span>
        )}
        {j.hasPasscode && (
          <button
            type="button"
            className="jr__icon"
            aria-label="Lock the journal"
            title="Lock the journal"
            onClick={() => void actions.lockJournal()}
          >
            <Lock size={14} />
          </button>
        )}
      </div>

      <div className="jr__body">
        {tab === "write" && (
          <WriteView
            key={day}
            day={day}
            today={today}
            entries={entries}
            onDay={setDay}
            onDelete={remove}
            pendingDelete={undo.hidden.has(`j:${day}`)}
            onCommitDelete={() => undo.finish(`j:${day}`)}
            onError={(t) => setFlash({ text: t, error: true })}
          />
        )}
        {tab === "entries" && <EntriesView entries={entries} today={today} query={query} onQuery={setQuery} onOpen={open} />}
        {tab === "insights" && (
          <InsightsView
            entries={entries}
            today={today}
            onOpen={open}
            onTag={(t) => {
              setQuery(`#${t}`);
              setTab("entries");
            }}
            onSettings={onOpenSettings}
          />
        )}
      </div>

      {flash && !undo.latest && (
        <p className={`jr__flash${flash.error ? " is-error" : ""}`} role="status">
          {flash.text}
        </p>
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

/* ------------------------------------------------------------------ lock -- */

function LockScreen({ count }: { count: number }) {
  const { actions } = useReadyStore();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [forgot, setForgot] = useState<0 | 1 | 2>(0);
  /** undefined = still asking; null = no Windows Hello / Touch ID here. */
  const [method, setMethod] = useState<"windows-hello" | "touch-id" | null | undefined>(undefined);
  const [verify, setVerify] = useState<"idle" | "waiting" | "failed">("idle");
  const [eraseInstead, setEraseInstead] = useState(false);

  // closing the panel starts it fresh next time
  useEffect(() => {
    if (forgot !== 0) return;
    setEraseInstead(false);
    setVerify("idle");
  }, [forgot]);

  useEffect(() => {
    if (forgot === 0 || method !== undefined) return;
    void window.mypa.db
      .journalVerifyMethod()
      .then(setMethod)
      .catch(() => setMethod(null));
  }, [forgot, method]);
  const input = useRef<HTMLInputElement>(null);

  const unlock = async () => {
    if (!code || busy) return;
    setBusy(true);
    const ok = await actions.unlockJournal(code).catch(() => false);
    setBusy(false);
    if (!ok) {
      setWrong(true);
      setCode("");
      input.current?.focus();
    }
  };

  return (
    <div className="jr jr--locked">
      <div className="jr__lock">
        <span className="jr__lock-icon">
          <Lock size={20} />
        </span>
        <h3>Your journal is locked</h3>
        <form
          className="jr__lock-form"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <input
            ref={input}
            autoFocus
            type="password"
            className={`jr__lock-input${wrong ? " is-wrong" : ""}`}
            placeholder="Passcode"
            aria-label="Passcode"
            autoComplete="current-password"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setWrong(false);
            }}
          />
          <button type="submit" className="jr__btn jr__btn--primary" disabled={!code || busy}>
            <KeyRound size={14} /> {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
        <p className="jr__lock-note" role="status">
          {wrong ? "That's not it. Try again." : `${count} ${count === 1 ? "entry" : "entries"}, hidden until you unlock.`}
        </p>
        {forgot === 0 ? (
          <button type="button" className="jr__link" onClick={() => setForgot(1)}>
            Forgot the passcode?
          </button>
        ) : method === undefined ? (
          <p className="jr__lock-note">Checking how this computer can confirm it's you…</p>
        ) : method && !eraseInstead ? (
          <div className="jr__forgot">
            <p>
              Your entries are safe: they're protected by your {method === "touch-id" ? "Mac" : "Windows"} account, not the
              passcode. Confirm it's you with {method === "touch-id" ? "Touch ID" : "Windows Hello (your Windows PIN, fingerprint or face)"}{" "}
              and the passcode is removed. All {count} {count === 1 ? "entry stays" : "entries stay"}. You can set a new passcode
              in the journal's settings afterwards.
            </p>
            {verify === "waiting" && method === "windows-hello" && (
              <p className="jr__lock-note">Look for the Windows Security window. It may be behind this one.</p>
            )}
            {verify === "failed" && (
              <p className="jr__lock-note" role="alert">
                {method === "touch-id" ? "Touch ID" : "Windows Hello"} didn't confirm it. Try again.
              </p>
            )}
            <div className="jr__row">
              <button type="button" className="jr__btn" onClick={() => setForgot(0)}>
                Keep trying
              </button>
              <button
                type="button"
                className="jr__btn jr__btn--primary"
                disabled={verify === "waiting"}
                onClick={async () => {
                  setVerify("waiting");
                  const ok = await actions.resetJournalWithOs().catch(() => false);
                  setVerify(ok ? "idle" : "failed");
                }}
              >
                <KeyRound size={13} />{" "}
                {verify === "waiting" ? "Waiting…" : method === "touch-id" ? "Confirm with Touch ID" : "Confirm with Windows Hello"}
              </button>
            </div>
            <button type="button" className="jr__link jr__link--small" onClick={() => setEraseInstead(true)}>
              Can't confirm it's you? Erase the journal instead…
            </button>
          </div>
        ) : (
          <div className="jr__forgot">
            <p>
              {method
                ? "Erasing deletes"
                : "This computer has no Windows Hello or Touch ID set up, so the passcode can't be reset. Set up a Windows PIN (Settings → Accounts → Sign-in options) and come back to keep your entries, or erase the journal and start again. Erasing deletes"}{" "}
              all {count} {count === 1 ? "entry" : "entries"} for good.
            </p>
            <div className="jr__row">
              <button type="button" className="jr__btn" onClick={() => setForgot(0)}>
                Keep trying
              </button>
              <button
                type="button"
                className={`jr__btn jr__btn--danger${forgot === 2 ? " is-armed" : ""}`}
                onClick={() => (forgot === 2 ? void actions.eraseJournal() : setForgot(2))}
              >
                <Trash2 size={13} /> {forgot === 2 ? "Click again to erase" : "Erase the journal"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- write -- */

function MoodPicker({ value, onChange }: { value: Mood | null; onChange: (m: Mood | null) => void }) {
  return (
    <div className="jr__moods" role="radiogroup" aria-label="Mood">
      {MOODS.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={value === m.value}
          className={`jr__mood${value === m.value ? " is-on" : ""}`}
          title={value === m.value ? "Click again to clear" : m.label}
          onClick={() => onChange(value === m.value ? null : m.value)}
        >
          <i className={`jr__dot m${m.value}`} />
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

function WriteView({
  day,
  today,
  entries,
  onDay,
  onDelete,
  pendingDelete,
  onCommitDelete,
  onError,
}: {
  day: string;
  today: string;
  entries: JournalEntry[];
  onDay: (d: string) => void;
  onDelete: (e: JournalEntry) => void;
  /** This day's entry was just deleted and can still be undone. */
  pendingDelete: boolean;
  onCommitDelete: () => void;
  onError: (text: string) => void;
}) {
  const { snapshot, actions } = useReadyStore();
  const settings = snapshot.meta.journal.settings;
  const entry = entries.find((e) => e.day === day) ?? null;

  const [body, setBody] = useState(entry?.body ?? "");
  const [prompt, setPrompt] = useState(entry?.prompt ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [shuffle, setShuffle] = useState(0);
  const dirty = useRef(false);
  const focused = useRef(false);
  const timer = useRef<number | null>(null);
  const latest = useRef({ body, prompt });
  latest.current = { body, prompt };
  const lastTouch = useRef(0);
  const area = useRef<HTMLTextAreaElement>(null);

  // someone else changed this day (the Assistant, another widget): take it
  // unless you're in the middle of writing
  useEffect(() => {
    if (dirty.current || focused.current) return;
    setBody(entry?.body ?? "");
    setPrompt(entry?.prompt ?? "");
  }, [entry?.body, entry?.prompt]);

  const save = async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    setStatus("saving");
    try {
      await actions.saveJournal(day, { body: latest.current.body, prompt: latest.current.prompt });
      setStatus("saved");
    } catch (e) {
      dirty.current = true;
      setStatus("idle");
      onError(`Couldn't save: ${captureError(e)}`);
    }
  };

  // save whatever is left when switching days or closing
  useEffect(
    () => () => {
      if (dirty.current) void save();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const change = (next: { body?: string; prompt?: string }) => {
    // writing on a day you just deleted starts it afresh: finish the delete first
    if (pendingDelete) onCommitDelete();
    if (next.body !== undefined) setBody(next.body);
    if (next.prompt !== undefined) setPrompt(next.prompt);
    latest.current = { ...latest.current, ...next };
    dirty.current = true;
    setStatus("idle");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 700);
    const now = Date.now();
    if (now - lastTouch.current > 15_000) {
      lastTouch.current = now;
      window.mypa.db.touchJournal();
    }
  };

  const setMood = (m: Mood | null) => {
    if (pendingDelete) onCommitDelete();
    void actions.saveJournal(day, { mood: m }).catch((e) => onError(`Couldn't save: ${captureError(e)}`));
  };

  const suggestion = useMemo(() => promptFor(day, shuffle, entry?.mood ?? null), [day, shuffle, entry?.mood]);
  const showPrompt = settings.prompts && !prompt && !body.trim();
  const usePrompt = () => {
    change({ prompt: suggestion.text });
    area.current?.focus();
  };

  const words = countWords(body);
  const tags = extractTags(body);
  const past = useMemo(
    () => (settings.onThisDay ? onThisDay(entries, day) : []),
    [entries, day, settings.onThisDay],
  );
  const [pastOpen, setPastOpen] = useState(true);

  return (
    <div className="jr__write">
      <div className="jr__daybar">
        <button type="button" className="jr__icon" aria-label="Previous day" onClick={() => onDay(shiftDay(day, -1))}>
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          className="jr__day"
          disabled={day === today}
          title={day === today ? undefined : "Back to today"}
          onClick={() => onDay(today)}
        >
          {dayLabel(day, today)}
        </button>
        <button
          type="button"
          className="jr__icon"
          aria-label="Next day"
          disabled={day >= today}
          onClick={() => onDay(shiftDay(day, 1))}
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <MoodPicker value={entry?.mood ?? null} onChange={setMood} />

      {showPrompt ? (
        <div className="jr__prompt">
          <p>{suggestion.text}</p>
          <div className="jr__prompt-actions">
            <button type="button" className="jr__link" onClick={() => setShuffle((n) => n + 1)}>
              <Shuffle size={12} /> Another
            </button>
            <button type="button" className="jr__link" onClick={usePrompt}>
              Answer this
            </button>
          </div>
        </div>
      ) : (
        prompt && (
          <div className="jr__prompt jr__prompt--used">
            <p>{prompt}</p>
            <button
              type="button"
              className="jr__icon"
              aria-label="Remove the prompt"
              title="Remove the prompt"
              onClick={() => change({ prompt: "" })}
            >
              <X size={13} />
            </button>
          </div>
        )
      )}

      <textarea
        ref={area}
        className="jr__text"
        value={body}
        aria-label={`Journal entry for ${dayLabel(day, today)}`}
        placeholder={day === today ? "What's on your mind?" : "What happened that day?"}
        spellCheck
        onChange={(e) => change({ body: e.target.value })}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />

      <div className="jr__foot">
        <span className="jr__tags">
          {tags.map((t) => (
            <span key={t} className="jr__tag">
              #{t}
            </span>
          ))}
        </span>
        <span className="jr__meta">
          {words > 0 && `${words} word${words === 1 ? "" : "s"}`}
          {status === "saving" ? " · Saving…" : status === "saved" && !dirty.current ? " · Saved" : ""}
        </span>
        {entry && (
          <button
            type="button"
            className="jr__icon"
            aria-label="Delete this entry"
            title="Delete this entry"
            onClick={() => {
              dirty.current = false;
              if (timer.current) window.clearTimeout(timer.current);
              onDelete(entry);
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {past.length > 0 && (
        <section className="jr__past">
          <button type="button" className="jr__past-head" onClick={() => setPastOpen((o) => !o)}>
            <ChevronRight size={13} className={pastOpen ? "is-open" : ""} /> On this day
          </button>
          {pastOpen &&
            past.map(({ entry: p, ago }) => (
              <button key={p.day} type="button" className="jr__past-item" onClick={() => onDay(p.day)}>
                <span className="jr__past-when">
                  {p.mood !== null && <i className={`jr__dot m${p.mood}`} title={moodLabel(p.mood)} />}
                  {ago} · {dayLabel(p.day, today, { weekday: false, year: true })}
                </span>
                <span className="jr__past-text">{matchSnippet(p.body, "", 140) || p.prompt}</span>
              </button>
            ))}
        </section>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- entries -- */

function EntriesView({
  entries,
  today,
  query,
  onQuery,
  onOpen,
}: {
  entries: JournalEntry[];
  today: string;
  query: string;
  onQuery: (q: string) => void;
  onOpen: (day: string) => void;
}) {
  const [mood, setMood] = useState<Mood | null>(null);
  const found = useMemo(() => searchEntries(entries, { text: query, mood }), [entries, query, mood]);
  const months = useMemo(() => {
    const out: { label: string; items: JournalEntry[] }[] = [];
    for (const e of found) {
      const [y, m] = e.day.split("-").map(Number) as [number, number];
      const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
      const last = out.at(-1);
      if (last?.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [found]);
  const any = entries.some((e) => e.words > 0 || e.mood !== null);

  if (!any)
    return (
      <div className="blankstate">
        <BookOpen size={20} />
        <strong>No entries yet</strong>
        <span>What you write each day shows up here.</span>
      </div>
    );

  return (
    <div className="jr__entries">
      <div className="jr__search">
        <Search size={14} />
        <input
          value={query}
          placeholder="Search words, #tags or “a phrase”"
          aria-label="Search the journal"
          onChange={(e) => onQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="jr__icon" aria-label="Clear the search" onClick={() => onQuery("")}>
            <X size={13} />
          </button>
        )}
      </div>
      <div className="jr__filters" role="group" aria-label="Filter by mood">
        {MOODS.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mood === m.value}
            className={`jr__chip${mood === m.value ? " is-on" : ""}`}
            onClick={() => setMood(mood === m.value ? null : m.value)}
          >
            <i className={`jr__dot m${m.value}`} /> {m.label}
          </button>
        ))}
      </div>
      <p className="jr__count">
        {query || mood !== null
          ? `${found.length} of ${entries.length} ${entries.length === 1 ? "entry" : "entries"}`
          : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
      </p>
      {found.length === 0 ? (
        <p className="jr__none">Nothing matches. Try fewer words.</p>
      ) : (
        months.map((g) => (
          <section key={g.label} className="jr__month">
            <h4>{g.label}</h4>
            <ul>
              {g.items.map((e) => (
                <li key={e.day}>
                  <button type="button" className="jr__entry" onClick={() => onOpen(e.day)}>
                    <span className="jr__entry-head">
                      {e.mood !== null && <i className={`jr__dot m${e.mood}`} title={moodLabel(e.mood)} />}
                      <strong>{dayLabel(e.day, today, { weekday: true })}</strong>
                      <span className="jr__entry-words">{e.words ? `${e.words} words` : ""}</span>
                    </span>
                    {e.prompt && <span className="jr__entry-prompt">{e.prompt}</span>}
                    <span className="jr__entry-text">
                      <Highlight text={matchSnippet(e.body, query)} query={query} />
                    </span>
                    {e.tags.length > 0 && (
                      <span className="jr__tags">
                        {e.tags.slice(0, 6).map((t) => (
                          <span key={t} className="jr__tag">
                            #{t}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const words = query
    .toLowerCase()
    .replace(/"/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !w.startsWith("#"));
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}

/* -------------------------------------------------------------- insights -- */

function InsightsView({
  entries,
  today,
  onOpen,
  onTag,
  onSettings,
}: {
  entries: JournalEntry[];
  today: string;
  onOpen: (day: string) => void;
  onTag: (tag: string) => void;
  onSettings: () => void;
}) {
  const stats = useMemo(() => journalStats(entries, today), [entries, today]);
  const [offset, setOffset] = useState(0);
  const [ty, tm] = today.split("-").map(Number) as [number, number];
  const shown = new Date(ty, tm - 1 + offset, 1, 12);
  const weeks = monthGrid(shown.getFullYear(), shown.getMonth());
  const byDay = useMemo(() => new Map(entries.map((e) => [e.day, e])), [entries]);
  const inMonth = weeks.flat().filter((d): d is string => !!d && byDay.has(d)).length;
  const reminderOn = useReadyStore().snapshot.reminders.some(
    (r) => r.title === JOURNAL_REMINDER && !r.doneAt && r.repeat,
  );

  const tile = (label: string, value: string, note?: string) => (
    <div className="jr__tile">
      <span className="jr__tile-label">{label}</span>
      <strong>{value}</strong>
      {note && <span className="jr__tile-note">{note}</span>}
    </div>
  );

  return (
    <div className="jr__insights">
      <div className="jr__tiles">
        {tile("Streak", `${stats.streak} day${stats.streak === 1 ? "" : "s"}`, `Longest ${stats.longest}`)}
        {tile("Last 30 days", `${stats.last30} of 30`, stats.avgMood30 !== null ? `Mood mostly ${moodLabel(Math.round(stats.avgMood30))}` : undefined)}
        {tile("Entries", String(stats.entries), `${stats.words.toLocaleString()} words`)}
      </div>

      <section className="jr__cal">
        <div className="jr__cal-head">
          <button type="button" className="jr__icon" aria-label="Previous month" onClick={() => setOffset((o) => o - 1)}>
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="jr__cal-title"
            disabled={offset === 0}
            title={offset ? "Back to this month" : undefined}
            onClick={() => setOffset(0)}
          >
            {shown.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            <small>
              {inMonth} {inMonth === 1 ? "entry" : "entries"}
            </small>
          </button>
          <button
            type="button"
            className="jr__icon"
            aria-label="Next month"
            disabled={offset >= 0}
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="jr__grid">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span key={i} className="jr__grid-head" aria-hidden>
              {d}
            </span>
          ))}
          {weeks.flat().map((d, i) => {
            if (!d) return <span key={`x${i}`} />;
            const e = byDay.get(d);
            const n = Number(d.slice(8));
            const future = d > today;
            const cls = future ? "is-future" : e ? (e.mood !== null ? `m${e.mood}` : "is-written") : "";
            return (
              <button
                key={d}
                type="button"
                disabled={future}
                className={`jr__cell ${cls}${d === today ? " is-today" : ""}`}
                title={`${dayLabel(d, today, { weekday: false })}${e ? ` · ${e.mood !== null ? moodLabel(e.mood) : "written"}${e.words ? ` · ${e.words} words` : ""}` : ""}`}
                onClick={() => onOpen(d)}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="jr__legend" aria-hidden>
          {MOODS.map((m) => (
            <span key={m.value}>
              <i className={`jr__dot m${m.value}`} /> {m.label}
            </span>
          ))}
          <span>
            <i className="jr__dot is-written" /> No mood
          </span>
        </div>
      </section>

      {stats.topTags.length > 0 && (
        <section className="jr__toptags">
          <h4>Most written about</h4>
          <div className="jr__chips">
            {stats.topTags.map((t) => (
              <button key={t.tag} type="button" className="jr__chip" onClick={() => onTag(t.tag)}>
                #{t.tag} <small>{t.count}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      {stats.topTags.length === 0 && stats.entries > 0 && (
        <p className="jr__hint">Add #tags as you write (#work, #family) to see what you write about most.</p>
      )}
      {!reminderOn && (
        <p className="jr__hint">
          Writing most days?{" "}
          <button type="button" className="jr__link" onClick={onSettings}>
            Set a daily reminder
          </button>
        </p>
      )}
    </div>
  );
}
