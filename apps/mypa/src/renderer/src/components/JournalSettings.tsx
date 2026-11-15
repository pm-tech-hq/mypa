import { useState } from "react";

import { LOCK_AFTER_CHOICES } from "../../../shared/journal";
import { useReadyStore } from "../lib/store";
import { captureError } from "./CaptureComposer";

export const JOURNAL_REMINDER = "Write in your journal";

const lockLabel = (m: number) =>
  m === 0 ? "Only when myPA restarts" : m === 1 ? "After 1 minute" : m === 60 ? "After 1 hour" : `After ${m} minutes`;

/** Settings shared by every Journal widget: prompts, the passcode, export. */
export function JournalSettingsForm() {
  const { snapshot, actions } = useReadyStore();
  const j = snapshot.meta.journal;
  const s = j.settings;
  const set = (patch: Partial<typeof s>) => void actions.setJournalSettings(patch);

  const [mode, setMode] = useState<"set" | "change" | "remove" | null>(null);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [remTime, setRemTime] = useState("21:00");

  const reset = () => {
    setMode(null);
    setCur("");
    setNext("");
    setAgain("");
  };

  const savePass = async () => {
    if (mode !== "remove") {
      if (next.length < 4) return setMsg({ text: "Use at least 4 characters.", error: true });
      if (next !== again) return setMsg({ text: "The two passcodes don't match.", error: true });
    }
    try {
      await actions.setJournalPasscode(cur, mode === "remove" ? "" : next);
      setMsg({
        text:
          mode === "remove"
            ? "Passcode removed. The journal no longer locks."
            : mode === "set"
              ? "Passcode set. The journal locks when myPA starts and after the time below."
              : "Passcode changed.",
      });
      reset();
    } catch (e) {
      setMsg({ text: captureError(e), error: true });
    }
  };

  const reminder = snapshot.reminders.find((r) => r.title === JOURNAL_REMINDER && !r.doneAt && r.repeat);
  const addReminder = () => {
    const [h, m] = remTime.split(":").map(Number) as [number, number];
    const due = new Date();
    due.setHours(h, m, 0, 0);
    if (due.getTime() <= Date.now()) due.setDate(due.getDate() + 1);
    void actions
      .createReminder({ title: JOURNAL_REMINDER, dueAt: due.getTime(), repeat: { unit: "day", every: 1 } })
      .catch((e) => setMsg({ text: captureError(e), error: true }));
  };

  const field = (label: string, value: string, onChange: (v: string) => void, autoFocus = false) => (
    <input
      type="password"
      className="wsettings__input"
      placeholder={label}
      aria-label={label}
      autoFocus={autoFocus}
      autoComplete="new-password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") void savePass();
        if (e.key === "Escape") reset();
      }}
    />
  );

  return (
    <>
      <label className="wsettings__toggle">
        <input type="checkbox" checked={s.prompts} onChange={(e) => set({ prompts: e.target.checked })} />
        <span>
          Writing prompts
          <small>A question to start from on days you haven't written yet.</small>
        </span>
      </label>
      <label className="wsettings__toggle">
        <input type="checkbox" checked={s.onThisDay} onChange={(e) => set({ onThisDay: e.target.checked })} />
        <span>
          On this day
          <small>Show what you wrote a week, a month and a year ago.</small>
        </span>
      </label>

      <div className="wsettings__field">
        <span className="wsettings__label">Daily reminder</span>
        {reminder ? (
          <>
            <small className="wsettings__hint">
              Every day at{" "}
              {new Date(reminder.dueAt ?? Date.now()).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              . Change or remove it in Reminders.
            </small>
            <button type="button" className="wsettings__link" onClick={() => void actions.deleteReminders([reminder.id])}>
              Turn off the reminder
            </button>
          </>
        ) : (
          <div className="wsettings__row">
            <input
              type="time"
              className="wsettings__input"
              aria-label="Reminder time"
              value={remTime}
              onChange={(e) => setRemTime(e.target.value || "21:00")}
            />
            <button type="button" className="jset__btn" onClick={addReminder}>
              Remind me daily
            </button>
          </div>
        )}
      </div>

      <p className="wsettings__section">Privacy</p>
      <small className="wsettings__hint">
        {j.encrypted
          ? "Entries are encrypted on this computer with your Windows sign-in, so a copy of the database can't be read elsewhere."
          : "This computer has no keychain, so entries are stored without encryption."}{" "}
        The Assistant can't read the journal unless you allow it in Assistant settings.
      </small>

      {j.locked ? (
        <small className="wsettings__hint">Unlock the journal to change its passcode or export it.</small>
      ) : (
        <>
          <div className="wsettings__field">
            <span className="wsettings__label">Passcode</span>
            {mode === null ? (
              j.hasPasscode ? (
                <div className="wsettings__row">
                  <button type="button" className="jset__btn" onClick={() => setMode("change")}>
                    Change
                  </button>
                  <button type="button" className="jset__btn" onClick={() => setMode("remove")}>
                    Remove
                  </button>
                  <button type="button" className="jset__btn" onClick={() => void actions.lockJournal()}>
                    Lock now
                  </button>
                </div>
              ) : (
                <>
                  <small className="wsettings__hint">Hide the journal behind a passcode, even while myPA is open.</small>
                  <button type="button" className="jset__btn" onClick={() => setMode("set")}>
                    Set a passcode
                  </button>
                </>
              )
            ) : (
              <div className="jset__pass">
                {mode !== "set" && field("Current passcode", cur, setCur, true)}
                {mode !== "remove" && field("New passcode", next, setNext, mode === "set")}
                {mode !== "remove" && field("New passcode again", again, setAgain)}
                {mode === "set" && (
                  <small className="wsettings__hint">
                    If you forget it, confirm it's you with Windows Hello (or Touch ID on a Mac) to remove it. Your entries are
                    kept.
                  </small>
                )}
                <div className="wsettings__row">
                  <button type="button" className="jset__btn" onClick={reset}>
                    Cancel
                  </button>
                  <button type="button" className="jset__btn jset__btn--primary" onClick={() => void savePass()}>
                    {mode === "remove" ? "Remove passcode" : "Save passcode"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {j.hasPasscode && (
            <div className="wsettings__field">
              <label className="wsettings__label" htmlFor="journal-lock-after">
                Lock again when unused
              </label>
              <select
                id="journal-lock-after"
                className="wsettings__input"
                value={s.lockAfter}
                onChange={(e) => set({ lockAfter: Number(e.target.value) })}
              >
                {LOCK_AFTER_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {lockLabel(m)}
                  </option>
                ))}
              </select>
              <small className="wsettings__hint">It also locks when your computer locks or sleeps.</small>
            </div>
          )}

          <div className="wsettings__field">
            <span className="wsettings__label">Your entries</span>
            <button
              type="button"
              className="jset__btn"
              onClick={() =>
                void window.mypa.db
                  .exportJournal()
                  .then((ok) => ok && setMsg({ text: "Exported." }))
                  .catch((e) => setMsg({ text: captureError(e), error: true }))
              }
            >
              Export as Markdown
            </button>
          </div>
        </>
      )}

      {msg && (
        <small className="wsettings__hint" role="status" style={msg.error ? { color: "var(--ds-danger)" } : undefined}>
          {msg.text}
        </small>
      )}
    </>
  );
}
