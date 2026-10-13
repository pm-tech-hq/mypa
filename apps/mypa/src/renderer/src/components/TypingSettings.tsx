import { useEffect, useState } from "react";

import { DEFAULT_TYPING_PREFS, type TypingPrefs, type WidgetRow } from "../../../shared/types";
import { useReadyStore } from "../lib/store";

/** The Typing widget's section of the widget settings panel. */
export function TypingSettingsForm({ widget }: { widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const p: TypingPrefs = { ...DEFAULT_TYPING_PREFS, ...widget.settings.typingPrefs };
  const [confirmReset, setConfirmReset] = useState(false);

  // The reset button asks twice; the second ask expires.
  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmReset]);

  const set = (patch: Partial<TypingPrefs>) =>
    void actions.updateWidgetSettings(widget.id, {
      typingPrefs: { ...widget.settings.typingPrefs, ...patch },
    });

  const chips = <K extends keyof TypingPrefs>(key: K, options: [TypingPrefs[K], string][]) => (
    <div className="wsettings__chips">
      {options.map(([value, label]) => (
        <button
          key={String(value)}
          type="button"
          aria-pressed={p[key] === value}
          className={`chip${p[key] === value ? " chip--on" : ""}`}
          onClick={() => set({ [key]: value } as Partial<TypingPrefs>)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const toggle = (key: keyof TypingPrefs, label: string, hint?: string) => (
    <label className="wsettings__toggle">
      <input
        type="checkbox"
        checked={Boolean(p[key])}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<TypingPrefs>)}
      />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );

  const reset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    void actions.updateWidgetSettings(widget.id, {
      typingCards: {},
      typingDays: {},
      typingKeys: {},
      typingBestWpm: 0,
      typingSprintBest: {},
    });
  };

  return (
    <>
      <p className="wsettings__section">Practice</p>

      <div className="wsettings__field">
        <span className="wsettings__label">Passages per round</span>
        {chips("roundSize", [
          [3, "3"],
          [5, "5"],
          [8, "8"],
          [10, "10"],
        ])}
      </div>

      <div className="wsettings__field">
        <span className="wsettings__label">Passage length</span>
        {chips("length", [
          ["short", "Short"],
          ["medium", "Medium"],
          ["long", "Long"],
        ])}
        <span className="wsettings__hint">
          Changing this re-splits your text, so passages start fresh. Your stats stay.
        </span>
      </div>

      <div className="wsettings__field">
        <span className="wsettings__label">Hidden words in Fill the gaps</span>
        {chips("gapDensity", [
          ["few", "A few"],
          ["some", "Some"],
          ["many", "Many"],
        ])}
      </div>

      <div className="wsettings__field">
        <span className="wsettings__label">Daily goal</span>
        {chips("dailyGoalMin", [
          [0, "Off"],
          [5, "5 min"],
          [10, "10 min"],
          [15, "15 min"],
          [30, "30 min"],
        ])}
      </div>

      {toggle(
        "skipCopy",
        "Skip the copy step",
        "New passages start at Fill the gaps. Faster learning, less speed practice.",
      )}

      <p className="wsettings__section">Strictness</p>
      {toggle(
        "stopOnError",
        "Stop on mistakes",
        "A wrong key isn't taken until you type the right one.",
      )}
      {toggle("ignoreCase", "Ignore capital letters")}
      {toggle(
        "ignorePunctuation",
        "Leave out punctuation",
        "Type only letters, numbers and spaces.",
      )}

      <p className="wsettings__section">Display</p>
      <div className="wsettings__field">
        <span className="wsettings__label">Text size</span>
        {chips("fontSize", [
          ["s", "Small"],
          ["m", "Medium"],
          ["l", "Large"],
        ])}
      </div>
      {toggle("showLive", "Show speed and accuracy while typing")}
      {toggle("sounds", "Key sounds", "A soft tick per key and a low buzz on a mistake.")}

      <p className="wsettings__section">Progress</p>
      <div className="wsettings__field">
        <button
          type="button"
          className={`wsettings__danger${confirmReset ? " is-armed" : ""}`}
          onClick={reset}
        >
          {confirmReset ? "Click again to reset everything" : "Reset progress"}
        </button>
        <span className="wsettings__hint">
          Clears what you've learned, your streak, bests and missed keys. Your transcripts and notes
          aren't touched.
        </span>
      </div>
    </>
  );
}
