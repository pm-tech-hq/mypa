import { useEffect, useState } from "react";

import { ZOHO_REGIONS, type EmailAccount } from "../../../shared/email";
import type { CalendarAccountRow, CalendarProvider } from "../../../shared/types";
import { accountColor } from "../lib/calendar";
import { useReadyStore } from "../lib/store";
import { errorText } from "../lib/tutor";
import "../styles/calendar.css";

const PROVIDER_LABEL: Record<CalendarProvider, string> = {
  google: "Google",
  zoho: "Zoho",
  caldav: "CalDAV",
  outlook: "Outlook",
  ics: "ICS feed",
};

const REMINDERS: [number, string][] = [
  [-1, "Off"],
  [0, "When it starts"],
  [1, "1 minute before"],
  [5, "5 minutes before"],
  [10, "10 minutes before"],
  [15, "15 minutes before"],
  [30, "30 minutes before"],
  [60, "1 hour before"],
];

type Form = "google" | "zoho" | "caldav" | "outlook" | "ics";

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
  const accounts = snapshot.calendarAccounts;
  const [openForm, setOpenForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const toggle = (form: Form) => setOpenForm((cur) => (cur === form ? null : form));
  const work = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <label className="wsettings__field">
        <span className="wsettings__label">Meeting reminders</span>
        <select
          className="wsettings__input"
          value={snapshot.meta.calendarReminder}
          onChange={(e) => void actions.setCalendarReminder(Number(e.target.value))}
        >
          {REMINDERS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <span className="wsettings__hint">
          A desktop notification for timed events. Turn it off per account below.
        </span>
      </label>

      <div className="wsettings__field">
        <span className="wsettings__label">Connected calendars</span>
        <p className="wsettings__hint">
          Add as many Google and Zoho accounts as you like. Their meetings show together, and you
          can add, change and answer them from here.
        </p>

        {accounts.length > 0 && (
          <ul className="cal-accounts">
            {accounts.map((a) => (
              <li key={a.id} className="cal-accounts__row cal-acc">
                <div className="cal-acc__top">
                  <span
                    className="cal-acc__dot"
                    style={{ background: accountColor(accounts, a.id) }}
                    aria-hidden
                  />
                  <div className="cal-accounts__info">
                    <span className="cal-accounts__label">{a.label}</span>
                    <span
                      className={`cal-accounts__meta${a.status === "error" ? " cal-acc__error" : ""}`}
                    >
                      {PROVIDER_LABEL[a.provider]}
                      {a.accountEmail && a.accountEmail !== a.label ? ` · ${a.accountEmail}` : ""} ·{" "}
                      {a.status === "connecting"
                        ? "connecting…"
                        : a.status === "error"
                          ? (a.errorMessage ?? "error")
                          : formatSynced(a.lastSyncedAt)}
                    </span>
                  </div>
                  <div className="cal-accounts__actions">
                    {(a.status === "error" ||
                      (a.provider === "google" && !a.canWrite)) &&
                      a.provider !== "ics" && (
                        <button
                          type="button"
                          className="chip"
                          disabled={busy === a.id}
                          title={
                            a.status === "error"
                              ? undefined
                              : "Sign in again so myPA can add and change events"
                          }
                          onClick={() => void work(a.id, () => actions.reconnectCalendarAccount(a.id))}
                        >
                          {a.status === "error" ? "Reconnect" : "Allow changes"}
                        </button>
                      )}
                    {a.status === "connected" && (
                      <button
                        type="button"
                        className="chip"
                        disabled={busy === a.id}
                        onClick={() => void work(a.id, () => actions.syncCalendarAccount(a.id))}
                      >
                        {busy === a.id ? "Syncing…" : "Sync"}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`chip${editing === a.id ? " chip--on" : ""}`}
                      onClick={() => setEditing((cur) => (cur === a.id ? null : a.id))}
                    >
                      Edit
                    </button>
                  </div>
                </div>
                {editing === a.id && (
                  <AccountEditor
                    key={a.id}
                    account={a}
                    onDone={() => setEditing(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="cal-accounts__add">
          <button
            type="button"
            className={`chip${openForm === "google" ? " chip--on" : ""}`}
            onClick={() => toggle("google")}
          >
            + Google
          </button>
          <button
            type="button"
            className={`chip${openForm === "zoho" ? " chip--on" : ""}`}
            onClick={() => toggle("zoho")}
          >
            + Zoho
          </button>
          <button
            type="button"
            className={`chip${openForm === "caldav" ? " chip--on" : ""}`}
            onClick={() => toggle("caldav")}
          >
            + Other (iCloud, Fastmail…)
          </button>
          {more ? (
            <>
              <button
                type="button"
                className={`chip${openForm === "outlook" ? " chip--on" : ""}`}
                onClick={() => toggle("outlook")}
              >
                + Outlook
              </button>
              <button
                type="button"
                className={`chip${openForm === "ics" ? " chip--on" : ""}`}
                onClick={() => toggle("ics")}
              >
                + ICS feed
              </button>
            </>
          ) : (
            <button type="button" className="chip" onClick={() => setMore(true)}>
              More…
            </button>
          )}
        </div>

        {openForm === "google" && <GoogleForm key="google" onDone={() => setOpenForm(null)} />}
        {openForm === "zoho" && <ZohoForm key="zoho" onDone={() => setOpenForm(null)} />}
        {openForm === "caldav" && <CaldavForm key="caldav" onDone={() => setOpenForm(null)} />}
        {openForm === "outlook" && (
          <OutlookForm
            busy={busy === "outlook"}
            onSubmit={async (label, clientId) => {
              await work("outlook", () => actions.addOutlookCalendar({ label, clientId }));
              setOpenForm(null);
            }}
          />
        )}
        {openForm === "ics" && (
          <IcsForm
            busy={busy === "ics"}
            onSubmit={async (label, feedUrl) => {
              await work("ics", () => actions.addIcsCalendar({ label, feedUrl }));
              setOpenForm(null);
            }}
          />
        )}
      </div>
    </>
  );
}

function AccountEditor({ account, onDone }: { account: CalendarAccountRow; onDone: () => void }) {
  const { actions } = useReadyStore();
  const [label, setLabel] = useState(account.label);
  const [notify, setNotify] = useState(account.notify);
  const [hidden, setHidden] = useState(
    () => new Set(account.calendars.filter((c) => c.hidden).map((c) => c.id)),
  );
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await actions.updateCalendarAccount(account.id, {
        label,
        notify,
        ...(account.calendars.length ? { hiddenCalendars: [...hidden] } : {}),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cal-accounts__form cal-acc__edit">
      <input
        className="wsettings__input"
        aria-label="Name"
        placeholder="Name, e.g. Work"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      {account.calendars.length > 1 && (
        <fieldset className="cal-acc__cals">
          <legend>Show these calendars</legend>
          {account.calendars.map((c) => (
            <label key={c.id} className="wsettings__toggle">
              <input
                type="checkbox"
                checked={!hidden.has(c.id)}
                onChange={(e) =>
                  setHidden((cur) => {
                    const next = new Set(cur);
                    if (e.target.checked) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  })
                }
              />
              <span className="cal-acc__cal">
                <span
                  className="cal-acc__dot"
                  style={{ background: c.color ?? "var(--ds-faint)" }}
                  aria-hidden
                />
                {c.name}
                {!c.writable && <small>read-only</small>}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="wsettings__toggle">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <span>
          Remind me before these meetings
          <small>Uses the reminder time above and the app's notification setting</small>
        </span>
      </label>
      <div className="cal-acc__actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        {confirmRemove ? (
          <>
            <span className="cal-acc__confirm">Remove {account.label} from myPA?</span>
            <button
              type="button"
              className="chip cal-acc__danger"
              onClick={() => void actions.removeCalendarAccount(account.id)}
            >
              Remove
            </button>
            <button type="button" className="chip" onClick={() => setConfirmRemove(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="chip" onClick={() => setConfirmRemove(true)}>
            Remove account
          </button>
        )}
      </div>
      <p className="wsettings__hint">Removing it here doesn't delete any events.</p>
    </div>
  );
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="cal-acc__error" role="alert">
      {error}
    </p>
  ) : null;
}

function GoogleForm({ onDone }: { onDone: () => void }) {
  const { snapshot, actions } = useReadyStore();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [own, setOwn] = useState(false);
  const signIn = snapshot.meta.googleSignIn;

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.addGoogleCalendar({ label: label.trim() || "Google Calendar" });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!signIn || own) return <GoogleClientForm onSaved={() => setOwn(false)} />;

  return (
    <div className="cal-accounts__form">
      <p className="wsettings__hint">
        Your browser opens so you can pick the Google account and allow myPA to see and change
        its calendars. Do this once per account.
      </p>
      <input
        className="wsettings__input"
        placeholder="Name, e.g. Work (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button type="button" className="btn" disabled={busy} onClick={() => void connect()}>
        {busy ? "Waiting for Google…" : "Sign in with Google"}
      </button>
      <FormError error={error} />
      {signIn === "custom" && (
        <button type="button" className="cal__link cal-acc__small" onClick={() => setOwn(true)}>
          Change the Google client
        </button>
      )}
    </div>
  );
}

/** One-time setup for copies of myPA built without a Google client. */
function GoogleClientForm({ onSaved }: { onSaved: () => void }) {
  const { snapshot, actions } = useReadyStore();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="cal-accounts__form">
      <p className="wsettings__hint">
        <strong>One-time setup.</strong> Google needs an app ID before anyone can sign in. In{" "}
        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
          Google Cloud Console
        </a>
        : turn on the Google Calendar API, set up the consent screen (publish it so sign-ins don't
        expire after a week), then create an OAuth client of type <strong>Desktop app</strong>.
        Paste its ID and secret here. Every Google account you add afterwards is one click.
      </p>
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
      <div className="cal-acc__actions">
        <button
          type="button"
          className="btn"
          disabled={busy || !clientId.trim() || !clientSecret.trim()}
          onClick={async () => {
            setBusy(true);
            await actions.setGoogleClient({ clientId, clientSecret });
            setBusy(false);
            onSaved();
          }}
        >
          Save
        </button>
        {snapshot.meta.googleSignIn === "custom" && (
          <button type="button" className="chip" onClick={onSaved}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function ZohoForm({ onDone }: { onDone: () => void }) {
  const { actions } = useReadyStore();
  const [mailboxes, setMailboxes] = useState<EmailAccount[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState("com");
  const [label, setLabel] = useState("");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [askUrl, setAskUrl] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.mypa.email.accounts().then((list) => {
      if (live) setMailboxes(list.filter((a) => a.provider === "zoho"));
    });
    return () => {
      live = false;
    };
  }, []);

  const add = async (key: string, input: Parameters<typeof actions.addZohoCalendar>[0]) => {
    setBusy(key);
    setError(null);
    try {
      await actions.addZohoCalendar(input);
      onDone();
    } catch (err) {
      const message = errorText(err);
      setError(message);
      if (/CalDAV URL/.test(message)) setAskUrl(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cal-accounts__form">
      {mailboxes.length > 0 && (
        <>
          <p className="wsettings__hint">Use a Zoho mailbox you already connected in Email:</p>
          <div className="cal-acc__actions">
            {mailboxes.map((m) => (
              <button
                key={m.id}
                type="button"
                className="chip"
                disabled={busy !== null}
                onClick={() => void add(m.id, { emailAccountId: m.id, label: m.label })}
              >
                {busy === m.id ? "Connecting…" : m.address}
              </button>
            ))}
          </div>
          <p className="wsettings__hint">Or sign in to another one:</p>
        </>
      )}
      {mailboxes.length === 0 && (
        <p className="wsettings__hint">
          Use your Zoho address and an <strong>app password</strong> from{" "}
          <a
            href="https://accounts.zoho.com/home#security/app_password"
            target="_blank"
            rel="noreferrer"
          >
            Zoho Accounts → Security → App passwords
          </a>
          . The one you made for Email works too.
        </p>
      )}
      <input
        className="wsettings__input"
        type="email"
        placeholder="you@yourdomain.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="wsettings__input"
        type="password"
        autoComplete="new-password"
        placeholder="App password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <select
        className="wsettings__input"
        aria-label="Zoho region"
        value={region}
        onChange={(e) => setRegion(e.target.value)}
      >
        {Object.entries(ZOHO_REGIONS).map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <input
        className="wsettings__input"
        placeholder="Name, e.g. Work (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      {askUrl && (
        <input
          className="wsettings__input"
          placeholder="CalDAV URL from Zoho Calendar settings"
          value={calendarUrl}
          onChange={(e) => setCalendarUrl(e.target.value)}
        />
      )}
      <button
        type="button"
        className="btn"
        disabled={busy !== null || !email.trim() || !password.trim()}
        onClick={() =>
          void add("form", {
            email,
            password,
            region,
            label,
            ...(calendarUrl.trim() ? { calendarUrl } : {}),
          })
        }
      >
        {busy === "form" ? "Connecting…" : "Connect Zoho Calendar"}
      </button>
      <FormError error={error} />
    </div>
  );
}

function CaldavForm({ onDone }: { onDone: () => void }) {
  const { actions } = useReadyStore();
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="cal-accounts__form">
      <p className="wsettings__hint">
        Any calendar that speaks CalDAV. iCloud: <code>https://caldav.icloud.com</code> with an
        app-specific password. Fastmail: <code>https://caldav.fastmail.com</code>. Nextcloud:
        your server's address.
      </p>
      <input
        className="wsettings__input"
        placeholder="Server address"
        value={serverUrl}
        onChange={(e) => setServerUrl(e.target.value)}
      />
      <input
        className="wsettings__input"
        placeholder="Username or email"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className="wsettings__input"
        type="password"
        autoComplete="new-password"
        placeholder="Password or app password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        className="wsettings__input"
        placeholder="Name (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button
        type="button"
        className="btn"
        disabled={busy || !serverUrl.trim() || !username.trim() || !password.trim()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await actions.addCaldavCalendar({ serverUrl, username, password, label });
            onDone();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Connecting…" : "Connect calendar"}
      </button>
      <FormError error={error} />
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
        Read-only.
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
