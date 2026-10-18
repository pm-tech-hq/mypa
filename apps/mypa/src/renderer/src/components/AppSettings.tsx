import { useEffect, useId, useState, type ReactNode } from "react";

import type { AppPrefs, SystemState, UpdateStatus } from "../../../shared/system";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Switch } from "./ui/switch";
import "../styles/settings.css";

/** Live app state (prefs + update progress), kept in sync with the main process. */
export function useSystemState(): SystemState | null {
  const [state, setState] = useState<SystemState | null>(null);
  useEffect(() => {
    void window.mypa.system.getState().then(setState);
    return window.mypa.system.onStateChanged(setState);
  }, []);
  return state;
}

/** App-wide settings: startup, window, notifications and updates. */
export function AppSettings({
  open,
  onOpenChange,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: SystemState | null;
}) {
  const [tested, setTested] = useState<"sent" | "off" | null>(null);
  const system = window.mypa.system;

  useEffect(() => {
    if (!open) setTested(null);
  }, [open]);

  if (!state) return null;
  const { prefs, packaged } = state;
  const set = (patch: Partial<AppPrefs>) => void system.setPrefs(patch);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-set sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>How myPA starts, runs and keeps itself up to date.</DialogDescription>
        </DialogHeader>

        <section className="app-set__section">
          <h3>Startup</h3>
          <Toggle
            label="Open when I sign in"
            hint={
              packaged
                ? "myPA starts with your computer."
                : "Works in the installed app. This is a development build."
            }
            checked={prefs.openAtLogin}
            disabled={!packaged}
            onChange={(v) => set({ openAtLogin: v })}
          />
          <Toggle
            label="Start in the background"
            hint="At sign-in, wait in the tray instead of opening the window."
            checked={prefs.startHidden}
            disabled={!packaged || !prefs.openAtLogin}
            onChange={(v) => set({ startHidden: v })}
          />
        </section>

        <section className="app-set__section">
          <h3>Window</h3>
          <Toggle
            label="Keep running when closed"
            hint="Closing the window leaves myPA in the tray, so timers and reminders keep going. Quit from the tray icon."
            checked={prefs.closeToTray}
            onChange={(v) => set({ closeToTray: v })}
          />
        </section>

        <section className="app-set__section">
          <h3>Notifications</h3>
          <Toggle
            label="Allow notifications"
            hint={
              state.notificationsSupported
                ? "Widgets with permission can alert you, and myPA tells you when an update is ready."
                : "This system doesn't support desktop notifications."
            }
            checked={prefs.notifications}
            disabled={!state.notificationsSupported}
            onChange={(v) => set({ notifications: v })}
          />
          <div className="app-set__row">
            <button
              type="button"
              className="app-set__button"
              disabled={!prefs.notifications || !state.notificationsSupported}
              onClick={() =>
                void system.testNotification().then((ok) => setTested(ok ? "sent" : "off"))
              }
            >
              Send a test
            </button>
            {tested === "sent" && (
              <span className="app-set__note">
                Sent. If nothing appeared, check Windows notification settings and Do Not Disturb.
              </span>
            )}
            {tested === "off" && <span className="app-set__note">Notifications are off.</span>}
          </div>
        </section>

        <section className="app-set__section">
          <h3>Updates</h3>
          <Toggle
            label="Update automatically"
            hint="Download new versions in the background and install them when myPA restarts."
            checked={prefs.autoUpdate}
            disabled={!packaged}
            onChange={(v) => set({ autoUpdate: v })}
          />
          <UpdateRow state={state} />
        </section>
      </DialogContent>
    </Dialog>
  );
}

function UpdateRow({ state }: { state: SystemState }) {
  const system = window.mypa.system;
  const update = state.update;
  const busy = update.state === "checking" || update.state === "downloading";

  let action: ReactNode = null;
  if (update.state === "ready") {
    action = (
      <button
        type="button"
        className="app-set__button is-primary"
        onClick={() => system.installUpdate()}
      >
        Restart to update
      </button>
    );
  } else if (state.packaged) {
    action = (
      <button
        type="button"
        className="app-set__button"
        disabled={busy}
        onClick={() => void system.checkForUpdates()}
      >
        Check now
      </button>
    );
  }

  return (
    <div className="app-set__update">
      <div className="app-set__update-text">
        <strong>myPA {state.version}</strong>
        <span role="status" aria-live="polite">
          {describeUpdate(update)}
        </span>
        {update.state === "downloading" && (
          <span className="app-set__progress" aria-hidden>
            <span style={{ transform: `scaleX(${update.percent / 100})` }} />
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

function describeUpdate(update: UpdateStatus): string {
  switch (update.state) {
    case "unsupported":
      return update.reason;
    case "idle":
      return "Not checked yet.";
    case "checking":
      return "Checking for updates…";
    case "none":
      return `Up to date. Checked at ${new Date(update.checkedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}.`;
    case "available":
      return `Version ${update.version} is available.`;
    case "downloading":
      return `Downloading ${update.version}… ${update.percent}%`;
    case "ready":
      return `Version ${update.version} is ready. It installs on restart.`;
    case "error":
      return update.message;
  }
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className={`app-set__toggle${disabled ? " is-disabled" : ""}`}>
      <label htmlFor={id}>
        <strong>{label}</strong>
        <em>{hint}</em>
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
