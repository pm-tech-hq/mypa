import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import { CheckCheck, ChevronRight, Sun } from "lucide-react";

import { useReadyStore } from "../lib/store";
import { AddRow } from "./AddRow";
import { importanceRank } from "../lib/todos";
import { useUndo } from "../lib/useUndo";
import {
  DEFAULT_TODO_SETTINGS,
  PROJECTS,
  type GoalRow,
  type Project,
  type StepRow,
  type TaskRow,
  type TaskSection,
  type TodoSettings,
  type WidgetRow,
} from "../../../shared/types";
import { GoalsView } from "./GoalsView";
import { TaskItem } from "./TaskRow";
import { UndoToast } from "./UndoToast";
import "../styles/todo.css";

const TICK_MS = 30_000;
const DRAG_TYPE = "application/x-mypa-task";

function makeComparator(sort: TodoSettings["sort"]) {
  return (a: TaskRow, b: TaskRow): number => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (sort === "due") {
      const da = a.due ?? Number.POSITIVE_INFINITY;
      const db = b.due ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return importanceRank(a.importance) - importanceRank(b.importance);
    }
    if (sort === "manual") return a.sort - b.sort;
    const r = importanceRank(a.importance) - importanceRank(b.importance);
    if (r !== 0) return r;
    return a.sort - b.sort;
  };
}

interface DropTarget {
  section: TaskSection;
  /** Insert before this task; null = end of the list. Only used for manual order. */
  beforeId: string | null;
}

export function TodoList({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const settings: TodoSettings = { ...DEFAULT_TODO_SETTINGS, ...widget.settings };
  const manual = settings.sort === "manual";

  const [view, setView] = useState<"tasks" | "goals">("tasks");
  const [now, setNow] = useState(() => Date.now());
  const [backlogOpen, setBacklogOpen] = useState(settings.backlogOpen);
  const [draft, setDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const undo = useUndo(widget.id);

  const goalById = useMemo(() => {
    const m = new Map<string, GoalRow>();
    for (const g of snapshot.goals) m.set(g.id, g);
    return m;
  }, [snapshot.goals]);

  const activeGoals = useMemo(
    () => snapshot.goals.filter((g) => g.status === "active" && !undo.hidden.has(g.id)),
    [snapshot.goals, undo.hidden],
  );

  const projects = useMemo(
    () => Array.from(new Set<Project>([...PROJECTS, ...snapshot.tasks.map((t) => t.project)])),
    [snapshot.tasks],
  );

  const stepsByTask = useMemo(() => {
    const m = new Map<string, StepRow[]>();
    for (const s of snapshot.steps) {
      if (undo.hidden.has(s.id)) continue;
      const list = m.get(s.taskId);
      if (list) list.push(s);
      else m.set(s.taskId, [s]);
    }
    for (const list of m.values()) list.sort((a, b) => a.sort - b.sort);
    return m;
  }, [snapshot.steps, undo.hidden]);

  const visible = useMemo(() => {
    const cmp = makeComparator(settings.sort);
    return snapshot.tasks
      .filter(
        (t) =>
          !undo.hidden.has(t.id) &&
          (settings.projects === null || settings.projects.includes(t.project)) &&
          (settings.showCompleted || !t.done),
      )
      .slice()
      .sort(cmp);
  }, [snapshot.tasks, settings.projects, settings.showCompleted, settings.sort, undo.hidden]);

  const today = useMemo(() => visible.filter((t) => t.section === "today"), [visible]);
  /** Every Today task in scope, including completed ones hidden by settings. */
  const todayAll = useMemo(
    () =>
      snapshot.tasks.filter(
        (t) =>
          t.section === "today" &&
          !undo.hidden.has(t.id) &&
          (settings.projects === null || settings.projects.includes(t.project)),
      ),
    [snapshot.tasks, settings.projects, undo.hidden],
  );

  const backlogGroups = useMemo(() => {
    const list = visible.filter((t) => t.section === "backlog");
    const order: Project[] = [];
    for (const t of list) if (!order.includes(t.project)) order.push(t.project);
    return order.map((project) => {
      const group = list.filter((t) => t.project === project);
      return {
        project,
        items: group,
        done: group.filter((t) => t.done).length,
        total: group.length,
      };
    });
  }, [visible]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const seededExpand = useRef(false);
  useEffect(() => {
    if (seededExpand.current) return;
    seededExpand.current = true;
    setExpanded(
      new Set(
        snapshot.tasks
          .filter(
            (t) => t.section === "today" && !t.done && (stepsByTask.get(t.id)?.length ?? 0) > 0,
          )
          .map((t) => t.id),
      ),
    );
  }, [snapshot.tasks, stepsByTask]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const toggleExpand = useCallback((id: string, open?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const on = open ?? !next.has(id);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** New tasks go into the widget's project when it shows exactly one. */
  const newTaskProject: Project = settings.projects?.length === 1 ? settings.projects[0]! : "myPA";

  const addDraft = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      const title = draft.trim();
      if (!title) return;
      setDraft("");
      void actions.createTask({
        title,
        section: "today",
        project: newTaskProject,
        importance: "medium",
      });
    },
    [draft, actions, newTaskProject],
  );

  const deleteTask = useCallback(
    (t: TaskRow) =>
      undo.schedule(t.id, `Deleted “${t.title}”`, () => void actions.deleteTask(t.id)),
    [undo, actions],
  );
  const deleteStep = useCallback(
    (s: StepRow) =>
      undo.schedule(s.id, `Deleted step “${s.title}”`, () => void actions.deleteStep(s.id)),
    [undo, actions],
  );

  /* ---- drag and drop -------------------------------------------------- */
  const onDragStart = useCallback((e: DragEvent<HTMLLIElement>, t: TaskRow) => {
    e.dataTransfer.setData(DRAG_TYPE, t.id);
    e.dataTransfer.effectAllowed = "move";
    setDragId(t.id);
  }, []);

  const onDragEnd = useCallback(() => {
    setDragId(null);
    setDrop(null);
  }, []);

  const dragOver = (section: TaskSection) => (e: DragEvent<HTMLElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    let beforeId: string | null = null;
    if (manual && section === "today") {
      const list = e.currentTarget.querySelector(".todo__list") ?? e.currentTarget;
      const rows = Array.from(list.querySelectorAll<HTMLElement>(":scope > li[data-task-id]"));
      const hit = rows.find((r) => {
        const box = r.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2;
      });
      beforeId = hit?.dataset.taskId ?? null;
    }
    if (drop?.section !== section || drop.beforeId !== beforeId) setDrop({ section, beforeId });
  };

  const onDrop = (section: TaskSection) => (e: DragEvent<HTMLElement>) => {
    const id = e.dataTransfer.getData(DRAG_TYPE);
    e.preventDefault();
    const target = drop;
    onDragEnd();
    const task = snapshot.tasks.find((t) => t.id === id);
    if (!task) return;
    const patch: Partial<TaskRow> = {};
    if (task.section !== section) patch.section = section;
    if (manual && section === "today") {
      const list = today.filter((t) => t.id !== id);
      const idx = target?.beforeId ? list.findIndex((t) => t.id === target.beforeId) : list.length;
      const prev = list[idx - 1];
      const next = list[idx];
      const sort =
        prev && next
          ? (prev.sort + next.sort) / 2
          : prev
            ? prev.sort + 1
            : next
              ? next.sort - 1
              : task.sort;
      if (sort !== task.sort) patch.sort = sort;
    }
    if (Object.keys(patch).length) void actions.updateTask(id, patch);
  };

  const dragLeave = (e: DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
  };

  const todayDone = todayAll.filter((t) => t.done).length;
  const backlogLeft = visible.filter((t) => t.section === "backlog" && !t.done).length;
  const pct = todayAll.length === 0 ? 0 : todayDone / todayAll.length;
  const allDone = todayAll.length > 0 && todayDone === todayAll.length;

  const rowProps = (t: TaskRow) => ({
    item: t,
    steps: stepsByTask.get(t.id) ?? [],
    goal: t.goalId ? goalById.get(t.goalId) : undefined,
    goals: activeGoals,
    projects,
    showGoalTag: settings.showGoalTags,
    now,
    expanded: expanded.has(t.id),
    draggable: true,
    dragging: dragId === t.id,
    dropBefore: drop?.section === t.section && drop.beforeId === t.id && dragId !== t.id,
    onExpand: toggleExpand,
    onDelete: deleteTask,
    onDeleteStep: deleteStep,
    onDragStart,
    onDragEnd,
  });

  return (
    <div
      className={`todo todo--${settings.density}${dragId ? " todo--dragging" : ""}`}
      onKeyDown={(e) => {
        const typing = (e.target as HTMLElement).closest("input, textarea, select");
        if (!typing && (e.ctrlKey || e.metaKey) && e.key === "z" && undo.latest) {
          e.preventDefault();
          undo.undo(undo.latest.id);
        }
      }}
    >
      <header className="todo__head">
        <div className="seg" role="tablist" aria-label="View">
          <button
            type="button"
            role="tab"
            aria-selected={view === "tasks"}
            className={`seg__btn${view === "tasks" ? " is-active" : ""}`}
            onClick={() => setView("tasks")}
          >
            Tasks
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "goals"}
            className={`seg__btn${view === "goals" ? " is-active" : ""}`}
            onClick={() => setView("goals")}
          >
            Goals
          </button>
        </div>
        {view === "tasks" && (
          <div
            className="todo__bar"
            role="progressbar"
            aria-label="Today's progress"
            aria-valuenow={Math.round(pct * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="todo__bar-fill" style={{ transform: `scaleX(${pct})` }} />
          </div>
        )}
      </header>

      {view === "goals" ? (
        <GoalsView undo={undo} />
      ) : (
        <div className="todo__scroll">
          <AddRow
            value={draft}
            placeholder="Add a task for today"
            onChange={setDraft}
            onKeyDown={addDraft}
          />

          <section
            className={`todo__section${drop?.section === "today" ? " is-drop" : ""}`}
            aria-label="Today"
            onDragOver={dragOver("today")}
            onDragLeave={dragLeave}
            onDrop={onDrop("today")}
          >
            <h2 className="todo__section-head">
              Today
              <span className="todo__count num">
                {todayAll.length === 0 ? "nothing yet" : `${todayDone} of ${todayAll.length} done`}
              </span>
            </h2>

            {today.length > 0 ? (
              <ul
                className={`todo__list${drop?.section === "today" && drop.beforeId === null && manual ? " is-drop-end" : ""}`}
              >
                {today.map((t) => (
                  <TaskItem key={t.id} {...rowProps(t)} />
                ))}
              </ul>
            ) : allDone ? (
              <p className="todo__empty">
                <CheckCheck size={14} aria-hidden />
                All done for today.
              </p>
            ) : (
              <p className="todo__empty">
                <Sun size={14} aria-hidden />
                Nothing planned. Add a task above or drag one up from the backlog.
              </p>
            )}
          </section>

          <section
            className={`todo__section todo__section--backlog${drop?.section === "backlog" ? " is-drop" : ""}`}
            aria-label="Backlog"
            onDragOver={dragOver("backlog")}
            onDragLeave={dragLeave}
            onDrop={onDrop("backlog")}
          >
            <button
              type="button"
              className="todo__backlog-toggle"
              aria-expanded={backlogOpen}
              onClick={() => setBacklogOpen((v) => !v)}
            >
              <ChevronRight className={`caret${backlogOpen ? " caret--open" : ""}`} size={12} />
              Backlog
              <span className="todo__count num">{backlogLeft} left</span>
            </button>

            {backlogOpen && (
              <div className="todo__backlog">
                {backlogGroups.length === 0 && (
                  <p className="todo__empty">
                    Empty. Move tasks here from their menu to keep Today short.
                  </p>
                )}
                {backlogGroups.map((group) => (
                  <section key={group.project} className="todo__group">
                    <h3 className="todo__group-head">
                      {group.project}
                      <span className="todo__count num">
                        {group.done}/{group.total}
                      </span>
                    </h3>
                    <ul className="todo__list">
                      {group.items.map((t) => (
                        <TaskItem key={t.id} {...rowProps(t)} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </section>
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
