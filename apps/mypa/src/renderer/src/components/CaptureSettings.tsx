import { useEffect, useState } from "react";

import { DEFAULT_CAPTURE_SETTINGS, hotkeyLabel } from "../../../shared/capture";
import { useReadyStore } from "../lib/store";

const IS_MAC = navigator.platform.toLowerCase().includes("mac");

const NAMED: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

/** A key press → an Electron accelerator, or why it can't be one. */
function toAccelerator(e: KeyboardEvent): { acc: string } | { hint: string } | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null; // still holding modifiers
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) key = e.code;
  else if (NAMED[e.code]) key = NAMED[e.code]!;
  if (!key) return { hint: "That key can't be used. Try a letter, number or Space." };
  const mods: string[] = [];
  if (e.ctrlKey || (IS_MAC && e.metaKey)) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (!IS_MAC && e.metaKey) mods.push("Super");
  const fkey = /^F\d+$/.test(key);
  if (!fkey && !mods.some((m) => m !== "Shift")) {
    return { hint: "Hold Ctrl or Alt too, so it doesn't fire while you type." };
  }
  return { acc: [...mods, key].join("+") };
}

export function CaptureSettingsForm() {
  const { snapshot, actions } = useReadyStore();
  const s = snapshot.meta.capture;
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [status, setStatus] = useState<{ active: boolean; error: string | null } | null>(null);

  useEffect(() => {
    void window.mypa.db.captureHotkeyStatus().then(setStatus);
  }, [s.hotkey, s.hotkeyOn]);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false);
        setHint(null);
        return;
      }
      const r = toAccelerator(e);
      if (!r) return;
      if ("hint" in r) {
        setHint(r.hint);
        return;
      }
      setRecording(false);
      setHint(null);
      void actions.setCaptureSettings({ hotkey: r.acc, hotkeyOn: true });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, actions]);

  return (
    <>
      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={s.hotkeyOn}
          onChange={(e) => void actions.setCaptureSettings({ hotkeyOn: e.target.checked })}
        />
        <span>
          Open a capture box from anywhere
          <small>Works over any app, even when myPA is in the tray.</small>
        </span>
      </label>

      {s.hotkeyOn && (
        <div className="wsettings__field">
          <span className="wsettings__label">Shortcut</span>
          <div className="wsettings__row">
            <button
              type="button"
              className="wsettings__input capset__record"
              aria-live="polite"
              onClick={() => {
                setRecording((v) => !v);
                setHint(null);
              }}
            >
              {recording ? "Press the keys…" : <kbd>{hotkeyLabel(s.hotkey, IS_MAC)}</kbd>}
            </button>
            {s.hotkey !== DEFAULT_CAPTURE_SETTINGS.hotkey && !recording && (
              <button
                type="button"
                className="wsettings__link"
                onClick={() => void actions.setCaptureSettings({ hotkey: DEFAULT_CAPTURE_SETTINGS.hotkey })}
              >
                Reset
              </button>
            )}
          </div>
          <small className={`wsettings__hint${hint || status?.error ? " is-error" : ""}`}>
            {recording
              ? (hint ?? "Press the new shortcut, or Esc to keep the current one.")
              : status?.error
                ? status.error
                : "Click to change it. Also in the tray menu as “Quick capture”."}
          </small>
        </div>
      )}

      <div className="wsettings__field">
        <label className="wsettings__label" htmlFor="cap-section">
          New tasks go to
        </label>
        <select
          id="cap-section"
          className="wsettings__input"
          value={s.taskSection}
          onChange={(e) => void actions.setCaptureSettings({ taskSection: e.target.value as "today" | "backlog" })}
        >
          <option value="today">To-do › Today</option>
          <option value="backlog">To-do › Backlog</option>
        </select>
      </div>

      <div className="wsettings__field">
        <span className="wsettings__label">How it decides</span>
        <small className="wsettings__hint capset__rules">
          “Remind me…” or a time → reminder · a meeting word plus a time → event · an amount → expense · starts with
          something to do → task · anything else → note. Start with <kbd>t:</kbd> <kbd>r:</kbd> <kbd>e:</kbd>{" "}
          <kbd>x:</kbd> or <kbd>n:</kbd> to choose yourself, or press Alt+1…5 in the box.
        </small>
      </div>
    </>
  );
}
