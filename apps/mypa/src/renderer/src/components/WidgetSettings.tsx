import { useState } from "react";

import { X } from "lucide-react";

import { useReadyStore } from "../lib/store";
import { openMarket } from "../lib/marketBus";
import { widgetDisplayTitle } from "../lib/widgetKinds";
import { describePermission } from "../../../shared/widgetPlatform";
import {
  DEFAULT_CALENDAR_SETTINGS,
  DEFAULT_TODO_SETTINGS,
  DEFAULT_TRANSCRIBE_SETTINGS,
  type CalendarSettings,
  type Project,
  type TodoSettings,
  type TranscribeSettings,
  type WhisperModelSize,
  type WidgetRow,
} from "../../../shared/types";
import { CalendarAccounts } from "./CalendarAccounts";
import { TrustBadge } from "./TrustBadge";

interface Props {
  widget: WidgetRow;
  onClose: () => void;
}

export function WidgetSettings({ widget, onClose }: Props) {
  const { snapshot, actions } = useReadyStore();
  // Legacy "Widget" titles open as the kind's name; saving writes it back.
  const [title, setTitle] = useState(() => widgetDisplayTitle(widget));

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== widget.title)
      void actions.updateWidget(widget.id, { title: next });
  };

  return (
    <div className="wsettings">
      <div className="wsettings__head">
        <span>{widgetDisplayTitle(widget)} settings</span>
        <button
          type="button"
          className="widget__icon widget__close"
          aria-label="Close settings"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      <div className="wsettings__body">
        <label className="wsettings__field">
          <span className="wsettings__label">Name</span>
          <input
            className="wsettings__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </label>

        {widget.kind === "todo" && <TodoSettingsForm widget={widget} />}
        {widget.kind === "blank" && (
          <p className="wsettings__hint">Type directly in the note area.</p>
        )}
        {widget.kind === "calendar" && <CalendarSettingsForm widget={widget} />}
        {widget.kind === "transcribe" && (
          <TranscribeSettingsForm widget={widget} />
        )}
        {widget.kind === "custom" && <CustomSettingsForm widget={widget} />}

        {widget.kind === "todo" && (
          <label className="wsettings__toggle">
            <input
              type="checkbox"
              checked={snapshot.meta.carryOver}
              onChange={(e) => void actions.setCarryOver(e.target.checked)}
            />
            <span>
              Carry unfinished <em>Today</em> tasks over to the next day
              <small>Applies to every to-do list</small>
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

function TodoSettingsForm({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const s: TodoSettings = { ...DEFAULT_TODO_SETTINGS, ...widget.settings };

  const set = (patch: Partial<TodoSettings>) =>
    void actions.updateWidgetSettings(widget.id, patch);

  const projectsInUse = Array.from(
    new Set(snapshot.tasks.map((t) => t.project)),
  ) as Project[];

  const allOn = s.projects === null;
  const isOn = (p: Project) => allOn || s.projects?.includes(p);

  const toggleProject = (p: Project) => {
    const current = s.projects ?? projectsInUse;
    const next = current.includes(p)
      ? current.filter((x) => x !== p)
      : [...current, p];
    set({ projects: next.length === projectsInUse.length ? null : next });
  };

  return (
    <>
      <div className="wsettings__field">
        <span className="wsettings__label">Projects</span>
        <div className="wsettings__chips">
          <button
            type="button"
            className={`chip${allOn ? " chip--on" : ""}`}
            onClick={() => set({ projects: null })}
          >
            All
          </button>
          {projectsInUse.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip${isOn(p) ? " chip--on" : ""}`}
              onClick={() => toggleProject(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <label className="wsettings__field">
        <span className="wsettings__label">Sort tasks by</span>
        <select
          className="wsettings__input"
          value={s.sort}
          onChange={(e) =>
            set({ sort: e.target.value as TodoSettings["sort"] })
          }
        >
          <option value="importance">Importance</option>
          <option value="due">Due date</option>
          <option value="manual">Manual (drag to reorder)</option>
        </select>
      </label>

      <label className="wsettings__field">
        <span className="wsettings__label">Density</span>
        <select
          className="wsettings__input"
          value={s.density}
          onChange={(e) =>
            set({ density: e.target.value as TodoSettings["density"] })
          }
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>

      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={s.showCompleted}
          onChange={(e) => set({ showCompleted: e.target.checked })}
        />
        <span>Show completed tasks</span>
      </label>

      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={s.showGoalTags}
          onChange={(e) => set({ showGoalTags: e.target.checked })}
        />
        <span>Show the goal tag on tasks</span>
      </label>

      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={s.backlogOpen}
          onChange={(e) => set({ backlogOpen: e.target.checked })}
        />
        <span>Open the Backlog by default</span>
      </label>
    </>
  );
}

function CalendarSettingsForm({ widget }: { widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const s: CalendarSettings = {
    ...DEFAULT_CALENDAR_SETTINGS,
    ...widget.settings,
  };

  const set = (patch: Partial<CalendarSettings>) =>
    void actions.updateWidgetSettings(widget.id, patch);

  return (
    <>
      <label className="wsettings__field">
        <span className="wsettings__label">Look ahead (agenda view)</span>
        <select
          className="wsettings__input"
          value={s.lookAheadDays}
          onChange={(e) => set({ lookAheadDays: Number(e.target.value) })}
        >
          <option value={7}>1 week</option>
          <option value={14}>2 weeks</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </label>

      <CalendarAccounts />

      <p className="wsettings__hint">
        Events you add always stay local to myPA. Connected calendars are
        read-only feeds shown alongside them.
      </p>
    </>
  );
}

function TranscribeSettingsForm({ widget }: { widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const s: TranscribeSettings = {
    ...DEFAULT_TRANSCRIBE_SETTINGS,
    ...widget.settings,
  };

  const set = (patch: Partial<TranscribeSettings>) =>
    void actions.updateWidgetSettings(widget.id, patch);

  return (
    <>
      <label className="wsettings__field">
        <span className="wsettings__label">Model size</span>
        <select
          className="wsettings__input"
          value={s.modelSize}
          onChange={(e) =>
            set({ modelSize: e.target.value as WhisperModelSize })
          }
        >
          <option value="tiny">Tiny: fastest, ~40 MB</option>
          <option value="base">Base: balanced, ~75 MB</option>
          <option value="small">Small: most accurate, ~250 MB</option>
        </select>
        <p className="wsettings__hint">
          Runs fully on this machine, no account or API key. The first
          transcription with a given size downloads it once; everything after is
          offline.
        </p>
      </label>

      <label className="wsettings__field">
        <span className="wsettings__label">yt-dlp path (optional)</span>
        <input
          className="wsettings__input"
          placeholder="Leave blank to use yt-dlp from PATH"
          value={s.ytdlpPath ?? ""}
          onChange={(e) => set({ ytdlpPath: e.target.value.trim() || null })}
        />
        <p className="wsettings__hint">
          Needed only for media links (YouTube and hundreds of other sites).
          Install it yourself, for example <code>winget install yt-dlp</code> or{" "}
          <code>pip install yt-dlp</code>, and set a path here only if it isn't
          already on PATH.
        </p>
      </label>
    </>
  );
}

/** Custom widgets: a form generated from the manifest's `settings`, then
 *  who made it and what it can reach. */
function CustomSettingsForm({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const installed = snapshot.installedWidgets.find((w) => w.manifest.id === widget.settings.pluginId);
  if (!installed) return null;
  const m = installed.manifest;
  const config = widget.settings.config ?? {};
  const value = (key: string, fallback: unknown) => (key in config ? config[key] : fallback);
  const set = (key: string, v: unknown) =>
    void actions.updateWidgetSettings(widget.id, { config: { ...config, [key]: v } });

  return (
    <>
      {(m.settings ?? []).map((f) => (
        <label
          key={f.key}
          className={f.type === "toggle" ? "wsettings__toggle" : "wsettings__field"}
        >
          {f.type === "toggle" ? (
            <>
              <input
                type="checkbox"
                checked={Boolean(value(f.key, f.default))}
                onChange={(e) => set(f.key, e.target.checked)}
              />
              <span>{f.label}</span>
            </>
          ) : (
            <>
              <span className="wsettings__label">{f.label}</span>
              {f.type === "select" ? (
                <select
                  className="wsettings__input"
                  value={String(value(f.key, f.default ?? ""))}
                  onChange={(e) => set(f.key, e.target.value)}
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="wsettings__input"
                  type={f.type === "number" ? "number" : "text"}
                  defaultValue={String(value(f.key, f.default ?? ""))}
                  placeholder={f.type === "text" ? f.placeholder : undefined}
                  min={f.type === "number" ? f.min : undefined}
                  max={f.type === "number" ? f.max : undefined}
                  onBlur={(e) =>
                    set(
                      f.key,
                      f.type === "number"
                        ? Number(e.target.value) || (f.default ?? 0)
                        : e.target.value,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              )}
            </>
          )}
        </label>
      ))}

      <div className="wsettings__field wsettings__about">
        <span className="wsettings__label">About</span>
        <p className="wsettings__hint wsettings__pub">
          {m.name} {m.version} by {m.publisher.name}
          <TrustBadge trust={installed.trust} size={13} withLabel />
        </p>
        <p className="wsettings__hint">
          {m.permissions.length
            ? `Can: ${m.permissions.map(describePermission).join("; ")}.`
            : "Has no access to your data or the internet."}
        </p>
        <button
          type="button"
          className="wsettings__link"
          onClick={() => openMarket({ view: "widget", id: m.id })}
        >
          Manage in the marketplace
        </button>
      </div>
    </>
  );
}
