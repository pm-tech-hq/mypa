import { useState } from "react";

import { PROJECTS, type Importance, type Project } from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface Props {
  /** The answer being saved. */
  items: string[];
  defaultTitle: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}

/** Turns the list in a tutor answer into real to-dos — one task with steps, or
 *  one task per line. */
export function TutorSave({ items, defaultTitle, onDone, onCancel }: Props) {
  const { snapshot, actions } = useReadyStore();
  const projects = Array.from(new Set([...PROJECTS, ...snapshot.tasks.map((t) => t.project)]));
  const [title, setTitle] = useState(defaultTitle);
  const [picked, setPicked] = useState<boolean[]>(() => items.map(() => true));
  const [asSteps, setAsSteps] = useState(true);
  const [project, setProject] = useState<Project>("myPA");
  const [importance, setImportance] = useState<Importance>("medium");
  const [saving, setSaving] = useState(false);

  const chosen = items.filter((_, i) => picked[i]);
  const canSave = !saving && (items.length === 0 ? title.trim() !== "" : chosen.length > 0);

  const save = async () => {
    setSaving(true);
    try {
      if (items.length === 0 || (asSteps && title.trim())) {
        await actions.createTask({ title: title.trim(), project, importance });
        // createTask returns nothing; the new task is the newest one with this title.
        const fresh = await window.mypa.db.snapshot();
        const task = fresh.tasks
          .filter((t) => t.title === title.trim())
          .reduce((a, b) => (b.createdAt >= a.createdAt ? b : a));
        for (const step of chosen) await actions.createStep({ taskId: task.id, title: step });
        onDone(
          chosen.length
            ? `Added a task with ${chosen.length} step${chosen.length === 1 ? "" : "s"} to your to-do list.`
            : "Added a task to your to-do list.",
        );
      } else {
        for (const item of [...chosen].reverse())
          await actions.createTask({ title: item, project, importance });
        onDone(`Added ${chosen.length} task${chosen.length === 1 ? "" : "s"} to your to-do list.`);
      }
    } catch (err) {
      onDone(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="tut-save">
      {items.length === 0 ? (
        <p className="tut-save__hint">No list found in this answer, so it saves as one task.</p>
      ) : (
        <div className="tut-save__modes" role="radiogroup" aria-label="How to save">
          <button
            type="button"
            role="radio"
            aria-checked={asSteps}
            className={asSteps ? "is-on" : ""}
            onClick={() => setAsSteps(true)}
          >
            One task, items as steps
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!asSteps}
            className={!asSteps ? "is-on" : ""}
            onClick={() => setAsSteps(false)}
          >
            Separate tasks
          </button>
        </div>
      )}

      {(asSteps || items.length === 0) && (
        <Input
          aria-label="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
        />
      )}

      {items.length > 0 && (
        <div className="tut-save__items">
          {items.map((item, i) => (
            <label key={i}>
              <input
                type="checkbox"
                checked={picked[i]}
                onChange={() => setPicked((p) => p.map((v, j) => (j === i ? !v : v)))}
              />
              <span>{item}</span>
            </label>
          ))}
        </div>
      )}

      <div className="tut-save__row">
        <select
          className="field tut__select"
          aria-label="Project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          className="field tut__select tut__select--narrow"
          aria-label="Importance"
          value={importance}
          onChange={(e) => setImportance(e.target.value as Importance)}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="tut-save__row tut-save__row--end">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!canSave} onClick={() => void save()}>
          Add to to-do
        </Button>
      </div>
    </div>
  );
}
