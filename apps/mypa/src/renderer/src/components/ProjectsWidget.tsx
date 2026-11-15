import { useEffect, useMemo, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";

import {
  Archive,
  Check,
  ChevronLeft,
  Columns3,
  FolderKanban,
  List,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react";

import { PAGE_COLOR_CYCLE, PAGE_COLOR_LABEL, pageColorHex } from "../../../shared/pageColors";
import {
  breakdownPrompt,
  columnLabel,
  columnOf,
  columnTasks,
  COLUMNS,
  dueLabel,
  goalsOf,
  HEALTH_LABEL,
  sortBetween,
  summarize,
  targetLabel,
  tasksOf,
  type BoardColumn,
  type ProjectRow,
  type ProjectStatus,
  type ProjectSummary,
} from "../../../shared/projects";
import type { Importance, TaskRow, WidgetRow } from "../../../shared/types";
import { askAssistant } from "../lib/askAssistant";
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
import "../styles/projects.css";

type Saved = { key: number; label: string; undo: () => void };
type Flash = { text: string; error?: boolean };

/** Shared by the views: messages, undo, navigation. */
interface Ctx {
  widget: WidgetRow;
  now: number;
  setW: (s: Partial<WidgetRow["settings"]>) => void;
  hidden: Set<string>;
  schedule: (id: string, label: string, commit: () => void) => void;
  saved: (s: Omit<Saved, "key">) => void;
  flash: (f: Flash) => void;
  fail: (e: unknown) => void;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

const ymdOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const endOfDay = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
};

export function ProjectsWidget({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const undo = useUndo(widget.id);
  const now = useNow();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(null), 8000);
    return () => window.clearTimeout(t);
  }, [saved]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const ctx: Ctx = {
    widget,
    now,
    setW: (s) => void actions.updateWidgetSettings(widget.id, s),
    hidden: undo.hidden,
    schedule: undo.schedule,
    saved: (s) => setSaved({ ...s, key: Date.now() }),
    flash: setFlash,
    fail: (e) => setFlash({ text: captureError(e), error: true }),
  };

  const open = snapshot.projects.find((p) => p.id === widget.settings.projOpen && !undo.hidden.has(`p:${p.id}`)) ?? null;

  return (
    <div className="pj">
      {open ? <ProjectView ctx={ctx} project={open} /> : <Overview ctx={ctx} />}

      {flash && (flash.error || (!saved && !undo.latest)) && (
        <p className={`pj__flash${flash.error ? " is-error" : ""}`} role="status">
          {flash.text}
        </p>
      )}
      {undo.latest ? (
        <UndoToast
          key={undo.latest.id}
          label={undo.latest.label}
          onUndo={() => {
            const id = undo.latest!.id;
            undo.undo(id);
            // undoing a project delete takes you back into it
            if (id.startsWith("p:")) ctx.setW({ projOpen: id.slice(2) });
          }}
          onDismiss={() => undo.finish(undo.latest!.id)}
        />
      ) : (
        saved && (
          <UndoToast
            key={saved.key}
            label={saved.label}
            onUndo={() => {
              saved.undo();
              setSaved(null);
            }}
            onDismiss={() => setSaved(null)}
          />
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------- overview -- */

function HealthChip({ s }: { s: ProjectSummary }) {
  return (
    <span className={`pj__health is-${s.health}`} title={s.reason || undefined}>
      {HEALTH_LABEL[s.health]}
    </span>
  );
}

function Progress({ value, color }: { value: number; color: string }) {
  return (
    <span
      className="pj__bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <i style={{ width: `${Math.round(value * 100)}%`, background: color }} />
    </span>
  );
}

function Overview({ ctx }: { ctx: Ctx }) {
  const { snapshot, actions } = useReadyStore();
  const showAll = ctx.widget.settings.projShowAll === true;
  const [naming, setNaming] = useState<string | null>(null);

  const all = snapshot.projects.filter((p) => !ctx.hidden.has(`p:${p.id}`));
  const rows = useMemo(
    () =>
      all
        .filter((p) => showAll || p.status === "active" || p.status === "paused")
        .map((p) => ({ p, s: summarize(p, snapshot.tasks, snapshot.steps, ctx.now) }))
        .sort((a, b) => {
          const rank = (x: ProjectRow) => ["active", "paused", "done", "archived"].indexOf(x.status);
          return rank(a.p) - rank(b.p) || a.p.sort - b.p.sort;
        }),
    [all, showAll, snapshot.tasks, snapshot.steps, ctx.now],
  );
  const hiddenCount = all.length - all.filter((p) => p.status === "active" || p.status === "paused").length;

  const create = async () => {
    const name = (naming ?? "").trim();
    if (!name) return setNaming(null);
    try {
      const id = await actions.createProject(name);
      setNaming(null);
      ctx.setW({ projOpen: id });
    } catch (e) {
      ctx.fail(e);
    }
  };

  return (
    <>
      <div className="pj__head">
        <div className="seg" role="tablist" aria-label="Which projects">
          {[
            [false, "Active"],
            [true, "All"],
          ].map(([v, label]) => (
            <button
              key={String(label)}
              type="button"
              role="tab"
              aria-selected={showAll === v}
              className={`seg__btn${showAll === v ? " is-active" : ""}`}
              onClick={() => ctx.setW({ projShowAll: v as boolean })}
            >
              {label as string}
              {v === true && hiddenCount > 0 && !showAll && <span className="pj__seg-n">+{hiddenCount}</span>}
            </button>
          ))}
        </div>
        <span className="pj__grow" />
        <button type="button" className="pj__btn pj__btn--primary" onClick={() => setNaming("")}>
          <Plus size={14} /> New project
        </button>
      </div>

      <div className="pj__body">
        {naming !== null && (
          <div className="pj__new">
            <input
              autoFocus
              className="pj__field"
              placeholder="Project name, e.g. Website relaunch"
              aria-label="New project name"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
                if (e.key === "Escape") setNaming(null);
              }}
            />
            <button type="button" className="pj__btn" onClick={() => setNaming(null)}>
              Cancel
            </button>
            <button type="button" className="pj__btn pj__btn--primary" onClick={() => void create()}>
              Create
            </button>
          </div>
        )}

        {rows.length === 0 && naming === null ? (
          <div className="blankstate">
            <FolderKanban size={20} />
            <strong>{all.length ? "No active projects" : "No projects yet"}</strong>
            <span>
              {all.length
                ? "Finished and archived ones are under All."
                : "Start one here, or give a task a project in your To-do list."}
            </span>
          </div>
        ) : (
          <ul className="pj__cards">
            {rows.map(({ p, s }) => {
              const color = pageColorHex(p.color);
              const open = s.total - s.done;
              return (
                <li key={p.id}>
                  <button type="button" className={`pj__card is-${p.status}`} onClick={() => ctx.setW({ projOpen: p.id })}>
                    <span className="pj__card-head">
                      <i className="pj__swatch" style={{ background: color }} />
                      <strong>{p.name}</strong>
                      <HealthChip s={s} />
                    </span>
                    <Progress value={s.progress} color={color} />
                    <span className="pj__card-line">
                      {s.total
                        ? `${s.done} of ${s.total} done${s.doneThisWeek ? ` · ${s.doneThisWeek} this week` : ""}`
                        : "Add the first task"}
                    </span>
                    {open > 0 && (
                      <span className="pj__stages">
                        {(["todo", "doing", "waiting"] as const).map(
                          (c) =>
                            s.byColumn[c] > 0 && (
                              <span key={c} className={`pj__stage is-${c}`}>
                                {s.byColumn[c]} {columnLabel(c).toLowerCase()}
                              </span>
                            ),
                        )}
                      </span>
                    )}
                    {(s.reason || p.targetDate || s.next) && (
                      <span className="pj__card-foot">
                        {s.reason && s.health !== "on-track" ? (
                          <span className="pj__why">{s.reason}</span>
                        ) : p.targetDate ? (
                          <span>{targetLabel(p.targetDate, ctx.now)}</span>
                        ) : null}
                        {s.next && (
                          <span className="pj__next">
                            Next: {s.next.title} · {dueLabel(s.next.due!, ctx.now).text}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- project -- */

function ProjectView({ ctx, project: p }: { ctx: Ctx; project: ProjectRow }) {
  const { snapshot, actions } = useReadyStore();
  const view = ctx.widget.settings.projView ?? "board";
  const tasks = useMemo(
    () => tasksOf(p, snapshot.tasks).filter((t) => !ctx.hidden.has(`t:${t.id}`)),
    [p, snapshot.tasks, ctx.hidden],
  );
  const s = useMemo(() => summarize(p, snapshot.tasks, snapshot.steps, ctx.now), [p, snapshot.tasks, snapshot.steps, ctx.now]);
  const goals = goalsOf(p, snapshot.goals);
  const color = pageColorHex(p.color);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [editingDetail, setEditingDetail] = useState<string | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const update = (patch: Parameters<typeof actions.updateProject>[1]) =>
    actions.updateProject(p.id, patch).catch(ctx.fail);

  const saveName = async () => {
    const v = (renaming ?? "").trim();
    setRenaming(null);
    if (v && v !== p.name) await update({ name: v });
  };

  const setStatus = (status: ProjectStatus) => {
    const prev = p.status;
    void update({ status });
    if (status === "archived" || status === "done")
      ctx.saved({
        label: status === "done" ? `Marked “${p.name}” finished` : `Archived “${p.name}”`,
        undo: () => void update({ status: prev }),
      });
  };

  const remove = () => {
    const n = tasks.length;
    ctx.setW({ projOpen: null });
    ctx.schedule(
      `p:${p.id}`,
      `Deleted “${p.name}”${n ? ` and its ${n} task${n === 1 ? "" : "s"}` : ""}`,
      () => void actions.deleteProject(p.id),
    );
  };

  /** Moves a task and offers to undo it. */
  const move = (t: TaskRow, col: BoardColumn, sort?: number) => {
    const from = columnOf(t);
    if (from === col && sort === undefined) return;
    const prevSort = t.sort;
    const prevSection = t.section;
    void actions.moveTask(t.id, col, sort).catch(ctx.fail);
    if (from !== col)
      ctx.saved({
        label: col === "done" ? `Done: ${t.title}` : `Moved to ${columnLabel(col)}`,
        undo: () => {
          void actions.moveTask(t.id, from, prevSort).then(() => {
            if (col === "doing" && prevSection !== "today") void actions.updateTask(t.id, { section: prevSection });
          });
        },
      });
  };

  const removeTask = (t: TaskRow) => {
    if (editing === t.id) setEditing(null);
    ctx.schedule(`t:${t.id}`, `Deleted “${t.title}”`, () => void actions.deleteTask(t.id));
  };

  const addTask = async (col: BoardColumn, title: string) => {
    const t = title.trim();
    if (!t) return;
    // new tasks go to the end of their column, in the order they're typed
    const last = columnTasks(tasks, col === "done" ? "todo" : col).at(-1);
    await actions
      .createTask({
        title: t,
        project: p.name,
        section: col === "doing" ? "today" : "backlog",
        stage: col === "done" ? "todo" : col,
        sort: last ? last.sort + 1 : undefined,
      })
      .catch(ctx.fail);
  };

  const shared = { ctx, tasks, goals, editing, setEditing, move, removeTask, addTask, color };

  return (
    <>
      <div className="pj__head">
        <button
          type="button"
          className="pj__icon"
          aria-label="All projects"
          title="All projects"
          onClick={() => ctx.setW({ projOpen: null })}
        >
          <ChevronLeft size={16} />
        </button>
        <i className="pj__swatch" style={{ background: color }} />
        {renaming !== null ? (
          <input
            autoFocus
            className="pj__field pj__field--title"
            aria-label="Project name"
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
              if (e.key === "Escape") setRenaming(null);
            }}
            onBlur={() => void saveName()}
          />
        ) : (
          <button type="button" className="pj__name" title="Rename" onClick={() => setRenaming(p.name)}>
            {p.name}
          </button>
        )}
        <HealthChip s={s} />
        <span className="pj__grow" />
        <div className="seg" role="tablist" aria-label="View">
          {(
            [
              ["board", "Board", Columns3],
              ["list", "List", List],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              title={label}
              className={`seg__btn${view === id ? " is-active" : ""}`}
              onClick={() => ctx.setW({ projView: id })}
            >
              <Icon size={13} />
              <span className="pj__tab-name">{label}</span>
            </button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="pj__icon" aria-label="Project options">
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="pj__menu">
            <DropdownMenuItem onSelect={() => setRenaming(p.name)}>
              <Pencil size={14} /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditingDetail(p.detail)}>
              <Pencil size={14} /> {p.detail ? "Edit the description" : "Add a description"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditingTarget(true)}>
              <Target size={14} /> {p.targetDate ? "Change the target date" : "Set a target date"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => askAssistant(breakdownPrompt(p, tasks))}>
              <Sparkles size={14} /> Break it down with the Assistant
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Colour</DropdownMenuLabel>
            <div className="pj__colors">
              {PAGE_COLOR_CYCLE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`pj__color${p.color === c ? " is-on" : ""}`}
                  style={{ background: pageColorHex(c) }}
                  aria-label={PAGE_COLOR_LABEL[c]}
                  title={PAGE_COLOR_LABEL[c]}
                  onClick={() => void update({ color: c })}
                />
              ))}
            </div>
            <DropdownMenuSeparator />
            {p.status !== "active" && (
              <DropdownMenuItem onSelect={() => setStatus("active")}>
                <Play size={14} /> Make active again
              </DropdownMenuItem>
            )}
            {p.status === "active" && (
              <DropdownMenuItem onSelect={() => setStatus("paused")}>
                <Pause size={14} /> Pause
              </DropdownMenuItem>
            )}
            {p.status !== "done" && (
              <DropdownMenuItem onSelect={() => setStatus("done")}>
                <Check size={14} /> Mark finished
              </DropdownMenuItem>
            )}
            {p.status !== "archived" && (
              <DropdownMenuItem onSelect={() => setStatus("archived")}>
                <Archive size={14} /> Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="pj__danger" onSelect={remove}>
              <Trash2 size={14} /> Delete the project{tasks.length ? ` and ${tasks.length} task${tasks.length === 1 ? "" : "s"}` : ""}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="pj__meta">
        <Progress value={s.progress} color={color} />
        <span className="pj__pct">{Math.round(s.progress * 100)}%</span>
        <span className="pj__meta-text">
          {s.done} of {s.total} done
          {p.status !== "active" && ` · ${p.status === "done" ? "Finished" : p.status === "paused" ? "Paused" : "Archived"}`}
        </span>
        {editingTarget ? (
          <span className="pj__target-edit">
            <input
              autoFocus
              type="date"
              className="pj__field pj__field--date"
              aria-label="Target date"
              defaultValue={p.targetDate ?? ""}
              onKeyDown={(e) => e.key === "Escape" && setEditingTarget(false)}
              onBlur={(e) => {
                setEditingTarget(false);
                const v = e.target.value || null;
                if (v !== p.targetDate) void update({ targetDate: v });
              }}
            />
            {p.targetDate && (
              <button
                type="button"
                className="pj__icon"
                aria-label="Clear the target date"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setEditingTarget(false);
                  void update({ targetDate: null });
                }}
              >
                <X size={13} />
              </button>
            )}
          </span>
        ) : (
          p.targetDate && (
            <button
              type="button"
              className={`pj__target${s.daysLeft !== null && s.daysLeft < 0 && s.total > s.done ? " is-late" : ""}`}
              onClick={() => setEditingTarget(true)}
            >
              {targetLabel(p.targetDate, ctx.now)}
            </button>
          )
        )}
      </div>

      {editingDetail !== null ? (
        <textarea
          autoFocus
          className="pj__field pj__detail-edit"
          aria-label="Description"
          placeholder="What is this project, and what does done look like?"
          value={editingDetail}
          rows={3}
          onChange={(e) => setEditingDetail(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditingDetail(null)}
          onBlur={() => {
            if (editingDetail.trim() !== p.detail) void update({ detail: editingDetail.trim() });
            setEditingDetail(null);
          }}
        />
      ) : (
        p.detail && (
          <button type="button" className="pj__detail" title="Edit" onClick={() => setEditingDetail(p.detail)}>
            {p.detail}
          </button>
        )
      )}

      {goals.length > 0 && (
        <div className="pj__goals">
          {goals.map((g) => {
            const linked = tasks.filter((t) => t.goalId === g.id);
            const d = linked.filter((t) => t.done).length;
            return (
              <span key={g.id} className={`pj__goal${g.status === "done" ? " is-done" : ""}`} title={g.detail || g.title}>
                <Target size={12} /> {g.title}
                {linked.length > 0 && (
                  <small>
                    {d}/{linked.length}
                  </small>
                )}
              </span>
            );
          })}
        </div>
      )}

      {view === "board" ? <Board {...shared} /> : <ListView {...shared} />}
    </>
  );
}

interface ViewProps {
  ctx: Ctx;
  tasks: TaskRow[];
  goals: ReturnType<typeof goalsOf>;
  editing: string | null;
  setEditing: (id: string | null) => void;
  move: (t: TaskRow, col: BoardColumn, sort?: number) => void;
  removeTask: (t: TaskRow) => void;
  addTask: (col: BoardColumn, title: string) => Promise<void>;
  color: string;
}

/* ----------------------------------------------------------------- board -- */

function Board(v: ViewProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ col: BoardColumn; index: number } | null>(null);
  const [adding, setAdding] = useState<{ col: BoardColumn; text: string } | null>(null);
  const [doneAll, setDoneAll] = useState(false);

  const dragged = v.tasks.find((t) => t.id === dragId) ?? null;

  const over = (col: BoardColumn, e: ReactDragEvent<HTMLElement>) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-card]")].filter(
      (el) => el.dataset.card !== dragId,
    );
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i]!.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    if (drop?.col !== col || drop.index !== index) setDrop({ col, index });
  };

  const onDrop = (col: BoardColumn, e: ReactDragEvent<HTMLElement>) => {
    e.preventDefault();
    const t = dragged;
    const at = drop?.col === col ? drop.index : 0;
    setDrop(null);
    setDragId(null);
    if (!t) return;
    if (col === "done") return v.move(t, "done");
    const list = columnTasks(v.tasks, col).filter((x) => x.id !== t.id);
    const sort = sortBetween(list[at - 1]?.sort, list[at]?.sort);
    v.move(t, col, sort);
  };

  return (
    <div className="pj__board">
      {COLUMNS.map(({ id: col, label }) => {
        let list = columnTasks(v.tasks, col);
        const total = list.length;
        if (col === "done" && !doneAll) list = list.slice(0, 12);
        const shown = list.filter((t) => t.id !== dragId);
        return (
          <section
            key={col}
            className={`pj__col is-${col}${drop?.col === col ? " is-over" : ""}`}
            aria-label={label}
            onDragOver={(e) => over(col, e)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
            }}
            onDrop={(e) => onDrop(col, e)}
          >
            <header className="pj__col-head">
              <span>{label}</span>
              <small>{total}</small>
              <span className="pj__grow" />
              {col !== "done" && (
                <button
                  type="button"
                  className="pj__icon pj__icon--sm"
                  aria-label={`Add a task to ${label}`}
                  title={`Add a task to ${label}`}
                  onClick={() => setAdding({ col, text: "" })}
                >
                  <Plus size={14} />
                </button>
              )}
            </header>
            <div className="pj__col-body">
              {adding?.col === col && (
                <input
                  autoFocus
                  className="pj__field pj__add"
                  placeholder="Task, then Enter"
                  aria-label={`New task in ${label}`}
                  value={adding.text}
                  onChange={(e) => setAdding({ col, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && adding.text.trim()) {
                      void v.addTask(col, adding.text);
                      setAdding({ col, text: "" });
                    }
                    if (e.key === "Escape") setAdding(null);
                  }}
                  onBlur={() => !adding.text.trim() && setAdding(null)}
                />
              )}
              {shown.map((t, i) => (
                <div key={t.id}>
                  {drop?.col === col && drop.index === i && <div className="pj__drop" />}
                  <Card {...v} t={t} onDragStart={() => setDragId(t.id)} onDragEnd={() => (setDragId(null), setDrop(null))} />
                </div>
              ))}
              {drop?.col === col && drop.index >= shown.length && <div className="pj__drop" />}
              {total === 0 && adding?.col !== col && !dragId && (
                <p className="pj__col-empty">{col === "done" ? "Finished tasks land here." : "Nothing here."}</p>
              )}
              {col === "done" && total > 12 && (
                <button type="button" className="pj__link" onClick={() => setDoneAll((x) => !x)}>
                  {doneAll ? "Show fewer" : `Show all ${total}`}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ card -- */

function Card(v: ViewProps & { t: TaskRow; onDragStart?: () => void; onDragEnd?: () => void }) {
  const { snapshot } = useReadyStore();
  const { t } = v;
  if (v.editing === t.id) return <CardEditor {...v} />;
  const steps = snapshot.steps.filter((s) => s.taskId === t.id);
  const goal = t.goalId ? v.goals.find((g) => g.id === t.goalId) : null;
  const due = t.due !== null && !t.done ? dueLabel(t.due, v.ctx.now) : null;
  return (
    <div
      data-card={t.id}
      className={`pj__task${t.done ? " is-done" : ""}`}
      draggable={!!v.onDragStart}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", t.id);
        e.dataTransfer.effectAllowed = "move";
        v.onDragStart?.();
      }}
      onDragEnd={v.onDragEnd}
    >
      <button type="button" className="pj__task-main" onClick={() => v.setEditing(t.id)} title="Edit">
        <span className="pj__task-title">
          <i className={`row__prio row__prio--static row__prio--${t.importance}`} aria-label={`${t.importance} importance`} />
          {t.title}
        </span>
        {(due || steps.length > 0 || goal) && (
          <span className="pj__task-meta">
            {due && <span className={`pj__due${due.late ? " is-late" : due.soon ? " is-soon" : ""}`}>{due.text}</span>}
            {steps.length > 0 && (
              <span>
                {steps.filter((s) => s.done).length}/{steps.length} steps
              </span>
            )}
            {goal && (
              <span className="pj__task-goal">
                <Target size={11} /> {goal.title}
              </span>
            )}
          </span>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="pj__icon pj__icon--sm pj__task-menu" aria-label={`Move ${t.title}`}>
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="pj__menu">
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {COLUMNS.map((c) => (
            <DropdownMenuItem key={c.id} disabled={columnOf(t) === c.id} onSelect={() => v.move(t, c.id)}>
              <span className="pj__menu-check">{columnOf(t) === c.id && <Check size={14} />}</span>
              {c.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => v.setEditing(t.id)}>
            <Pencil size={14} /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem className="pj__danger" onSelect={() => v.removeTask(t)}>
            <Trash2 size={14} /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function CardEditor(v: ViewProps & { t: TaskRow }) {
  const { snapshot, actions } = useReadyStore();
  const { t } = v;
  const [title, setTitle] = useState(t.title);
  const [step, setStep] = useState("");
  const steps = snapshot.steps.filter((s) => s.taskId === t.id).sort((a, b) => a.sort - b.sort);
  const upd = (patch: Partial<TaskRow>) => void actions.updateTask(t.id, patch).catch(v.ctx.fail);

  const saveTitle = () => {
    const n = title.trim();
    if (n && n !== t.title) upd({ title: n });
  };
  const close = () => {
    saveTitle();
    v.setEditing(null);
  };

  return (
    <div
      data-card={t.id}
      className="pj__task pj__editor"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <textarea
        autoFocus
        className="pj__field pj__editor-title"
        aria-label="Task"
        rows={2}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            close();
          }
        }}
      />
      <div className="pj__editor-grid">
        <label>
          <span>Stage</span>
          <select
            className="pj__field"
            value={columnOf(t)}
            onChange={(e) => v.move(t, e.target.value as BoardColumn)}
          >
            {COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Importance</span>
          <select
            className="pj__field"
            value={t.importance}
            onChange={(e) => upd({ importance: e.target.value as Importance })}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          <span>Due</span>
          <input
            type="date"
            className="pj__field"
            value={t.due !== null ? ymdOf(t.due) : ""}
            onChange={(e) => upd({ due: e.target.value ? endOfDay(e.target.value) : null })}
          />
        </label>
        {v.goals.length > 0 && (
          <label>
            <span>Goal</span>
            <select
              className="pj__field"
              value={t.goalId ?? ""}
              onChange={(e) => upd({ goalId: e.target.value || null })}
            >
              <option value="">None</option>
              {v.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="pj__steps">
        {steps.map((s) => (
          <div key={s.id} className={`pj__step${s.done ? " is-done" : ""}`}>
            <button
              type="button"
              role="checkbox"
              aria-checked={s.done}
              aria-label={s.title}
              className="pj__check"
              onClick={() => void actions.updateStep(s.id, { done: !s.done })}
            >
              {s.done && <Check size={11} strokeWidth={3} />}
            </button>
            <span>{s.title}</span>
            <button
              type="button"
              className="pj__icon pj__icon--sm"
              aria-label={`Remove step ${s.title}`}
              onClick={() => void actions.deleteStep(s.id)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <input
          className="pj__field pj__step-add"
          placeholder="Add a step"
          aria-label="Add a step"
          value={step}
          onChange={(e) => setStep(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && step.trim()) {
              void actions.createStep({ taskId: t.id, title: step.trim() });
              setStep("");
            }
          }}
        />
      </div>

      <div className="pj__editor-actions">
        <button type="button" className="pj__btn pj__btn--ghost" onClick={() => v.removeTask(t)}>
          <Trash2 size={13} /> Delete
        </button>
        <span className="pj__grow" />
        <button type="button" className="pj__btn pj__btn--primary" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ list -- */

function ListView(v: ViewProps) {
  const [adding, setAdding] = useState("");
  return (
    <div className="pj__list">
      <input
        className="pj__field pj__add"
        placeholder="Add a task to To do, then Enter"
        aria-label="New task"
        value={adding}
        onChange={(e) => setAdding(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && adding.trim()) {
            void v.addTask("todo", adding);
            setAdding("");
          }
        }}
      />
      {COLUMNS.map(({ id: col, label }) => {
        const list = columnTasks(v.tasks, col);
        if (!list.length) return null;
        return (
          <section key={col} className="pj__list-group">
            <h4>
              {label} <small>{list.length}</small>
            </h4>
            {list.map((t) =>
              v.editing === t.id ? (
                <CardEditor key={t.id} {...v} t={t} />
              ) : (
                <div key={t.id} className={`pj__row${t.done ? " is-done" : ""}`}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={t.done}
                    aria-label={t.done ? `Reopen ${t.title}` : `Finish ${t.title}`}
                    className="pj__check"
                    onClick={() => v.move(t, t.done ? "todo" : "done")}
                  >
                    {t.done && <Check size={11} strokeWidth={3} />}
                  </button>
                  <button type="button" className="pj__row-title" onClick={() => v.setEditing(t.id)}>
                    <i className={`row__prio row__prio--static row__prio--${t.importance}`} />
                    {t.title}
                  </button>
                  {t.due !== null && !t.done && (
                    <span className={`pj__due${dueLabel(t.due, v.ctx.now).late ? " is-late" : ""}`}>
                      {dueLabel(t.due, v.ctx.now).text}
                    </span>
                  )}
                  {!t.done && (
                    <select
                      className="pj__row-stage"
                      aria-label={`Stage of ${t.title}`}
                      value={columnOf(t)}
                      onChange={(e) => v.move(t, e.target.value as BoardColumn)}
                    >
                      {COLUMNS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ),
            )}
          </section>
        );
      })}
      {v.tasks.length === 0 && <p className="pj__col-empty">No tasks yet. Add one above.</p>}
    </div>
  );
}
