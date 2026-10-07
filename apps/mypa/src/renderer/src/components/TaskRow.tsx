import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import {
  ArrowDownToLine,
  ArrowUpToLine,
  CalendarClock,
  ChevronRight,
  Flag,
  Folder,
  ListPlus,
  MoreHorizontal,
  Target,
  Trash2,
  X,
} from "lucide-react";

import { EditableText } from "./EditableText";
import { Calendar } from "./ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import { useReadyStore } from "../lib/store";
import { endOfDay, endOfNextMonday, formatCountdown, formatDueDate } from "../lib/todos";
import {
  IMPORTANCE_LABEL,
  type GoalRow,
  type Importance,
  type Project,
  type StepRow,
  type TaskRow,
} from "../../../shared/types";

const NEXT_IMPORTANCE: Record<Importance, Importance> = {
  high: "medium",
  medium: "low",
  low: "high",
};

export interface TaskRowProps {
  item: TaskRow;
  steps: StepRow[];
  goal: GoalRow | undefined;
  goals: GoalRow[];
  projects: Project[];
  showGoalTag: boolean;
  now: number;
  expanded: boolean;
  draggable: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onExpand: (id: string, open?: boolean) => void;
  onDelete: (task: TaskRow) => void;
  onDeleteStep: (step: StepRow) => void;
  onDragStart: (e: DragEvent<HTMLLIElement>, task: TaskRow) => void;
  onDragEnd: () => void;
}

export function TaskItem({
  item,
  steps,
  goal,
  goals,
  projects,
  showGoalTag,
  now,
  expanded,
  draggable,
  dragging,
  dropBefore,
  onExpand,
  onDelete,
  onDeleteStep,
  onDragStart,
  onDragEnd,
}: TaskRowProps) {
  const { actions } = useReadyStore();
  const [dueOpen, setDueOpen] = useState(false);
  const [addingStep, setAddingStep] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  /** What to do once the menu has closed and handed focus back. */
  const afterMenu = useRef<"due" | "step" | null>(null);

  const stepsDone = steps.filter((s) => s.done).length;
  const countdown = item.due != null && !item.done ? formatCountdown(item.due, now) : null;
  const update = (patch: Partial<TaskRow>) => void actions.updateTask(item.id, patch);

  const setDue = (due: number | null) => {
    update({ due });
    setDueOpen(false);
  };

  const startAddStep = () => {
    setAddingStep(true);
    onExpand(item.id, true);
  };

  const onMenuCloseAutoFocus = (e: Event) => {
    const next = afterMenu.current;
    afterMenu.current = null;
    if (!next) return;
    e.preventDefault();
    if (next === "due") setDueOpen(true);
    else startAddStep();
  };

  const showSteps = expanded && (steps.length > 0 || addingStep);

  return (
    <li
      className={`row${item.done ? " row--done" : ""}${dragging ? " row--dragging" : ""}${dropBefore ? " row--drop-before" : ""}`}
      data-task-id={item.id}
      draggable={draggable && !editingTitle}
      onDragStart={(e) => onDragStart(e, item)}
      onDragEnd={onDragEnd}
    >
      <Popover open={dueOpen} onOpenChange={setDueOpen}>
        <PopoverAnchor asChild>
          <div className="row__main">
            <button
              type="button"
              className={`row__check${item.done ? " row__check--on" : ""}`}
              aria-label={item.done ? `Mark “${item.title}” not done` : `Mark “${item.title}” done`}
              aria-pressed={item.done}
              onClick={() => update({ done: !item.done })}
            />
            <button
              type="button"
              className={`row__prio row__prio--${item.importance}`}
              title={`${IMPORTANCE_LABEL[item.importance]}. Click to change`}
              aria-label={`Importance: ${IMPORTANCE_LABEL[item.importance]}. Change`}
              onClick={() => update({ importance: NEXT_IMPORTANCE[item.importance] })}
            />
            <div className="row__text">
              <EditableText
                className="row__title"
                label="Task title"
                value={item.title}
                onSave={(title) => update({ title })}
                onEditStart={() => setEditingTitle(true)}
                onEditEnd={() => setEditingTitle(false)}
              />
              {showGoalTag && goal && (
                <span className="row__goal">
                  <Target size={11} aria-hidden />
                  <span>{goal.title}</span>
                </span>
              )}
            </div>

            {(countdown || steps.length > 0) && (
              <div className="row__meta">
                {countdown && (
                  <button
                    type="button"
                    className={`row__due num${countdown.urgent ? " row__due--urgent" : ""}`}
                    title={`Due ${formatDueDate(item.due!)}. Click to change`}
                    onClick={() => setDueOpen(true)}
                  >
                    {countdown.text}
                  </button>
                )}
                {steps.length > 0 && (
                  <button
                    type="button"
                    className="row__micro-toggle num"
                    aria-expanded={expanded}
                    aria-label={`${stepsDone} of ${steps.length} steps done, ${expanded ? "hide" : "show"} steps`}
                    onClick={() => onExpand(item.id)}
                  >
                    <ChevronRight className={`caret${expanded ? " caret--open" : ""}`} size={12} />
                    {stepsDone}/{steps.length}
                  </button>
                )}
              </div>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="row__more"
                  aria-label={`More actions for “${item.title}”`}
                >
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="task-menu"
                onCloseAutoFocus={onMenuCloseAutoFocus}
              >
                <DropdownMenuItem
                  onSelect={() =>
                    update({ section: item.section === "today" ? "backlog" : "today" })
                  }
                >
                  {item.section === "today" ? <ArrowDownToLine /> : <ArrowUpToLine />}
                  {item.section === "today" ? "Move to backlog" : "Move to Today"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => (afterMenu.current = "due")}>
                  <CalendarClock />
                  {item.due != null ? "Change due date…" : "Set a due date…"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => (afterMenu.current = "step")}>
                  <ListPlus />
                  Add a step
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Flag />
                    Importance
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={item.importance}
                      onValueChange={(v) => update({ importance: v as Importance })}
                    >
                      {(["high", "medium", "low"] as const).map((imp) => (
                        <DropdownMenuRadioItem key={imp} value={imp}>
                          <span
                            className={`row__prio row__prio--${imp} row__prio--static`}
                            aria-hidden
                          />
                          {IMPORTANCE_LABEL[imp]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Target />
                    Goal
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="task-menu__scroll">
                    <DropdownMenuRadioGroup
                      value={item.goalId ?? ""}
                      onValueChange={(v) => update({ goalId: v || null })}
                    >
                      <DropdownMenuRadioItem value="">No goal</DropdownMenuRadioItem>
                      {goals.map((g) => (
                        <DropdownMenuRadioItem key={g.id} value={g.id}>
                          <span className="task-menu__text">{g.title}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Folder />
                    Project
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="task-menu__scroll">
                    <DropdownMenuRadioGroup
                      value={item.project}
                      onValueChange={(v) => update({ project: v })}
                    >
                      {projects.map((p) => (
                        <DropdownMenuRadioItem key={p} value={p}>
                          <span className="task-menu__text">{p}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(item)}>
                  <Trash2 />
                  Delete task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </PopoverAnchor>
        <PopoverContent className="due-pop w-auto p-0" align="end">
          <DuePicker due={item.due} now={now} onPick={setDue} />
        </PopoverContent>
      </Popover>

      {showSteps && (
        <ul className="row__micro">
          {steps.map((s) => (
            <li key={s.id} className={`micro${s.done ? " micro--done" : ""}`}>
              <button
                type="button"
                className={`row__check row__check--sm${s.done ? " row__check--on" : ""}`}
                aria-label={
                  s.done ? `Mark step “${s.title}” not done` : `Mark step “${s.title}” done`
                }
                aria-pressed={s.done}
                onClick={() => void actions.updateStep(s.id, { done: !s.done })}
              />
              <EditableText
                className="micro__title"
                label="Step"
                value={s.title}
                onSave={(title) => void actions.updateStep(s.id, { title })}
              />
              <button
                type="button"
                className="row__remove"
                aria-label={`Delete step “${s.title}”`}
                onClick={() => onDeleteStep(s)}
              >
                <X size={12} />
              </button>
            </li>
          ))}
          <li className="micro micro--add">
            <StepAdder
              autoFocus={addingStep}
              onAdd={(title) => void actions.createStep({ taskId: item.id, title })}
              onDone={() => setAddingStep(false)}
            />
          </li>
        </ul>
      )}
    </li>
  );
}

function StepAdder({
  autoFocus,
  onAdd,
  onDone,
}: {
  autoFocus: boolean;
  onAdd: (title: string) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setDraft("");
      e.currentTarget.blur();
      return;
    }
    if (e.key !== "Enter") return;
    const title = draft.trim();
    if (!title) return;
    onAdd(title);
    setDraft("");
  };
  return (
    <input
      ref={input}
      className="micro__add"
      placeholder="Add a step"
      aria-label="Add a step"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onDone}
    />
  );
}

function DuePicker({
  due,
  now,
  onPick,
}: {
  due: number | null;
  now: number;
  onPick: (due: number | null) => void;
}) {
  const tomorrow = endOfDay(now, 1);
  const monday = endOfNextMonday(now);
  const quick = [
    { label: "Today", due: endOfDay(now) },
    { label: "Tomorrow", due: tomorrow },
    monday === tomorrow
      ? { label: "In a week", due: endOfDay(now, 7) }
      : { label: "Next Monday", due: monday },
  ];
  return (
    <div className="due-picker">
      <div className="due-picker__quick">
        {quick.map((q) => (
          <button key={q.label} type="button" onClick={() => onPick(q.due)}>
            <span>{q.label}</span>
            <span className="due-picker__date num">{formatDueDate(q.due)}</span>
          </button>
        ))}
        {due != null && (
          <button type="button" className="due-picker__clear" onClick={() => onPick(null)}>
            No due date
          </button>
        )}
      </div>
      <Calendar
        mode="single"
        selected={due != null ? new Date(due) : undefined}
        defaultMonth={due != null ? new Date(due) : undefined}
        onSelect={(d) => d && onPick(endOfDay(d.getTime()))}
      />
    </div>
  );
}
