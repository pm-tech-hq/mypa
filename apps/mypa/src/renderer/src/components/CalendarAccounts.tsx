import { useState } from "react";

import type { CalendarAccountRow } from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import "../styles/calendar.css";

const PROVIDER_LABEL: Record<CalendarAccountRow["provider"], string> = {
  google: "Google",
  outlook: "Outlook",
  ics: "ICS feed",
};

function formatSynced(ms: number | null): string {
  if (ms == null) return "never synced";
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return "synced just now";
  if (mins < 60) return `synced ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `synced ${hours}h ago`;
  return `synced ${Math.round(hours / 24)}d ago`;
}

export function CalendarAccounts() {
  const { snapshot, actions } = useReadyStore();
  const [openForm, setOpenForm] = useState<"google" | "outlook" | "ics" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = (form: "google" | "outlook" | "ics") =>
    setOpenForm((cur) => (cur === form ? null : form));

  return (
    <div className="wsettings__field">
      <span className="wsettings__label">Connected calendars</span>

      {snapshot.calendarAccounts.length > 0 && (
        <ul className="cal-accounts">
          {snapshot.calendarAccounts.map((a) => (
            <li key={a.id} className="cal-accounts__row">
              <div className="cal-accounts__info">
                <span className="cal-accounts__label">{a.label}</span>
                <span className="cal-accounts__meta">
                  {PROVIDER_LABEL[a.provider]}
                  {a.accountEmail ? ` · ${a.accountEmail}` : ""} ·{" "}
                  {a.status === "connecting"
                    ? "connecting…"
                    : a.status === "error"
                      ? (a.errorMessage ?? "error")
                      : formatSynced(a.lastSyncedAt)}
                </span>
              </div>
              <div className="cal-accounts__actions">
                {a.status === "error" && a.provider !== "ics" && (
                  <button
                    type="button"
                    className="chip"
                    disabled={busy === a.id}
                    onClick={async () => {
                      setBusy(a.id);
                      await actions.reconnectCalendarAccount(a.id);
                      setBusy(null);
                    }}
                  >
                    Reconnect
                  </button>
                )}
                {a.status === "connected" && (
                  <button
                    type="button"
                    className="chip"
                    disabled={busy === a.id}
                    onClick={async () => {
                      setBusy(a.id);
                      await actions.syncCalendarAccount(a.id);
                      setBusy(null);
                    }}
                  >
                    Sync now
                  </button>
                )}
                <button
                  type="button"
                  className="chip"
                  onClick={() => void actions.removeCalendarAccount(a.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="cal-accounts__add">
        <button type="button" className={`chip${openForm === "google" ? " chip--on" : ""}`} onClick={() => toggle("google")}>
          + Google
        </button>
        <button type="button" className={`chip${openForm === "outlook" ? " chip--on" : ""}`} onClick={() => toggle("outlook")}>
          + Outlook
        </button>
        <button type="button" className={`chip${openForm === "ics" ? " chip--on" : ""}`} onClick={() => toggle("ics")}>
          + ICS feed
        </button>
      </div>

      {openForm === "google" && (
        <GoogleForm
          busy={busy === "google"}
          onSubmit={async (label, clientId, clientSecret) => {
            setBusy("google");
            await actions.addGoogleCalendar({ label, clientId, clientSecret });
            setBusy(null);
            setOpenForm(null);
          }}
        />
      )}
      {openForm === "outlook" && (
        <OutlookForm
          busy={busy === "outlook"}
          onSubmit={async (label, clientId) => {
            setBusy("outlook");
            await actions.addOutlookCalendar({ label, clientId });
            setBusy(null);
            setOpenForm(null);
          }}
        />
      )}
      {openForm === "ics" && (
        <IcsForm
          busy={busy === "ics"}
          onSubmit={async (label, feedUrl) => {
            setBusy("ics");
            await actions.addIcsCalendar({ label, feedUrl });
            setBusy(null);
            setOpenForm(null);
          }}
        />
      )}
    </div>
  );
}

function GoogleForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (label: string, clientId: string, clientSecret: string) => void;
}) {
  const [label, setLabel] = useState("Google Calendar");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  return (
    <div className="cal-accounts__form">
      <p className="wsettings__hint">
        Create a <strong>Desktop app</strong> OAuth client at{" "}
        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
          console.cloud.google.com/apis/credentials
        </a>{" "}
        and paste both values it gives you. A browser window will open to sign in.
      </p>
      <input
        className="wsettings__input"
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className="wsettings__input"
        placeholder="Client ID"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
      />
      <input
        className="wsettings__input"
        placeholder="Client secret"
        type="password"
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
      />
      <button
        type="button"
        className="btn"
        disabled={busy || !clientId.trim() || !clientSecret.trim()}
        onClick={() => onSubmit(label.trim() || "Google Calendar", clientId.trim(), clientSecret.trim())}
      >
        {busy ? "Connecting…" : "Connect Google Calendar"}
      </button>
    </div>
  );
}

function OutlookForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (label: string, clientId: string) => void;
}) {
  const [label, setLabel] = useState("Outlook Calendar");
  const [clientId, setClientId] = useState("");

  return (
    <div className="cal-accounts__form">
      <p className="wsettings__hint">
        Register a <strong>Mobile and desktop applications</strong> app at{" "}
        <a href="https://portal.azure.com" target="_blank" rel="noreferrer">
          portal.azure.com
        </a>{" "}
        (Azure Active Directory → App registrations) and paste its Application (client) ID.
      </p>
      <input
        className="wsettings__input"
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className="wsettings__input"
        placeholder="Client ID"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
      />
      <button
        type="button"
        className="btn"
        disabled={busy || !clientId.trim()}
        onClick={() => onSubmit(label.trim() || "Outlook Calendar", clientId.trim())}
      >
        {busy ? "Connecting…" : "Connect Outlook Calendar"}
      </button>
    </div>
  );
}

function IcsForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (label: string, feedUrl: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [feedUrl, setFeedUrl] = useState("");

  return (
    <div className="cal-accounts__form">
      <p className="wsettings__hint">
        Paste any public or private .ics feed URL. Google, Outlook and Apple all have one
        in their calendar settings. Read-only.
      </p>
      <input
        className="wsettings__input"
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className="wsettings__input"
        placeholder="https://…/basic.ics"
        value={feedUrl}
        onChange={(e) => setFeedUrl(e.target.value)}
      />
      <button
        type="button"
        className="btn"
        disabled={busy || !feedUrl.trim()}
        onClick={() => onSubmit(label.trim() || "Calendar feed", feedUrl.trim())}
      >
        {busy ? "Adding…" : "Add calendar"}
      </button>
    </div>
  );
}
