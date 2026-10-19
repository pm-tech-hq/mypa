import { useEffect, useState } from "react";

import {
  DEFAULT_FLASHCARDS_PREFS,
  type Flashcard,
  type FlashcardsPrefs,
  type WidgetRow,
} from "../../../shared/types";
import { forget } from "../lib/flashcards";
import { useReadyStore } from "../lib/store";

/** The Flashcards widget's section of the widget settings panel. */
export function FlashcardsSettingsForm({ widget }: { widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const p: FlashcardsPrefs = {
    ...DEFAULT_FLASHCARDS_PREFS,
    ...widget.settings.flashPrefs,
  };
  const [armed, setArmed] = useState<"reset" | "delete" | null>(null);

  // The danger buttons ask twice; the second ask expires.
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(null), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const set = (patch: Partial<FlashcardsPrefs>) =>
    void actions.updateWidgetSettings(widget.id, {
      flashPrefs: { ...widget.settings.flashPrefs, ...patch },
    });

  const chips = <K extends keyof FlashcardsPrefs>(
    key: K,
    options: [FlashcardsPrefs[K], string][],
  ) => (
    <div className="wsettings__chips">
      {options.map(([value, label]) => (
        <button
          key={String(value)}
          type="button"
          aria-pressed={p[key] === value}
          className={`chip${p[key] === value ? " chip--on" : ""}`}
          onClick={() => set({ [key]: value } as Partial<FlashcardsPrefs>)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const toggle = (key: keyof FlashcardsPrefs, label: string, hint?: string) => (
    <label className="wsettings__toggle">
      <input
        type="checkbox"
        checked={Boolean(p[key])}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<FlashcardsPrefs>)}
      />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );

  const danger = (which: "reset" | "delete") => {
    if (armed !== which) {
      setArmed(which);
      return;
    }
    setArmed(null);
    const cards = widget.settings.flashCards ?? {};
    if (which === "delete") {
      void actions.updateWidgetSettings(widget.id, {
        flashCards: {},
        flashDays: {},
        flashMade: {},
      });
      return;
    }
    const now = Date.now();
    const fresh: Record<string, Flashcard> = {};
    for (const [id, c] of Object.entries(cards))
      fresh[id] = { ...forget(c, now), suspended: c.suspended };
    void actions.updateWidgetSettings(widget.id, {
      flashCards: fresh,
      flashDays: {},
    });
  };

  return (
    <>
      <p className="wsettings__section">Daily study</p>

      <div className="wsettings__field">
        <span className="wsettings__label">New cards per day</span>
        {chips("newPerDay", [
          [5, "5"],
          [10, "10"],
          [15, "15"],
          [25, "25"],
          [40, "40"],
        ])}
        <span className="wsettings__hint">
          Every new card brings a handful of reviews over the following weeks, so start small.
        </span>
      </div>

      <div className="wsettings__field">
        <span className="wsettings__label">Most reviews per day</span>
        {chips("maxReviews", [
          [50, "50"],
          [100, "100"],
          [200, "200"],
          [0, "No limit"],
        ])}
      </div>

      <div className="wsettings__field">
        <span className="wsettings__label">How much to remember</span>
        {chips("retention", [
          [0.85, "85%"],
          [0.9, "90%"],
          [0.95, "95%"],
        ])}
        <span className="wsettings__hint">
          The chance you still know a card when it comes back. Higher means more reviews; 90% is a
          good balance.
        </span>
      </div>

      <p className="wsettings__section">Questions</p>
      <div className="wsettings__field">
        <span className="wsettings__label">How to ask</span>
        {chips("mode", [
          ["mixed", "Mixed"],
          ["choice", "Multiple choice"],
          ["type", "Type it"],
          ["flip", "Flip"],
        ])}
        <span className="wsettings__hint">
          Mixed starts new cards as multiple choice, then asks you to type or recall the answer as
          you get to know it. Recalling is what makes it stick.
        </span>
      </div>
      {toggle(
        "showQuote",
        "Show where the answer comes from",
        "The words from your transcript or note.",
      )}
      {toggle("readAloud", "Read questions aloud")}
      {toggle(
        "aiCheck",
        "Let the AI check typed answers",
        "When your words differ from the card, the AI judges the meaning. Uses the AI picked below the deck list.",
      )}

      <p className="wsettings__section">Progress</p>
      <div className="wsettings__field">
        <button
          type="button"
          className={`wsettings__danger${armed === "reset" ? " is-armed" : ""}`}
          onClick={() => danger("reset")}
        >
          {armed === "reset" ? "Click again to reset progress" : "Reset progress"}
        </button>
        <span className="wsettings__hint">
          Every card becomes new again and your history is cleared. The cards stay.
        </span>
      </div>
      <div className="wsettings__field">
        <button
          type="button"
          className={`wsettings__danger${armed === "delete" ? " is-armed" : ""}`}
          onClick={() => danger("delete")}
        >
          {armed === "delete" ? "Click again to delete every card" : "Delete all cards"}
        </button>
        <span className="wsettings__hint">Your transcripts and notes aren&apos;t touched.</span>
      </div>
    </>
  );
}
