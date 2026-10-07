import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { Archive, ChevronRight, Flag, X } from "lucide-react";

import { useReadyStore } from "../lib/store";
import { AddRow } from "./AddRow";
import { DatePicker } from "./DatePicker";
import { EditableText } from "./EditableText";
import { formatGoalDate } from "../lib/todos";
import type { useUndo } from "../lib/useUndo";
import {
  HORIZON_LABEL,
  HORIZON_ORDER,
  IMPORTANCE_LABEL,
  type GoalHorizon,
  type GoalRow,
  type TaskRow,
} from "../../../shared/types";

type Undo = ReturnType<typeof useUndo>;

export function GoalsView({ undo }: { undo: Undo }) {
  const { snapshot, actions } = useReadyStore();
  const [newTitle, setNewTitle] = useState("");
  const [newHorizon, setNewHorizon] = useState<GoalHorizon>("month");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);

  const tasksByGoal = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const t of snapshot.tasks) {
      if (!t.goalId || undo.hidden.has(t.id)) continue;
      const list = m.get(t.goalId);
      if (list) list.push(t);
      else m.set(t.goalId, [t]);
    }
    return m;
  }, [snapshot.tasks, undo.hidden]);

  const live = useMemo(
    () => snapshot.goals.filter((g) => !undo.hidden.has(g.id)),
    [snapshot.goals, undo.hidden],
  );
  const archived = live.filter((g) => g.status === "archived");

  const groups = useMemo(() => {
    const active = live.filter((g) => g.status !== "archived");
    return HORIZON_ORDER.map((h) => ({
      horizon: h,
      goals: active.filter((g) => g.horizon === h),
    })).filter((grp) => grp.goals.length > 0);
  }, [live]);

  const addGoal = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    void actions.createGoal({ title, horizon: newHorizon });
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteGoal = (g: GoalRow) =>
    undo.schedule(g.id, `Deleted goal “${g.title}”`, () => void actions.deleteGoal(g.id));

  return (
    <div className="todo__scroll goals">
      <AddRow value={newTitle} placeholder="Add a goal" onChange={setNewTitle} onKeyDown={addGoal}>
        <select
          className="field goals__horizon"
          aria-label="Timeline for the new goal"
          value={newHorizon}
          onChange={(e) => setNewHorizon(e.target.value as GoalHorizon)}
        >
          {HORIZON_ORDER.map((h) => (
            <option key={h} value={h}>
              {HORIZON_LABEL[h]}
            </option>
          ))}
        </select>
      </AddRow>

      {groups.length === 0 && (
        <div className="blankstate">
          <span className="blankstate__icon">
            <Flag size={16} />
          </span>
          <p className="blankstate__title">No goals yet</p>
          <p className="blankstate__text">
            Name an outcome, pick its timeline, then break it into tasks. The tasks land in your
            list; the goal tracks their progress.
          </p>
        </div>
      )}

      {groups.map((grp) => (
        <section key={grp.horizon} className="goals__group">
          <h3 className="goals__group-head">{HORIZON_LABEL[grp.horizon]}</h3>
          {grp.goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              tasks={tasksByGoal.get(goal.id) ?? []}
              expanded={expanded.has(goal.id)}
              onExpand={() => toggle(goal.id)}
              onDelete={() => deleteGoal(goal)}
              onDeleteTask={(t) =>
                undo.schedule(t.id, `Deleted “${t.title}”`, () => void actions.deleteTask(t.id))
              }
            />
          ))}
        </section>
      ))}

      {archived.length > 0 && (
        <section className="goals__archive">
          <button
            type="button"
            className="todo__backlog-toggle"
            aria-expanded={archiveOpen}
            onClick={() => setArchiveOpen((v) => !v)}
          >
            <ChevronRight className={`caret${archiveOpen ? " caret--open" : ""}`} size={12} />
            Archived
            <span className="todo__count num">{archived.length}</span>
          </button>
          {archiveOpen && (
            <ul className="goals__archived">
              {archived.map((g) => (
                <li key={g.id}>
                  <Archive size={13} aria-hidden />
                  <span className="goals__archived-title">{g.title}</span>
                  <button
                    type="button"
                    className="goal__task-move"
                    onClick={() => void actions.updateGoal(g.id, { status: "active" })}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="row__remove"
                    aria-label={`Delete goal “${g.title}”`}
                    onClick={() => deleteGoal(g)}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

interface CardProps {
  goal: GoalRow;
  tasks: TaskRow[];
  expanded: boolean;
  onExpand: () => void;
  onDelete: () => void;
  onDeleteTask: (t: TaskRow) => void;
}

function GoalCard({ goal, tasks, expanded, onExpand, onDelete, onDeleteTask }: CardProps) {
  const { actions } = useReadyStore();
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);

  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const pct = total === 0 ? 0 : done / total;
  const date = formatGoalDate(goal.targetDate);
  const complete = goal.status === "done";
  const update = (patch: Partial<GoalRow>) => void actions.updateGoal(goal.id, patch);

  const addTask = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    void actions.createTask({
      title,
      goalId: goal.id,
      project: goal.project ?? "myPA",
      section: "backlog",
      importance: "medium",
    });
  };

  return (
    <article className={`goal${complete ? " goal--done" : ""}`}>
      {renaming ? (
        <div className="goal__head goal__head--editing">
          <Ring pct={complete ? 1 : pct} />
          <div className="goal__meta">
            <EditableText
              autoEdit
              className="goal__title"
              label="Goal name"
              value={goal.title}
              onSave={(title) => update({ title })}
              onEditEnd={() => setRenaming(false)}
            />
          </div>
        </div>
      ) : (
        <header
          className="goal__head"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={onExpand}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onExpand();
            }
          }}
        >
          <Ring pct={complete ? 1 : pct} />
          <div className="goal__meta">
            <span className="goal__title">{goal.title}</span>
            <div className="goal__sub num">
              {goal.project && <span className="goal__chip">{goal.project}</span>}
              <span>
                {done} of {total} {total === 1 ? "task" : "tasks"}
              </span>
              {date && <span>by {date}</span>}
            </div>
          </div>
          <ChevronRight className={`caret${expanded ? " caret--open" : ""}`} size={12} />
        </header>
      )}

      {expanded && (
        <div className="goal__body">
          <GoalDetail value={goal.detail} onSave={(detail) => update({ detail })} />

          <div className="goal__fields">
            <select
              className="field goal__field"
              aria-label="Timeline"
              value={goal.horizon}
              onChange={(e) => update({ horizon: e.target.value as GoalHorizon })}
            >
              {HORIZON_ORDER.map((h) => (
                <option key={h} value={h}>
                  {HORIZON_LABEL[h]}
                </option>
              ))}
            </select>
            <div className="goal__date">
              <DatePicker
                value={goal.targetDate ?? ""}
                placeholder="Target date"
                onChange={(targetDate) => update({ targetDate })}
              />
              {goal.targetDate && (
                <button
                  type="button"
                  className="row__remove goal__date-clear"
                  aria-label="Clear target date"
                  onClick={() => update({ targetDate: null })}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {tasks.length > 0 && (
            <ul className="goal__tasks">
              {tasks.map((t) => (
                <li key={t.id} className={`goal__task${t.done ? " is-done" : ""}`}>
                  <button
                    type="button"
                    className={`row__check row__check--sm${t.done ? " row__check--on" : ""}`}
                    aria-label={t.done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}
                    aria-pressed={t.done}
                    onClick={() => void actions.updateTask(t.id, { done: !t.done })}
                  />
                  <span
                    className={`row__prio row__prio--${t.importance} row__prio--static`}
                    title={IMPORTANCE_LABEL[t.importance]}
                  />
                  <EditableText
                    className="goal__task-title"
                    label="Task title"
                    value={t.title}
                    onSave={(title) => void actions.updateTask(t.id, { title })}
                  />
                  <button
                    type="button"
                    className="goal__task-move"
                    title={
                      t.section === "today"
                        ? "In Today. Click to move it to the backlog"
                        : "In the backlog. Click to move it to Today"
                    }
                    onClick={() =>
                      void actions.updateTask(t.id, {
                        section: t.section === "today" ? "backlog" : "today",
                      })
                    }
                  >
                    {t.section === "today" ? "Today" : "Backlog"}
                  </button>
                  <button
                    type="button"
                    className="row__remove"
                    aria-label={`Delete “${t.title}”`}
                    onClick={() => onDeleteTask(t)}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <AddRow
            value={draft}
            placeholder="Break into a task"
            onChange={setDraft}
            onKeyDown={addTask}
          />

          <div className="goal__actions">
            <button type="button" onClick={() => update({ status: complete ? "active" : "done" })}>
              {complete ? "Reopen" : "Mark done"}
            </button>
            <button type="button" onClick={() => setRenaming(true)}>
              Rename
            </button>
            <button type="button" onClick={() => update({ status: "archived" })}>
              Archive
            </button>
            <button type="button" className="goal__delete" onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/** The goal's description: reads as text, edits in place, saves on blur. */
function GoalDetail({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      className="goal__detail"
      aria-label="Goal description"
      placeholder="Why this matters, what done looks like…"
      rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 60)))}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value.trim() && onSave(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, pct)));
  return (
    <svg className="goal-ring" viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <circle cx="12" cy="12" r={r} className="goal-ring__track" />
      <circle
        cx="12"
        cy="12"
        r={r}
        className="goal-ring__fill"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}
