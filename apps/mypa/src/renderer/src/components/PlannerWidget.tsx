import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import {
  AlarmClock,
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  Coffee,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
  Wand2,
} from "lucide-react";

import {
  atTime,
  clashMovers,
  clock,
  columns,
  dayEndMs,
  dayKey,
  dayStartMs,
  dayTitle,
  draftPlan,
  durationLabel,
  findConflicts,
  MIN,
  minuteOfDay,
  minutesOf,
  nextFree,
  parseBlock,
  placeLunch,
  reflow,
  shiftDay,
  shortDuration,
  snap,
  summarize,
  taskMinutes,
  toInput,
  type PlanBlock,
  type PlanBlockInput,
  type PlanTask,
} from "../../../shared/planner";
import { pageColorHex } from "../../../shared/pageColors";
import { alertAt } from "../../../shared/reminders";
import type { TaskRow, WidgetRow } from "../../../shared/types";
import { mergeEvents, type AgendaItem } from "../lib/calendar";
import { useReadyStore } from "../lib/store";
import { AddRow } from "./AddRow";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { UndoToast } from "./UndoToast";
import "../styles/planner.css";

/** Timeline scale: one minute is this many pixels (an hour ≈ 66 px). */
const PX = 1.1;
const LENGTHS = [15, 30, 45, 60, 90, 120, 180];
const EXAMPLES = ["Deep work 2-4pm", "Gym at 6pm for 1h", "Break 3:15 15 min", "Review PRs 30m", "Call the bank at 11"];

function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

interface Undoable {
  label: string;
  day: string;
  blocks: PlanBlockInput[];
}

interface Drag {
  id: string;
  mode: "move" | "resize";
  y0: number;
  start0: number;
  end0: number;
  start: number;
  end: number;
  moved: boolean;
}

export function PlannerWidget({ widget, onOpenSettings }: { widget: WidgetRow; onOpenSettings: () => void }) {
  const { snapshot, actions } = useReadyStore();
  const now = useNow();
  const today = dayKey(now);
  const [day, setDay] = useState(today);
  const settings = snapshot.meta.planner;

  const [draft, setDraft] = useState("");
  const [example, setExample] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undoable | null>(null);
  const [unplaced, setUnplaced] = useState<Map<string, string>>(new Map());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [trayOpen, setTrayOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);

  // the day rolls over at midnight if you were looking at today
  const lastToday = useRef(today);
  useEffect(() => {
    if (lastToday.current !== today) {
      if (day === lastToday.current) setDay(today);
      lastToday.current = today;
    }
  }, [today, day]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(t);
  }, [undo]);

  useEffect(() => {
    if (draft) return;
    const t = window.setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 6000);
    return () => window.clearInterval(t);
  }, [draft]);

  useEffect(() => setUnplaced(new Map()), [day]);

  /* ------------------------------------------------------------- data -- */

  const from = dayStartMs(day);
  const to = dayEndMs(day);
  const tasksById = useMemo(() => new Map(snapshot.tasks.map((t) => [t.id, t])), [snapshot.tasks]);

  const agenda = useMemo(
    () =>
      mergeEvents(snapshot.calendarEvents, snapshot.calendarRemoteEvents, snapshot.calendarAccounts).filter(
        (e) => e.start < to && e.end > from && e.myStatus !== "declined",
      ),
    [snapshot.calendarEvents, snapshot.calendarRemoteEvents, snapshot.calendarAccounts, from, to],
  );
  /** Study Planner sessions: the plan works around them like meetings. */
  const studyItems = useMemo((): AgendaItem[] => {
    const subjects = new Map(snapshot.studySubjects.map((x) => [x.id, x]));
    return snapshot.studySessions
      .filter((x) => x.start < to && x.end > from)
      .map((x) => {
        const sub = subjects.get(x.subjectId);
        return {
          id: `study:${x.id}`,
          title: `Study: ${sub?.name ?? "session"}${x.topic ? `, ${x.topic}` : ""}`,
          location: "",
          notes: "",
          start: x.start,
          end: x.end,
          allDay: false,
          source: "Study Planner",
          local: false,
          htmlLink: null,
          accountId: null,
          calendarId: null,
          color: pageColorHex(sub?.color),
          meetingUrl: null,
          attendees: [],
          myStatus: null,
          organizer: null,
          canEdit: false,
          recurring: false,
        };
      });
  }, [snapshot.studySessions, snapshot.studySubjects, from, to]);
  const timed = useMemo(
    () => [...agenda.filter((e) => !e.allDay), ...studyItems].sort((a, b) => a.start - b.start),
    [agenda, studyItems],
  );
  const allDay = useMemo(() => agenda.filter((e) => e.allDay), [agenda]);
  const busyEvents = useMemo(() => timed.map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end })), [timed]);

  const pins = useMemo(
    () =>
      snapshot.reminders
        .filter((r) => r.doneAt === null)
        .map((r) => ({ r, at: alertAt(r) }))
        .filter((x): x is { r: typeof x.r; at: number } => x.at !== null && x.at >= from && x.at < to),
    [snapshot.reminders, from, to],
  );

  const blocks = useMemo(
    () => snapshot.planBlocks.filter((b) => b.day === day).sort((a, b) => a.start - b.start),
    [snapshot.planBlocks, day],
  );
  const plan = snapshot.planDays.find((d) => d.day === day) ?? {
    day,
    status: "draft" as const,
    approvedAt: null,
    intention: "",
  };

  const isDone = useCallback(
    (b: PlanBlock) => (b.taskId ? (tasksById.get(b.taskId)?.done ?? b.done) : b.done),
    [tasksById],
  );
  const titleOf = useCallback(
    (b: PlanBlock) => (b.taskId ? (tasksById.get(b.taskId)?.title ?? b.title) : b.title),
    [tasksById],
  );

  /** Open tasks for this day that aren't in the plan yet. */
  const toPlan = useMemo(() => {
    const planned = new Set(blocks.filter((b) => b.taskId).map((b) => b.taskId!));
    return snapshot.tasks
      .filter((t) => !t.done && !planned.has(t.id))
      .filter((t) => (day >= today && t.section === "today") || (t.due !== null && t.due < to && (day >= today || t.due >= from)))
      .sort((a, b) => {
        const r = { high: 0, medium: 1, low: 2 };
        return r[a.importance] - r[b.importance] || (a.due ?? Infinity) - (b.due ?? Infinity) || a.sort - b.sort;
      });
  }, [snapshot.tasks, blocks, day, today, from, to]);

  const conflicts = useMemo(
    () => findConflicts(day, settings, busyEvents, blocks, isDone),
    [day, settings, busyEvents, blocks, isDone],
  );
  const stats = useMemo(() => summarize(day, settings, busyEvents, blocks, now), [day, settings, busyEvents, blocks, now]);
  const isPast = day < today;

  /* ---------------------------------------------------------- writes -- */

  const save = useCallback(
    (next: PlanBlockInput[], label?: string) => {
      if (label) {
        setUndo({ label, day, blocks: blocks.map(toInput) });
        setFlash(null);
      } else setUndo(null); // an older undo would also throw this change away
      return actions.savePlan(day, next);
    },
    [actions, blocks, day],
  );

  const asTasks = (list: TaskRow[]): PlanTask[] =>
    list.map((t) => ({ id: t.id, title: t.title, importance: t.importance, due: t.due, sort: t.sort }));

  const planMyDay = () => {
    const moving = blocks
      .filter((b) => b.taskId && !b.locked && !isDone(b) && b.end > Date.now())
      .map((b) => tasksById.get(b.taskId!))
      .filter((t): t is TaskRow => !!t && !t.done);
    const tasks = asTasks([...new Map([...toPlan, ...moving].map((t) => [t.id, t])).values()]);
    if (!tasks.length) {
      setFlash(blocks.length ? "Nothing left to place: every task is planned." : "No tasks for this day yet. Add some in To-do first.");
      return;
    }
    const d = draftPlan({
      day,
      now: Date.now(),
      settings,
      events: busyEvents,
      blocks,
      history: snapshot.planBlocks,
      tasks,
      taskDone: (id) => tasksById.get(id)?.done ?? false,
    });
    // new blocks have no id yet; a split task counts once
    const placed = new Set(d.blocks.filter((b) => !b.id && b.kind === "task").map((b) => b.taskId)).size;
    void save(
      d.blocks,
      d.unplaced.length
        ? `Planned ${placed} task${placed === 1 ? "" : "s"}. ${d.unplaced.length} didn't fit (see To plan)`
        : `Planned ${placed} task${placed === 1 ? "" : "s"}. Check it over, then approve`,
    );
    if (plan.status === "approved") void actions.setPlanDay(day, { status: "draft" });
    setUnplaced(new Map(d.unplaced.map((u) => [u.key, u.reason])));
    if (d.unplaced.length) setTrayOpen(true);
  };

  const fixConflicts = () => {
    const move = clashMovers(day, settings, busyEvents, blocks, isDone);
    if (!move.size) {
      setFlash("The clashing blocks are locked. Unlock or move them yourself.");
      return;
    }
    const r = reflow(day, Date.now(), settings, busyEvents, blocks, move);
    const keep = new Set(r.blocks.map((b) => b.id));
    const dropped = blocks.filter((b) => move.has(b.id) && !keep.has(b.id));
    const stuck = [...conflicts.byBlock.keys()].filter((id) => !move.has(id) && blocks.find((b) => b.id === id)?.locked).length;
    void save(
      r.blocks,
      dropped.length
        ? `Moved the clashes. ${dropped.length} didn't fit and went back to To plan`
        : stuck
          ? `Moved what could move. ${stuck} locked block${stuck === 1 ? " still clashes" : "s still clash"}: unlock or move ${stuck === 1 ? "it" : "them"} yourself`
          : "Moved the clashing blocks. Nothing clashes now",
    );
    if (dropped.length) {
      setUnplaced(
        new Map(dropped.filter((b) => b.taskId).map((b) => [b.taskId!, "No free time left for it today"])),
      );
    }
  };

  const approve = () => {
    void actions.setPlanDay(day, { status: "approved" });
    setFlash(
      settings.alerts && day === today
        ? "Plan approved. You'll get an alert as each block starts."
        : "Plan approved.",
    );
  };

  const addTask = (task: TaskRow, at?: number) => {
    const minutes = taskMinutes(task.id, snapshot.planBlocks, settings);
    const start = at ?? nextFree(day, settings, Date.now(), busyEvents, blocks, minutes);
    if (start === null) {
      setFlash("No free time left that fits it. Drag it onto the timeline instead.");
      return;
    }
    void save([
      ...blocks.map(toInput),
      { kind: "task", taskId: task.id, title: task.title, start, end: start + minutes * MIN, done: false, locked: at !== undefined },
    ]);
    setUnplaced((m) => {
      const n = new Map(m);
      n.delete(task.id);
      return n;
    });
    setFlash(`“${task.title}” at ${clock(start)}`);
  };

  const parsed = useMemo(() => (draft.trim() ? parseBlock(draft, day) : null), [draft, day]);
  const addCustom = () => {
    if (!parsed?.title) return;
    const minutes = parsed.minutes ?? (parsed.kind === "break" ? 15 : 30);
    const start = parsed.start ?? nextFree(day, settings, Date.now(), busyEvents, blocks, minutes);
    if (start === null) {
      setFlash("No free time left that fits it. Add a time, like “at 6pm”.");
      return;
    }
    void save([
      ...blocks.map(toInput),
      { kind: parsed.kind, taskId: null, title: parsed.title, start, end: start + minutes * MIN, done: false, locked: parsed.start !== null },
    ]);
    setDraft("");
    setFlash(`Added “${parsed.title}” at ${clock(start)}`);
  };

  const patchBlock = (id: string, patch: Partial<PlanBlockInput>, label?: string) =>
    save(
      blocks.map((b) => (b.id === id ? { ...toInput(b), ...patch } : toInput(b))),
      label,
    );

  const removeBlock = (b: PlanBlock) =>
    save(
      blocks.filter((x) => x.id !== b.id).map(toInput),
      b.taskId ? `“${titleOf(b)}” is back in To plan` : `Removed “${titleOf(b)}”`,
    );

  const toggleDone = (b: PlanBlock) => {
    if (b.taskId && tasksById.has(b.taskId)) void actions.updateTask(b.taskId, { done: !isDone(b) });
    else void patchBlock(b.id, { done: !b.done });
  };

  const moveToNextFree = (b: PlanBlock) => {
    const r = reflow(day, Date.now(), settings, busyEvents, blocks, new Set([b.id]));
    if (!r.blocks.some((x) => x.id === b.id)) {
      setFlash("No free time left that fits it today.");
      return;
    }
    void save(r.blocks, `Moved “${titleOf(b)}”`);
  };

  const clearPlan = () => {
    void save([], "Cleared the plan");
    if (plan.status === "approved") void actions.setPlanDay(day, { status: "draft" });
  };

  const undoLast = () => {
    if (!undo) return;
    void actions.savePlan(undo.day, undo.blocks);
    setUndo(null);
  };

  /* --------------------------------------------------------- timeline -- */

  const range = useMemo(() => {
    const mins = [
      minutesOf(settings.dayStart),
      minutesOf(settings.dayEnd),
      ...timed.flatMap((e) => [Math.max(0, minuteOfDay(Math.max(e.start, from))), e.end >= to ? 1440 : minuteOfDay(e.end)]),
      ...blocks.flatMap((b) => [minuteOfDay(b.start), b.end >= to ? 1440 : minuteOfDay(b.end)]),
      ...pins.map((p) => minuteOfDay(p.at)),
    ];
    const lo = Math.max(0, Math.floor(Math.min(...mins) / 60) * 60 - 30);
    const hi = Math.min(1440, Math.ceil(Math.max(...mins) / 60) * 60 + 30);
    return { lo, hi };
  }, [settings, timed, blocks, pins, from, to]);

  const y = (ms: number) => (Math.max(from, Math.min(to, ms)) - atTime(day, range.lo)) / MIN * PX;

  const shown = useMemo(
    () => blocks.map((b) => (drag && drag.id === b.id ? { ...b, start: drag.start, end: drag.end } : b)),
    [blocks, drag],
  );

  type Item = { start: number; end: number; ev?: AgendaItem; block?: PlanBlock };
  const layout = useMemo(() => {
    const items: Item[] = [
      ...timed.map((ev) => ({ start: Math.max(ev.start, from), end: Math.min(ev.end, to), ev })),
      ...shown.map((block) => ({ start: block.start, end: block.end, block })),
    ];
    const cols = columns(items);
    return items.map((it) => ({ it, ...cols.get(it)! }));
  }, [timed, shown, from, to]);

  const lunch = placeLunch(day, settings, busyEvents);

  // bring the useful part of the day into view when the day changes
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = day === today ? Date.now() - 45 * MIN : (blocks[0]?.start ?? timed[0]?.start ?? atTime(day, settings.dayStart)) - 30 * MIN;
    el.scrollTop = Math.max(0, y(target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, range.lo, range.hi]);

  const minuteAtClientY = (clientY: number) => {
    const lane = laneRef.current!;
    const top = lane.getBoundingClientRect().top;
    return snap(atTime(day, range.lo) + ((clientY - top) / PX) * MIN, 5);
  };

  const onPointerDown = (e: ReactPointerEvent, b: PlanBlock, mode: Drag["mode"]) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input") && mode === "move") return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    setDrag({ id: b.id, mode, y0: e.clientY, start0: b.start, end0: b.end, start: b.start, end: b.end, moved: false });
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const delta = Math.round((e.clientY - drag.y0) / PX / 5) * 5 * MIN;
    if (drag.mode === "move") {
      const start = Math.max(from, Math.min(to - (drag.end0 - drag.start0), drag.start0 + delta));
      setDrag({ ...drag, start, end: start + (drag.end0 - drag.start0), moved: drag.moved || delta !== 0 });
    } else {
      const end = Math.max(drag.start0 + 5 * MIN, Math.min(to, drag.end0 + delta));
      setDrag({ ...drag, end, moved: drag.moved || delta !== 0 });
    }
  };
  const onPointerUp = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved || (d.start === d.start0 && d.end === d.end0)) return;
    void patchBlock(d.id, { start: d.start, end: d.end });
  };

  const onBlockKey = (e: ReactKeyboardEvent, b: PlanBlock) => {
    const step = (e.shiftKey ? 15 : 5) * MIN;
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (dir) {
      e.preventDefault();
      if (e.altKey) void patchBlock(b.id, { end: Math.max(b.start + 5 * MIN, b.end + dir * step) });
      else void patchBlock(b.id, { start: b.start + dir * step, end: b.end + dir * step });
    } else if (e.key === " ") {
      e.preventDefault();
      toggleDone(b);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      void removeBlock(b);
    }
  };

  const onDragOver = (e: ReactDragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-mypa-task")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropAt(minuteAtClientY(e.clientY));
  };
  const onDrop = (e: ReactDragEvent) => {
    const id = e.dataTransfer.getData("application/x-mypa-task");
    setDropAt(null);
    const task = tasksById.get(id);
    if (!task) return;
    e.preventDefault();
    addTask(task, minuteAtClientY(e.clientY));
  };

  /* ------------------------------------------------------------ render -- */

  const hours: number[] = [];
  for (let m = Math.ceil(range.lo / 60) * 60; m <= range.hi; m += 60) hours.push(m);
  const conflictCount = conflicts.byBlock.size;
  const openBlocks = blocks.filter((b) => !isDone(b)).length;
  const doneBlocks = blocks.length - openBlocks;

  return (
    <div className="pln">
      <header className="pln__head">
        <div className="pln__nav">
          <button type="button" className="pln__icon-btn" aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))}>
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="pln__day"
            onClick={() => setDay(today)}
            title={day === today ? undefined : "Back to today"}
          >
            {dayTitle(day, today)}
          </button>
          <button type="button" className="pln__icon-btn" aria-label="Next day" onClick={() => setDay(shiftDay(day, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
        <span className={`pln__status is-${plan.status}`}>
          {plan.status === "approved" ? (
            <>
              <Check size={12} /> Approved{plan.approvedAt ? ` ${clock(plan.approvedAt)}` : ""}
            </>
          ) : blocks.length ? (
            "Draft"
          ) : (
            "Not planned"
          )}
        </span>
      </header>

      <label className="pln__intention">
        <Target size={14} aria-hidden />
        <input
          key={day}
          defaultValue={plan.intention}
          placeholder={day === today ? "What matters most today?" : "What matters most this day?"}
          aria-label="Intention for the day"
          maxLength={200}
          onBlur={(e) => e.target.value.trim() !== plan.intention && void actions.setPlanDay(day, { intention: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>

      <div className="pln__stats" aria-label="Day summary">
        <span>
          <strong>{shortDuration(stats.planned)}</strong> planned
        </span>
        <span>
          <strong>{shortDuration(stats.meetings)}</strong> meetings
        </span>
        <span>
          <strong>{shortDuration(stats.free)}</strong> free
        </span>
        {blocks.length > 0 && (
          <span>
            <strong>{doneBlocks}</strong>/{blocks.length} done
          </span>
        )}
      </div>

      <div className="pln__actions">
        <button type="button" className="pln__btn" onClick={planMyDay} disabled={isPast}>
          <Wand2 size={14} /> {blocks.some((b) => b.kind === "task") ? "Re-plan" : "Plan my day"}
        </button>
        {conflictCount > 0 && (
          <button type="button" className="pln__btn is-warn" onClick={fixConflicts}>
            <CircleAlert size={14} /> Fix {conflictCount} clash{conflictCount === 1 ? "" : "es"}
          </button>
        )}
        <span className="pln__grow" />
        {plan.status === "approved" ? (
          <button type="button" className="pln__btn is-quiet" onClick={() => void actions.setPlanDay(day, { status: "draft" })}>
            <Pencil size={14} /> Back to draft
          </button>
        ) : (
          <button
            type="button"
            className="pln__btn is-primary"
            onClick={approve}
            disabled={!blocks.length || conflictCount > 0}
            title={conflictCount > 0 ? "Fix the clashes first" : !blocks.length ? "Nothing planned yet" : undefined}
          >
            <Check size={14} /> Approve
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="pln__icon-btn" aria-label="More planner actions">
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDay(today)} disabled={day === today}>
              <RotateCcw size={14} /> Go to today
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenSettings}>
              <Clock size={14} /> Working hours & settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={!blocks.length} onSelect={clearPlan}>
              <Trash2 size={14} /> Clear this day's plan
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {conflicts.doubleBooked.length > 0 && (
        <p className="pln__notice">
          <CircleAlert size={14} />
          <span>
            Double-booked: “{conflicts.doubleBooked[0]!.a}” and “{conflicts.doubleBooked[0]!.b}” at{" "}
            {clock(conflicts.doubleBooked[0]!.at)}
            {conflicts.doubleBooked.length > 1 ? ` (+${conflicts.doubleBooked.length - 1} more)` : ""}
          </span>
        </p>
      )}
      {isPast && openBlocks > 0 && (
        <p className="pln__notice">
          <AlarmClock size={14} />
          <span>
            {openBlocks} block{openBlocks === 1 ? "" : "s"} weren't ticked off. Their tasks are still open in To-do.
          </span>
          <button type="button" onClick={() => setDay(today)}>
            Plan today
          </button>
        </p>
      )}

      {allDay.length > 0 && (
        <div className="pln__allday">
          {allDay.map((e) => (
            <span key={e.id} className="pln__allday-item" style={{ borderColor: e.color }} title={e.source}>
              {e.title || "(no title)"}
            </span>
          ))}
        </div>
      )}

      <div className="pln__scroll" ref={scrollRef}>
        <div
          className="pln__timeline"
          style={{ height: (range.hi - range.lo) * PX }}
          onDragOver={onDragOver}
          onDragLeave={() => setDropAt(null)}
          onDrop={onDrop}
        >
          {hours.map((m) => (
            <div key={m} className="pln__hour" style={{ top: (m - range.lo) * PX }}>
              <span>{clock(atTime(day, m))}</span>
            </div>
          ))}
          <div className="pln__lane" ref={laneRef}>
            <div
              className="pln__work"
              style={{ top: y(atTime(day, settings.dayStart)), height: y(atTime(day, settings.dayEnd)) - y(atTime(day, settings.dayStart)) }}
              aria-hidden
            />
            {lunch && (
              <div className="pln__lunch" style={{ top: y(lunch.start), height: (lunch.end - lunch.start) / MIN * PX }} aria-hidden>
                <Coffee size={11} /> Lunch
              </div>
            )}
            {layout.map(({ it, col, cols }) => {
              const style = {
                top: y(it.start),
                height: Math.max(20, (Math.min(it.end, to) - Math.max(it.start, from)) / MIN * PX - 2),
                left: `calc(${(col / cols) * 100}% + 2px)`,
                width: `calc(${100 / cols}% - 4px)`,
              };
              if (it.ev) {
                const ev = it.ev;
                return (
                  <div
                    key={`e-${ev.id}`}
                    className={`pln-ev${ev.myStatus === "tentative" || ev.myStatus === "needsAction" ? " is-tentative" : ""}${(Math.min(ev.end, to) - Math.max(ev.start, from)) / MIN * PX < 40 ? " is-tight" : ""}`}
                    style={{ ...style, borderLeftColor: ev.color }}
                    title={`${ev.title}\n${clock(ev.start)}–${clock(ev.end)} · ${ev.source}`}
                  >
                    <span className="pln-ev__title">{ev.title || "(no title)"}</span>
                    <span className="pln-ev__time">
                      {clock(ev.start)}–{clock(ev.end)}
                    </span>
                  </div>
                );
              }
              const b = it.block!;
              const done = isDone(b);
              const why = conflicts.byBlock.get(b.id);
              const mins = Math.round((b.end - b.start) / MIN);
              const tight = mins * PX < 40;
              return (
                <div
                  key={b.id}
                  className={[
                    "pln-block",
                    `is-${b.kind}`,
                    done && "is-done",
                    why && !done && "is-clash",
                    drag?.id === b.id && "is-dragging",
                    tight && "is-tight",
                    day === today && b.start <= now && b.end > now && !done && "is-now",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={style}
                  tabIndex={0}
                  role="group"
                  aria-label={`${titleOf(b)}, ${clock(b.start)} to ${clock(b.end)}${done ? ", done" : ""}`}
                  onPointerDown={(e) => onPointerDown(e, b, "move")}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(e) => onBlockKey(e, b)}
                >
                  <button
                    type="button"
                    className="pln-block__check"
                    aria-label={done ? "Mark not done" : "Mark done"}
                    aria-pressed={done}
                    onClick={() => toggleDone(b)}
                  >
                    {done && <Check size={11} strokeWidth={3} />}
                  </button>
                  <div className="pln-block__body">
                    {renaming === b.id ? (
                      <input
                        className="pln-block__rename"
                        defaultValue={b.title}
                        autoFocus
                        aria-label="Block name"
                        onBlur={(e) => {
                          setRenaming(null);
                          const v = e.target.value.trim();
                          if (v && v !== b.title) void patchBlock(b.id, { title: v });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <span className="pln-block__title">
                        {b.kind === "break" && <Coffee size={11} aria-hidden />}
                        {b.kind === "focus" && <Sparkles size={11} aria-hidden />}
                        {titleOf(b)}
                        {b.taskId && !tasksById.has(b.taskId) && <em> (task deleted)</em>}
                      </span>
                    )}
                    <span className="pln-block__time">
                      {clock(b.start)}–{clock(b.end)} · {shortDuration(mins)}
                      {b.locked && <Lock size={10} aria-label="Locked" />}
                      {why && !done && (
                        <span className="pln-block__why" title={why.join("\n")}>
                          <CircleAlert size={11} /> Clash
                        </span>
                      )}
                    </span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="pln-block__more" aria-label={`Options for ${titleOf(b)}`}>
                        <MoreHorizontal size={14} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => toggleDone(b)}>
                        <Check size={14} /> {done ? "Mark not done" : b.taskId ? "Mark done (ticks the task)" : "Mark done"}
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Clock size={14} /> Length
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {LENGTHS.map((l) => (
                            <DropdownMenuItem key={l} onSelect={() => void patchBlock(b.id, { end: b.start + l * MIN })}>
                              {durationLabel(l)}
                              {l === mins && <Check size={12} className="pln__menu-check" />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuItem onSelect={() => moveToNextFree(b)}>
                        <ArrowDownToLine size={14} /> Move to the next free time
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void patchBlock(b.id, { locked: !b.locked })}>
                        {b.locked ? <LockOpen size={14} /> : <Lock size={14} />}{" "}
                        {b.locked ? "Unlock" : "Lock in place"}
                      </DropdownMenuItem>
                      {!b.taskId && (
                        <DropdownMenuItem onSelect={() => setRenaming(b.id)}>
                          <Pencil size={14} /> Rename
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => void removeBlock(b)}>
                        <Trash2 size={14} /> {b.taskId ? "Take out of the plan" : "Delete"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div
                    className="pln-block__resize"
                    aria-hidden
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onPointerDown(e, b, "resize");
                    }}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  />
                </div>
              );
            })}
            {pins.map(({ r, at }) => (
              <div key={`r-${r.id}`} className="pln-pin" style={{ top: y(at) - 9 }} title={`Reminder: ${r.title} at ${clock(at)}`}>
                <AlarmClock size={11} /> {r.title}
              </div>
            ))}
            {day === today && now >= from && now < to && (
              <div className="pln__now" style={{ top: y(now) }} aria-hidden>
                <span>{clock(now)}</span>
              </div>
            )}
            {dropAt !== null && (
              <div className="pln__drop" style={{ top: y(dropAt) }} aria-hidden>
                <span>{clock(dropAt)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {flash && !undo && (
        <div className="pln__flash" role="status">
          {flash}
        </div>
      )}
      <section className={`pln__tray${trayOpen ? " is-open" : ""}`}>
        <button type="button" className="pln__tray-head" onClick={() => setTrayOpen((o) => !o)} aria-expanded={trayOpen}>
          <ChevronRight size={14} className="pln__tray-chev" />
          To plan
          <span className="pln__count">{toPlan.length}</span>
          <span className="pln__grow" />
          {trayOpen && toPlan.length > 0 && <small>Drag onto the timeline, or press +</small>}
        </button>
        {trayOpen && (
          <>
            <div className="pln__add">
              <AddRow
                value={draft}
                placeholder={`Add a block… e.g. “${EXAMPLES[example]}”`}
                onChange={setDraft}
                onSubmit={addCustom}
              />
              {parsed?.title && (
                <p className="pln__hint">
                  {parsed.start !== null ? clock(parsed.start) : "Next free time"} ·{" "}
                  {durationLabel(parsed.minutes ?? (parsed.kind === "break" ? 15 : 30))}
                  {parsed.kind !== "custom" && <> · {parsed.kind === "break" ? "break" : "focus"}</>}
                </p>
              )}
            </div>
            <ul className="pln__tasks">
              {toPlan.map((t) => (
                <li
                  key={t.id}
                  className="pln-task"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-mypa-task", t.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <span className={`pln-task__dot is-${t.importance}`} aria-label={`${t.importance} importance`} />
                  <span className="pln-task__main">
                    <span className="pln-task__title">{t.title}</span>
                    <span className="pln-task__meta">
                      {shortDuration(taskMinutes(t.id, snapshot.planBlocks, settings))}
                      {t.due !== null && ` · due ${new Date(t.due).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                      {unplaced.get(t.id) && <span className="pln-task__why"> · {unplaced.get(t.id)}</span>}
                    </span>
                  </span>
                  <button type="button" className="pln__icon-btn" aria-label={`Add “${t.title}” at the next free time`} onClick={() => addTask(t)}>
                    <Plus size={15} />
                  </button>
                </li>
              ))}
              {toPlan.length === 0 && (
                <li className="pln__empty">
                  {blocks.some((b) => b.kind === "task")
                    ? "Every task for this day is planned."
                    : "No tasks for this day. Add some in To-do, or type a block above."}
                </li>
              )}
            </ul>
          </>
        )}
      </section>

      {undo && (
        <UndoToast key={undo.label + undo.day} label={undo.label} onUndo={undoLast} onDismiss={() => setUndo(null)} />
      )}
    </div>
  );
}
