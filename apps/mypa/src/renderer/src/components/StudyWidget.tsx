import { useEffect, useMemo, useState } from "react";

import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";

import { PAGE_COLOR_CYCLE, PAGE_COLOR_LABEL, pageColorHex } from "../../../shared/pageColors";
import { atTime, clock, dayEndMs, dayKey, dayStartMs, MIN, minutesOf, shiftDay } from "../../../shared/planner";
import {
  clashesOf,
  clashMessage,
  daysUntilDay,
  examWhen,
  findSlot,
  minutesLabel,
  nextSlot,
  parseTopics,
  planRevision,
  planWeek,
  SESSION_LENGTHS,
  sessionMinutes,
  studyBusy,
  studyStreak,
  uncoveredTopics,
  weekDays,
  weekday,
  WEEKLY_GOALS,
  weekLabel,
  weekMinutes,
  weekStart,
  type DraftSession,
  type PlanInput,
  type StudyBusy,
  type StudyExam,
  type StudySession,
  type StudySubject,
} from "../../../shared/study";
import type { WidgetRow } from "../../../shared/types";
import { mergeEvents } from "../lib/calendar";
import { useReadyStore } from "../lib/store";
import { useUndo } from "../lib/useUndo";
import { captureError } from "./CaptureComposer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { UndoToast } from "./UndoToast";
import "../styles/study.css";

type Saved = { key: number; label: string; undo: () => void };
type Flash = { text: string; error?: boolean };
type Draft = { title: string; sessions: DraftSession[] };

interface Ctx {
  widget: WidgetRow;
  now: number;
  today: string;
  subjects: StudySubject[];
  subjectById: Map<string, StudySubject>;
  exams: StudyExam[];
  sessions: StudySession[];
  busyFor: (day: string, exclude?: string) => StudyBusy[];
  planInput: PlanInput;
  setW: (s: Partial<WidgetRow["settings"]>) => void;
  hidden: Set<string>;
  schedule: (id: string, label: string, commit: () => void) => void;
  saved: (s: Omit<Saved, "key">) => void;
  flash: (f: Flash) => void;
  fail: (e: unknown) => void;
  showDraft: (d: Draft) => void;
}

function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

const hmOf = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const dayHeading = (day: string, today: string) => {
  const d = new Date(dayStartMs(day));
  const date = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  if (day === today) return `Today · ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  if (day === shiftDay(today, 1)) return `Tomorrow · ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  return date;
};

const shortDay = (day: string, today: string) => {
  if (day === today) return "Today";
  if (day === shiftDay(today, 1)) return "Tomorrow";
  return new Date(dayStartMs(day)).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

export function StudyWidget({ widget, onOpenSettings }: { widget: WidgetRow; onOpenSettings: () => void }) {
  const { snapshot, actions } = useReadyStore();
  const undo = useUndo(widget.id);
  const now = useNow();
  const today = dayKey(now);
  const settings = snapshot.meta.study;
  const [saved, setSaved] = useState<Saved | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(null), 8000);
    return () => window.clearTimeout(t);
  }, [saved]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), flash.error ? 6000 : 4000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const hidden = undo.hidden;
  const allSubjects = useMemo(
    () => snapshot.studySubjects.filter((s) => !hidden.has(`sub:${s.id}`)),
    [snapshot.studySubjects, hidden],
  );
  const subjectById = useMemo(() => new Map(allSubjects.map((s) => [s.id, s])), [allSubjects]);
  const exams = useMemo(
    () => snapshot.studyExams.filter((e) => subjectById.has(e.subjectId) && !hidden.has(`ex:${e.id}`)),
    [snapshot.studyExams, subjectById, hidden],
  );
  const sessions = useMemo(
    () => snapshot.studySessions.filter((x) => subjectById.has(x.subjectId) && !hidden.has(`s:${x.id}`)),
    [snapshot.studySessions, subjectById, hidden],
  );

  const events = useMemo(
    () =>
      mergeEvents(snapshot.calendarEvents, snapshot.calendarRemoteEvents, snapshot.calendarAccounts)
        .filter((e) => !e.allDay && e.myStatus !== "declined")
        .map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end })),
    [snapshot.calendarEvents, snapshot.calendarRemoteEvents, snapshot.calendarAccounts],
  );
  const blocks = useMemo(() => {
    const approved = new Set(snapshot.planDays.filter((d) => d.status === "approved").map((d) => d.day));
    const titles = new Map(snapshot.tasks.map((t) => [t.id, t.title]));
    return snapshot.planBlocks
      .filter((b) => b.kind !== "break" && (b.locked || approved.has(b.day)))
      .map((b) => ({ id: b.id, title: (b.taskId && titles.get(b.taskId)) || b.title, start: b.start, end: b.end }));
  }, [snapshot.planBlocks, snapshot.planDays, snapshot.tasks]);

  const busyFor = useMemo(() => {
    const src = { events, blocks, sessions, subjectName: (id: string) => subjectById.get(id)?.name ?? "Study" };
    return (day: string, exclude?: string) => studyBusy(src, dayStartMs(day), dayEndMs(day), exclude);
  }, [events, blocks, sessions, subjectById]);

  const subjects = allSubjects.filter((s) => !s.archived);
  const planInput: PlanInput = { subjects, exams, sessions, settings, busyFor: (d) => busyFor(d), now };

  const ctx: Ctx = {
    widget,
    now,
    today,
    subjects,
    subjectById,
    exams,
    sessions,
    busyFor,
    planInput,
    setW: (s) => void actions.updateWidgetSettings(widget.id, s),
    hidden,
    schedule: undo.schedule,
    saved: (s) => setSaved({ ...s, key: Date.now() }),
    flash: setFlash,
    fail: (e) => setFlash({ text: captureError(e), error: true }),
    showDraft: setDraft,
  };

  const tab = widget.settings.studyTab ?? "week";
  const streak = studyStreak(sessions, today);

  let body;
  if (draft) body = <DraftPanel ctx={ctx} draft={draft} onClose={() => setDraft(null)} onChange={setDraft} />;
  else if (allSubjects.length === 0) body = <FirstRun ctx={ctx} />;
  else if (tab === "subjects") body = <SubjectsView ctx={ctx} allSubjects={allSubjects} />;
  else body = <WeekView ctx={ctx} onOpenSettings={onOpenSettings} />;

  return (
    <div className="st">
      {!draft && allSubjects.length > 0 && (
        <div className="st__head">
          <div className="seg" role="tablist" aria-label="Study Planner view">
            {(
              [
                ["week", "Week"],
                ["subjects", "Subjects and exams"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`seg__btn${tab === id ? " is-active" : ""}`}
                onClick={() => ctx.setW({ studyTab: id })}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="st__grow" />
          {streak > 0 && (
            <span className="st__streak" title="Days in a row with a finished session">
              {streak}-day streak
            </span>
          )}
        </div>
      )}

      {body}

      {flash && (flash.error || (!saved && !undo.latest)) && (
        <p className={`st__flash${flash.error ? " is-error" : ""}`} role="status">
          {flash.text}
        </p>
      )}
      {undo.latest ? (
        <UndoToast
          key={undo.latest.id}
          label={undo.latest.label}
          onUndo={() => undo.undo(undo.latest!.id)}
          onDismiss={() => undo.finish(undo.latest!.id)}
        />
      ) : saved ? (
        <UndoToast
          key={saved.key}
          label={saved.label}
          onUndo={() => {
            saved.undo();
            setSaved(null);
          }}
          onDismiss={() => setSaved(null)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ first run -- */

function FirstRun({ ctx }: { ctx: Ctx }) {
  const { actions } = useReadyStore();
  const [name, setName] = useState("");
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      await actions.saveSubject(null, { name: n, weeklyMinutes: 120 });
      setName("");
      ctx.setW({ studyTab: "subjects" });
    } catch (e) {
      ctx.fail(e);
    }
  };
  return (
    <div className="st__body">
      <div className="blankstate st__first">
        <p className="blankstate__title">What are you studying?</p>
        <p className="blankstate__text">
          Add a subject, give it a weekly goal and your exam dates, and the planner books study time around your calendar.
        </p>
        <form
          className="st__first-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            className="st__input"
            aria-label="First subject"
            placeholder="e.g. Biology"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button type="submit" className="st__btn st__btn--primary" disabled={!name.trim()}>
            <Plus size={14} /> Add subject
          </button>
        </form>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- week -- */

function WeekView({ ctx, onOpenSettings }: { ctx: Ctx; onOpenSettings: () => void }) {
  const { actions, snapshot } = useReadyStore();
  const thisWeek = weekStart(ctx.today);
  const monday = ctx.widget.settings.studyWeek && /^\d{4}-\d{2}-\d{2}$/.test(ctx.widget.settings.studyWeek)
    ? weekStart(ctx.widget.settings.studyWeek)
    : thisWeek;
  const days = weekDays(monday);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const settings = snapshot.meta.study;

  const goWeek = (m: string) => {
    setEditing(null);
    setAdding(null);
    ctx.setW({ studyWeek: m === thisWeek ? "" : m });
  };

  const weekSessions = ctx.sessions.filter((x) => x.start >= dayStartMs(monday) && x.start < dayStartMs(shiftDay(monday, 7)));
  const withGoal = ctx.subjects.filter((s) => s.weeklyMinutes > 0 || weekSessions.some((x) => x.subjectId === s.id));

  const nextExam = ctx.exams
    .filter((e) => e.day >= ctx.today && daysUntilDay(e.day, ctx.today) <= 28)
    .sort((a, b) => a.day.localeCompare(b.day))[0];
  const examNeedsPlan =
    nextExam &&
    (nextExam.topics.length
      ? uncoveredTopics(nextExam, ctx.sessions).length > 0
      : !ctx.sessions.some((x) => x.examId === nextExam.id && x.end > ctx.now));

  const planTheWeek = () => {
    if (!ctx.subjects.some((s) => s.weeklyMinutes > 0)) {
      ctx.flash({ text: "Give a subject a weekly goal first (Subjects and exams)." });
      return;
    }
    const list = planWeek(ctx.planInput, monday);
    if (list.length === 0) {
      ctx.flash({
        text: monday < thisWeek ? "That week is over." : "Nothing to add: your goals are booked, or there's no free time left.",
      });
      return;
    }
    ctx.showDraft({ title: `Plan for ${weekLabel(monday, ctx.today).toLowerCase()}`, sessions: list });
  };

  const timer = ctx.widget.settings.studyTimer ?? null;
  const running = timer ? ctx.sessions.find((x) => x.id === timer.id) : undefined;

  return (
    <div className="st__body">
      <div className="st__bar">
        <button type="button" className="st__icon" aria-label="Previous week" onClick={() => goWeek(shiftDay(monday, -7))}>
          <ChevronLeft size={16} />
        </button>
        <strong className="st__week">{weekLabel(monday, ctx.today)}</strong>
        <button type="button" className="st__icon" aria-label="Next week" onClick={() => goWeek(shiftDay(monday, 7))}>
          <ChevronRight size={16} />
        </button>
        {monday !== thisWeek && (
          <button type="button" className="st__link" onClick={() => goWeek(thisWeek)}>
            This week
          </button>
        )}
        <span className="st__grow" />
        {monday >= thisWeek && (
          <button type="button" className="st__btn" onClick={planTheWeek}>
            <Wand2 size={14} /> Plan the week
          </button>
        )}
      </div>

      {running && timer && <TimerPanel ctx={ctx} session={running} startedAt={timer.startedAt} />}

      {nextExam && examNeedsPlan && monday === thisWeek && (
        <div className="st__exam-banner">
          <span className="st__swatch" style={{ background: pageColorHex(ctx.subjectById.get(nextExam.subjectId)?.color) }} />
          <span className="st__exam-banner-text">
            <strong>{ctx.subjectById.get(nextExam.subjectId)?.name}: {nextExam.title}</strong>{" "}
            <span className="st__muted">{examWhen(nextExam, ctx.today).toLowerCase()}</span>
          </span>
          <button
            type="button"
            className="st__btn st__btn--primary"
            onClick={() => {
              const list = planRevision(ctx.planInput, nextExam);
              if (list.length === 0) ctx.flash({ text: "No free time left before the exam in your study hours." });
              else ctx.showDraft({ title: `Revision for ${nextExam.title}`, sessions: list });
            }}
          >
            Plan revision
          </button>
        </div>
      )}

      {withGoal.length > 0 && (
        <ul className="st__goals" aria-label="This week per subject">
          {withGoal.map((s) => {
            const w = weekMinutes(s.id, ctx.sessions, monday);
            const goal = s.weeklyMinutes;
            const full = Math.max(goal, w.planned, 1);
            return (
              <li key={s.id} className="st__goal">
                <span className="st__goal-name">
                  <span className="st__swatch" style={{ background: pageColorHex(s.color) }} />
                  {s.name}
                </span>
                <span className="st__goal-bar" aria-hidden>
                  <span className="st__goal-planned" style={{ width: `${(w.planned / full) * 100}%`, background: pageColorHex(s.color) }} />
                  <span className="st__goal-done" style={{ width: `${(w.done / full) * 100}%`, background: pageColorHex(s.color) }} />
                </span>
                <span className="st__goal-n">
                  {minutesLabel(w.done)}
                  <span className="st__muted"> / {goal ? minutesLabel(goal) : minutesLabel(w.planned)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="st__days">
        {days.map((day) => {
          const list = ctx.sessions.filter((x) => dayKey(x.start) === day).sort((a, b) => a.start - b.start);
          const past = day < ctx.today;
          const off = !settings.days.includes(weekday(day));
          const total = list.reduce((n, x) => n + sessionMinutes(x), 0);
          // past days with nothing in them say nothing; skip them
          if (past && list.length === 0) return null;
          return (
            <section key={day} className={`st__day${past ? " is-past" : ""}${day === ctx.today ? " is-today" : ""}`}>
              <header className="st__day-head">
                <h4>{dayHeading(day, ctx.today)}</h4>
                {total > 0 && <span className="st__muted">{minutesLabel(total)}</span>}
                {off && list.length === 0 && <span className="st__muted">No study</span>}
                <span className="st__grow" />
                {!past && (
                  <button
                    type="button"
                    className="st__icon st__icon--sm"
                    aria-label={`Add a session on ${dayHeading(day, ctx.today)}`}
                    onClick={() => {
                      setEditing(null);
                      setAdding(adding === day ? null : day);
                    }}
                  >
                    <Plus size={14} />
                  </button>
                )}
              </header>
              {adding === day && <SessionEditor ctx={ctx} day={day} onClose={() => setAdding(null)} />}
              {list.map((x) =>
                editing === x.id ? (
                  <SessionEditor key={x.id} ctx={ctx} day={day} session={x} onClose={() => setEditing(null)} />
                ) : (
                  <SessionRow
                    key={x.id}
                    ctx={ctx}
                    session={x}
                    onEdit={() => {
                      setAdding(null);
                      setEditing(x.id);
                    }}
                    onToggle={() => void actions.updateSession(x.id, { done: !x.done }).catch(ctx.fail)}
                  />
                ),
              )}
            </section>
          );
        })}
      </div>

      <button type="button" className="st__link st__hours" onClick={onOpenSettings}>
        <Clock size={12} /> Study hours {clock(atTime(ctx.today, settings.dayStart))}–{clock(atTime(ctx.today, settings.dayEnd))} ·{" "}
        {minutesLabel(settings.sessionMinutes)} sessions
      </button>
    </div>
  );
}

function SessionRow({
  ctx,
  session: x,
  onEdit,
  onToggle,
}: {
  ctx: Ctx;
  session: StudySession;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const { actions } = useReadyStore();
  const sub = ctx.subjectById.get(x.subjectId);
  const exam = x.examId ? ctx.exams.find((e) => e.id === x.examId) : undefined;
  const day = dayKey(x.start);
  const clash = x.done || x.end < ctx.now ? undefined : clashesOf(x, ctx.busyFor(day, x.id))[0];
  const timer = ctx.widget.settings.studyTimer ?? null;
  const canStart = !x.done && !timer && day === ctx.today && x.end > ctx.now;

  const moveToFree = async () => {
    const minutes = sessionMinutes(x);
    const slot = nextSlot(day, minutes, ctx.planInput.settings, (d) => ctx.busyFor(d, x.id), ctx.now);
    if (!slot) {
      ctx.flash({ text: "No free time in your study hours over the next two weeks.", error: true });
      return;
    }
    try {
      await actions.updateSession(x.id, { start: slot.start, end: slot.end });
      ctx.saved({
        label: `Moved to ${shortDay(dayKey(slot.start), ctx.today)} ${clock(slot.start)}`,
        undo: () => void actions.putSessions([x]),
      });
    } catch (e) {
      ctx.fail(e);
    }
  };

  return (
    <div className={`st__row${x.done ? " is-done" : ""}${clash ? " is-clash" : ""}`}>
      <button
        type="button"
        className={`st__check${x.done ? " is-on" : ""}`}
        role="checkbox"
        aria-checked={x.done}
        aria-label={x.done ? "Mark not done" : "Mark done"}
        onClick={onToggle}
      >
        {x.done && <Check size={12} strokeWidth={3} />}
      </button>
      <button type="button" className="st__row-main" onClick={onEdit}>
        <span className="st__time">
          {clock(x.start)}–{clock(x.end)}
        </span>
        <span className="st__swatch" style={{ background: pageColorHex(sub?.color) }} />
        <span className="st__row-text">
          <strong>{sub?.name}</strong>
          {x.topic && <span className="st__topic">{x.topic}</span>}
          {exam && <span className="st__tag">{exam.title}</span>}
          {x.done && x.studied !== null && x.studied !== sessionMinutes(x) && (
            <span className="st__muted">studied {minutesLabel(x.studied)}</span>
          )}
          {clash && (
            <span className="st__clash-why">
              <TriangleAlert size={12} /> Clashes with {clash.title}
            </span>
          )}
        </span>
      </button>
      {clash && (
        <button type="button" className="st__clash" title={clashMessage(clash)} onClick={() => void moveToFree()}>
          Move
        </button>
      )}
      {canStart && (
        <button
          type="button"
          className="st__icon st__icon--sm"
          aria-label="Start the timer"
          title="Start the timer"
          onClick={() => ctx.setW({ studyTimer: { id: x.id, startedAt: Date.now() } })}
        >
          <Play size={13} />
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="st__icon st__icon--sm" aria-label="Session options">
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil size={14} /> Edit
          </DropdownMenuItem>
          {!x.done && (
            <DropdownMenuItem onSelect={() => void moveToFree()}>
              <Clock size={14} /> Move to the next free time
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="st__danger"
            onSelect={() =>
              ctx.schedule(`s:${x.id}`, `Deleted ${sub?.name ?? "the"} session`, () => void actions.deleteSessions([x.id]))
            }
          >
            <Trash2 size={14} /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SessionEditor({
  ctx,
  day: initialDay,
  session,
  onClose,
}: {
  ctx: Ctx;
  day: string;
  session?: StudySession;
  onClose: () => void;
}) {
  const { actions, snapshot } = useReadyStore();
  const settings = snapshot.meta.study;
  const [subjectId, setSubjectId] = useState(session?.subjectId ?? ctx.subjects[0]?.id ?? "");
  const [examId, setExamId] = useState<string>(session?.examId ?? "");
  const [topic, setTopic] = useState(session?.topic ?? "");
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [day, setDay] = useState(session ? dayKey(session.start) : initialDay);
  const [minutes, setMinutes] = useState(session ? sessionMinutes(session) : settings.sessionMinutes);
  const [time, setTime] = useState(() => {
    if (session) return hmOf(session.start);
    const slot = findSlot(initialDay, settings.sessionMinutes, settings, ctx.busyFor(initialDay), ctx.now);
    return slot ? hmOf(slot.start) : settings.dayStart;
  });
  const [busy, setBusy] = useState(false);

  const start = /^\d\d:\d\d$/.test(time) ? atTime(day, time) : NaN;
  const end = start + minutes * MIN;
  const clash = Number.isFinite(start) ? clashesOf({ start, end }, ctx.busyFor(day, session?.id))[0] : undefined;
  const free = clash ? findSlot(day, minutes, settings, ctx.busyFor(day, session?.id), ctx.now) : null;
  const outside =
    Number.isFinite(start) &&
    (minutesOf(time) < minutesOf(settings.dayStart) || minutesOf(hmOf(end)) > minutesOf(settings.dayEnd) || dayKey(end) !== day);
  const subjectExams = ctx.exams.filter((e) => e.subjectId === subjectId && e.day >= dayKey(Math.min(ctx.now, start || ctx.now)));
  const lengths = [...new Set([...SESSION_LENGTHS, minutes])].sort((a, b) => a - b);

  const save = async () => {
    if (!subjectId || !Number.isFinite(start) || clash) return;
    setBusy(true);
    try {
      if (session) {
        await actions.updateSession(session.id, {
          subjectId,
          examId: examId || null,
          topic,
          notes,
          start,
          end,
        });
        const moved = session.start !== start || session.end !== end;
        ctx.saved({
          label: moved ? `Moved to ${shortDay(day, ctx.today)} ${clock(start)}` : "Session saved",
          undo: () => void actions.putSessions([session]),
        });
      } else {
        const ids = await actions.addSessions([{ subjectId, examId: examId || null, topic, start, end, notes }]);
        ctx.saved({ label: `Booked ${shortDay(day, ctx.today)} ${clock(start)}`, undo: () => void actions.deleteSessions(ids) });
      }
      onClose();
    } catch (e) {
      ctx.fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="st__editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="st__editor-grid">
        <label>
          Subject
          <select
            className="st__input"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setExamId("");
            }}
          >
            {ctx.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          For an exam
          <select className="st__input" value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">None</option>
            {subjectExams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        <label className="st__span2">
          Topic
          <input
            className="st__input"
            value={topic}
            placeholder="What you'll cover (optional)"
            list={`st-topics-${subjectId}`}
            onChange={(e) => setTopic(e.target.value)}
            autoFocus
          />
          <datalist id={`st-topics-${subjectId}`}>
            {[...new Set(ctx.exams.filter((e) => e.subjectId === subjectId).flatMap((e) => e.topics))].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label>
          Day
          <input className="st__input" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
        <div className="st__editor-pair">
          <label>
            Starts
            <input className="st__input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label>
            Length
            <select className="st__input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {lengths.map((m) => (
                <option key={m} value={m}>
                  {minutesLabel(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {session && (
          <label className="st__span2">
            Notes
            <textarea className="st__input st__textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        )}
      </div>

      {clash ? (
        <p className="st__warn" role="alert">
          <TriangleAlert size={13} /> {clashMessage(clash)}
          {free ? (
            <button type="button" className="st__link" onClick={() => setTime(hmOf(free.start))}>
              Use {clock(free.start)} instead
            </button>
          ) : (
            <span> No free {minutesLabel(minutes)} left that day.</span>
          )}
        </p>
      ) : outside ? (
        <p className="st__note">
          Outside your study hours ({clock(atTime(day, settings.dayStart))}–{clock(atTime(day, settings.dayEnd))}); that's fine
          for one-offs.
        </p>
      ) : null}

      <div className="st__editor-actions">
        {session && (
          <button
            type="button"
            className="st__btn st__btn--ghost"
            onClick={() => {
              onClose();
              ctx.schedule(`s:${session.id}`, "Deleted the session", () => void actions.deleteSessions([session.id]));
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
        )}
        <span className="st__grow" />
        <button type="button" className="st__btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="st__btn st__btn--primary" disabled={busy || !!clash || !subjectId || !Number.isFinite(start)}>
          {session ? "Save" : "Book it"}
        </button>
      </div>
    </form>
  );
}

function TimerPanel({ ctx, session, startedAt }: { ctx: Ctx; session: StudySession; startedAt: number }) {
  const { actions } = useReadyStore();
  const now = useNow(1000);
  const elapsed = Math.max(0, now - startedAt);
  const planned = session.end - session.start;
  const mm = Math.floor(elapsed / 60_000);
  const ss = Math.floor((elapsed % 60_000) / 1000);
  const sub = ctx.subjectById.get(session.subjectId);
  const finish = async () => {
    try {
      await actions.updateSession(session.id, { done: true, studied: Math.max(1, Math.round(elapsed / 60_000)) });
      ctx.setW({ studyTimer: null });
      ctx.flash({ text: `Logged ${minutesLabel(Math.max(1, Math.round(elapsed / 60_000)))} of ${sub?.name ?? "study"}` });
    } catch (e) {
      ctx.fail(e);
    }
  };
  return (
    <div className="st__timer" style={{ borderColor: pageColorHex(sub?.color) }}>
      <div className="st__timer-text">
        <span className="st__muted">Studying</span>
        <strong>
          {sub?.name}
          {session.topic ? ` · ${session.topic}` : ""}
        </strong>
      </div>
      <span className={`st__timer-clock${elapsed > planned ? " is-over" : ""}`} aria-live="off">
        {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
      </span>
      <span className="st__timer-bar" aria-hidden>
        <span style={{ width: `${Math.min(100, (elapsed / planned) * 100)}%`, background: pageColorHex(sub?.color) }} />
      </span>
      <div className="st__timer-actions">
        <button type="button" className="st__btn" onClick={() => ctx.setW({ studyTimer: null })}>
          <Square size={12} /> Stop
        </button>
        <button type="button" className="st__btn st__btn--primary" onClick={() => void finish()}>
          <Check size={14} /> Finish
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- draft -- */

function DraftPanel({
  ctx,
  draft,
  onClose,
  onChange,
}: {
  ctx: Ctx;
  draft: Draft;
  onClose: () => void;
  onChange: (d: Draft) => void;
}) {
  const { actions } = useReadyStore();
  const [busy, setBusy] = useState(false);
  const byDay = new Map<string, DraftSession[]>();
  for (const d of draft.sessions) {
    const k = dayKey(d.start);
    byDay.set(k, [...(byDay.get(k) ?? []), d]);
  }
  const total = draft.sessions.reduce((n, d) => n + (d.end - d.start) / MIN, 0);

  const book = async () => {
    setBusy(true);
    try {
      const ids = await actions.addSessions(
        draft.sessions.map((d) => ({ subjectId: d.subjectId, examId: d.examId, topic: d.topic, start: d.start, end: d.end })),
      );
      ctx.saved({
        label: `Booked ${ids.length} session${ids.length === 1 ? "" : "s"}`,
        undo: () => void actions.deleteSessions(ids),
      });
      const first = draft.sessions[0];
      if (first) ctx.setW({ studyTab: "week", studyWeek: weekStart(dayKey(first.start)) === weekStart(ctx.today) ? "" : weekStart(dayKey(first.start)) });
      onClose();
    } catch (e) {
      ctx.fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st__body st__draft">
      <div className="st__draft-head">
        <div>
          <h3>{draft.title}</h3>
          <p className="st__muted">
            {draft.sessions.length} session{draft.sessions.length === 1 ? "" : "s"} · {minutesLabel(total)}, all in free time
            around your calendar.
          </p>
        </div>
        <button type="button" className="st__icon" aria-label="Close without booking" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {draft.sessions.length === 0 ? (
        <p className="st__muted">Nothing left to book.</p>
      ) : (
        [...byDay.entries()].map(([day, list]) => (
          <section key={day} className="st__day">
            <header className="st__day-head">
              <h4>{dayHeading(day, ctx.today)}</h4>
            </header>
            {list.map((d) => {
              const sub = ctx.subjectById.get(d.subjectId);
              return (
                <div key={d.key} className="st__row is-draft">
                  <span className="st__time">
                    {clock(d.start)}–{clock(d.end)}
                  </span>
                  <span className="st__swatch" style={{ background: pageColorHex(sub?.color) }} />
                  <span className="st__row-text">
                    <strong>{sub?.name}</strong>
                    {d.topic && <span className="st__topic">{d.topic}</span>}
                  </span>
                  <button
                    type="button"
                    className="st__icon st__icon--sm"
                    aria-label="Leave this one out"
                    onClick={() => onChange({ ...draft, sessions: draft.sessions.filter((x) => x.key !== d.key) })}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </section>
        ))
      )}
      <div className="st__draft-actions">
        <button type="button" className="st__btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="st__btn st__btn--primary"
          disabled={busy || draft.sessions.length === 0}
          onClick={() => void book()}
        >
          Book {draft.sessions.length} session{draft.sessions.length === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- subjects -- */

function SubjectsView({ ctx, allSubjects }: { ctx: Ctx; allSubjects: StudySubject[] }) {
  const { actions } = useReadyStore();
  const [name, setName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const archived = allSubjects.filter((s) => s.archived);

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      await actions.saveSubject(null, { name: n, weeklyMinutes: 120 });
      setName("");
    } catch (e) {
      ctx.fail(e);
    }
  };

  return (
    <div className="st__body">
      <form
        className="st__add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="st__input"
          aria-label="New subject"
          placeholder="Add a subject, then Enter"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </form>
      {ctx.subjects.map((s) => (
        <SubjectCard key={s.id} ctx={ctx} subject={s} />
      ))}
      {archived.length > 0 && (
        <>
          <button type="button" className="st__link st__archived-toggle" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived && archived.map((s) => <SubjectCard key={s.id} ctx={ctx} subject={s} />)}
        </>
      )}
    </div>
  );
}

function SubjectCard({ ctx, subject: s }: { ctx: Ctx; subject: StudySubject }) {
  const { actions } = useReadyStore();
  const [renaming, setRenaming] = useState(false);
  const [examForm, setExamForm] = useState<StudyExam | "new" | null>(null);
  const monday = weekStart(ctx.today);
  const w = weekMinutes(s.id, ctx.sessions, monday);
  const last30 = ctx.sessions
    .filter((x) => x.subjectId === s.id && x.done && x.start >= ctx.now - 30 * 86_400_000)
    .reduce((n, x) => n + (x.studied ?? sessionMinutes(x)), 0);
  const exams = ctx.exams.filter((e) => e.subjectId === s.id).sort((a, b) => a.day.localeCompare(b.day));
  const upcoming = exams.filter((e) => e.day >= ctx.today);
  const past = exams.filter((e) => e.day < ctx.today);
  const sessionCount = ctx.sessions.filter((x) => x.subjectId === s.id).length;
  const full = Math.max(s.weeklyMinutes, w.planned, 1);

  const rename = async (v: string) => {
    setRenaming(false);
    if (!v.trim() || v.trim() === s.name) return;
    try {
      await actions.saveSubject(s.id, { name: v });
    } catch (e) {
      ctx.fail(e);
    }
  };

  return (
    <article className={`st__subject${s.archived ? " is-archived" : ""}`}>
      <header className="st__subject-head">
        <span className="st__swatch st__swatch--lg" style={{ background: pageColorHex(s.color) }} />
        {renaming ? (
          <input
            className="st__input st__rename"
            defaultValue={s.name}
            aria-label="Subject name"
            autoFocus
            onBlur={(e) => void rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void rename(e.currentTarget.value);
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <button type="button" className="st__subject-name" title="Rename" onClick={() => setRenaming(true)}>
            {s.name}
          </button>
        )}
        <span className="st__grow" />
        <label className="st__goal-pick">
          <span className="st__muted">Goal</span>
          <select
            className="st__input st__input--sm"
            aria-label={`Weekly goal for ${s.name}`}
            value={s.weeklyMinutes}
            onChange={(e) => void actions.saveSubject(s.id, { weeklyMinutes: Number(e.target.value) }).catch(ctx.fail)}
          >
            {[...new Set([...WEEKLY_GOALS, s.weeklyMinutes])]
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "None" : `${minutesLabel(m)} a week`}
                </option>
              ))}
          </select>
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="st__icon st__icon--sm" aria-label={`${s.name} options`}>
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil size={14} /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setExamForm("new")}>
              <Plus size={14} /> Add an exam
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Colour</DropdownMenuLabel>
            <div className="st__colors">
              {PAGE_COLOR_CYCLE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`st__color${s.color === c ? " is-on" : ""}`}
                  style={{ background: pageColorHex(c) }}
                  aria-label={PAGE_COLOR_LABEL[c]}
                  onClick={() => void actions.saveSubject(s.id, { color: c }).catch(ctx.fail)}
                />
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void actions.saveSubject(s.id, { archived: !s.archived }).catch(ctx.fail)}>
              {s.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} {s.archived ? "Bring back" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="st__danger"
              onSelect={() =>
                ctx.schedule(
                  `sub:${s.id}`,
                  `Deleted ${s.name}${sessionCount ? ` and ${sessionCount} session${sessionCount === 1 ? "" : "s"}` : ""}`,
                  () => void actions.deleteSubject(s.id),
                )
              }
            >
              <Trash2 size={14} /> Delete{sessionCount ? ` with ${sessionCount} session${sessionCount === 1 ? "" : "s"}` : ""}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {!s.archived && (
        <div className="st__subject-week">
          <span className="st__goal-bar" aria-hidden>
            <span className="st__goal-planned" style={{ width: `${(w.planned / full) * 100}%`, background: pageColorHex(s.color) }} />
            <span className="st__goal-done" style={{ width: `${(w.done / full) * 100}%`, background: pageColorHex(s.color) }} />
          </span>
          <span className="st__muted">
            {w.planned === 0 && w.done === 0
              ? `Nothing booked this week${s.weeklyMinutes ? ` (goal ${minutesLabel(s.weeklyMinutes)})` : ""}`
              : `This week: ${minutesLabel(w.planned)} booked${s.weeklyMinutes ? ` of ${minutesLabel(s.weeklyMinutes)}` : ""}, ${
                  w.done ? `${minutesLabel(w.done)} done` : "none done yet"
                }`}
            {last30 > 0 && ` · ${minutesLabel(last30)} studied in the last 30 days`}
          </span>
        </div>
      )}

      {upcoming.map((e) =>
        examForm !== "new" && examForm?.id === e.id ? (
          <ExamForm key={e.id} ctx={ctx} subject={s} exam={e} onClose={() => setExamForm(null)} />
        ) : (
          <ExamRow key={e.id} ctx={ctx} exam={e} onEdit={() => setExamForm(e)} />
        ),
      )}
      {examForm === "new" ? (
        <ExamForm ctx={ctx} subject={s} onClose={() => setExamForm(null)} />
      ) : (
        !s.archived && (
          <button type="button" className="st__link" onClick={() => setExamForm("new")}>
            <Plus size={12} /> Add an exam or deadline
          </button>
        )
      )}
      {past.length > 0 && (
        <p className="st__muted st__past">
          Past: {past.map((e) => `${e.title} (${new Date(dayStartMs(e.day)).toLocaleDateString(undefined, { day: "numeric", month: "short" })})`).join(", ")}
        </p>
      )}
    </article>
  );
}

function ExamRow({ ctx, exam: e, onEdit }: { ctx: Ctx; exam: StudyExam; onEdit: () => void }) {
  const { actions } = useReadyStore();
  const left = uncoveredTopics(e, ctx.sessions);
  const booked = ctx.sessions.filter((x) => x.examId === e.id);
  const n = daysUntilDay(e.day, ctx.today);
  const plan = () => {
    const list = planRevision(ctx.planInput, e);
    if (list.length === 0) ctx.flash({ text: "Nothing to add: topics are booked, or there's no free time before the exam." });
    else ctx.showDraft({ title: `Revision for ${e.title}`, sessions: list });
  };
  return (
    <div className="st__exam">
      <div className="st__exam-top">
        <span className={`st__exam-days${n <= 7 ? " is-soon" : ""}`}>
          {n === 0 ? "Today" : n === 1 ? "1 day" : `${n} days`}
        </span>
        <span className="st__exam-text">
          <strong>{e.title}</strong>
          <span className="st__muted">
            {new Date(dayStartMs(e.day)).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
            {e.time ? ` at ${e.time}` : ""} · {booked.length} session{booked.length === 1 ? "" : "s"} booked
          </span>
        </span>
        <span className="st__grow" />
        <button type="button" className="st__btn" onClick={plan}>
          <Wand2 size={13} /> Plan revision
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="st__icon st__icon--sm" aria-label={`${e.title} options`}>
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil size={14} /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="st__danger"
              onSelect={() => ctx.schedule(`ex:${e.id}`, `Deleted ${e.title}`, () => void actions.deleteExam(e.id))}
            >
              <Trash2 size={14} /> Delete the exam
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {e.topics.length > 0 && (
        <ul className="st__topics" aria-label="Topics">
          {e.topics.map((t) => (
            <li key={t} className={left.includes(t) ? "" : "is-covered"} title={left.includes(t) ? "No session yet" : "Has a session"}>
              {!left.includes(t) && <Check size={11} strokeWidth={3} />}
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExamForm({
  ctx,
  subject,
  exam,
  onClose,
}: {
  ctx: Ctx;
  subject: StudySubject;
  exam?: StudyExam;
  onClose: () => void;
}) {
  const { actions } = useReadyStore();
  const [title, setTitle] = useState(exam?.title ?? "");
  const [day, setDay] = useState(exam?.day ?? shiftDay(ctx.today, 14));
  const [time, setTime] = useState(exam?.time ?? "");
  const [topics, setTopics] = useState(exam?.topics.join("\n") ?? "");
  const parsed = parseTopics(topics);

  const save = async () => {
    try {
      const patch = { subjectId: subject.id, title: title.trim() || "Exam", day, time: time || null, topics: parsed };
      if (exam) {
        await actions.saveExam(exam.id, patch);
        ctx.saved({
          label: "Exam saved",
          undo: () => void actions.saveExam(exam.id, { title: exam.title, day: exam.day, time: exam.time, topics: exam.topics }),
        });
      } else {
        const id = await actions.saveExam(null, patch);
        ctx.saved({ label: `Added ${patch.title}`, undo: () => void actions.deleteExam(id) });
      }
      onClose();
    } catch (e) {
      ctx.fail(e);
    }
  };

  return (
    <form
      className="st__editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="st__editor-grid">
        <label className="st__span2">
          Exam or deadline
          <input
            className="st__input"
            value={title}
            placeholder={`e.g. ${subject.name} final, Essay due`}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </label>
        <label>
          Date
          <input className="st__input" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
        <label>
          Time (optional)
          <input className="st__input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="st__span2">
          Topics it covers
          <textarea
            className="st__input st__textarea"
            rows={4}
            value={topics}
            placeholder={"One per line, e.g.\nCell structure\nEnzymes\nGenetics"}
            onChange={(e) => setTopics(e.target.value)}
          />
          <small className="st__muted">
            {parsed.length
              ? `${parsed.length} topic${parsed.length === 1 ? "" : "s"}: revision learns each one, then reviews it a few days later.`
              : "Optional. With topics, revision is planned topic by topic."}
          </small>
        </label>
      </div>
      <div className="st__editor-actions">
        <span className="st__grow" />
        <button type="button" className="st__btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="st__btn st__btn--primary" disabled={!day}>
          {exam ? "Save" : "Add exam"}
        </button>
      </div>
    </form>
  );
}
