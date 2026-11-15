import { useReadyStore } from "../lib/store";
import type { StudySettings } from "../../../shared/study";
import "../styles/study.css";

const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const len = (m: number) =>
  m % 60 === 0 ? `${m / 60} hour${m > 60 ? "s" : ""}` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} minutes`;

export function StudySettingsForm() {
  const { snapshot, actions } = useReadyStore();
  const s = snapshot.meta.study;
  const set = (patch: Partial<StudySettings>) => void actions.setStudySettings(patch);
  const toggleDay = (d: number) => {
    const next = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d];
    if (next.length) set({ days: next });
  };
  return (
    <>
      <div className="wsettings__field">
        <span className="wsettings__label">Study hours</span>
        <div className="wsettings__row">
          <input
            type="time"
            aria-label="Study from"
            className="wsettings__input"
            value={s.dayStart}
            onChange={(e) => e.target.value && set({ dayStart: e.target.value })}
          />
          <span className="wsettings__hint">to</span>
          <input
            type="time"
            aria-label="Study until"
            className="wsettings__input"
            value={s.dayEnd}
            onChange={(e) => e.target.value && set({ dayEnd: e.target.value })}
          />
        </div>
        <div className="sset__days" role="group" aria-label="Days you study">
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              className={`sset__day${s.days.includes(d) ? " is-on" : ""}`}
              aria-pressed={s.days.includes(d)}
              onClick={() => toggleDay(d)}
            >
              {DAY_LABEL[d]}
            </button>
          ))}
        </div>
        <small className="wsettings__hint">
          Planning only books sessions inside these hours and days, around your calendar and approved day plans.
        </small>
      </div>

      <div className="wsettings__field">
        <span className="wsettings__label">Sessions</span>
        <div className="wsettings__row">
          <select
            aria-label="Usual session length"
            className="wsettings__input"
            value={s.sessionMinutes}
            onChange={(e) => set({ sessionMinutes: Number(e.target.value) })}
          >
            {[25, 30, 45, 50, 60, 90].map((m) => (
              <option key={m} value={m}>
                {len(m)}
              </option>
            ))}
          </select>
          <select
            aria-label="Break between sessions"
            className="wsettings__input"
            value={s.breakMinutes}
            onChange={(e) => set({ breakMinutes: Number(e.target.value) })}
          >
            {[0, 5, 10, 15, 20, 30].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "No break" : `${m} min break`}
              </option>
            ))}
          </select>
        </div>
        <small className="wsettings__hint">The break is kept clear between a session and anything else.</small>
      </div>

      <label className="wsettings__field">
        <span className="wsettings__label">Most study in a day</span>
        <select
          className="wsettings__input"
          value={s.maxPerDay}
          onChange={(e) => set({ maxPerDay: Number(e.target.value) })}
        >
          {[60, 90, 120, 180, 240, 300, 360, 480].map((m) => (
            <option key={m} value={m}>
              {len(m)}
            </option>
          ))}
        </select>
      </label>

      <label className="wsettings__toggle">
        <input type="checkbox" checked={s.alerts} onChange={(e) => set({ alerts: e.target.checked })} />
        <span>
          Alert me when a session starts
          <small>A desktop notification with the subject and topic.</small>
        </span>
      </label>
    </>
  );
}
