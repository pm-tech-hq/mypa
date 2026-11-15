import { useEffect, useState } from "react";

import {
  ZOHO_REGIONS,
  type EmailAccount,
  type EmailProvider,
  type NewEmailAccount,
  type ZohoRegion,
} from "../../../shared/email";
import type { TutorConfig } from "../../../shared/tutor";
import type { WidgetRow } from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import { errorText } from "../lib/tutor";
import { setAccounts, syncedLabel, useEmailState } from "../lib/email";
import "../styles/calendar.css";
import "../styles/email.css";

const PROVIDER_LABEL: Record<EmailProvider, string> = {
  gmail: "Gmail",
  zoho: "Zoho Mail",
  imap: "Other (IMAP)",
};

/** The Email widget's settings: its AI, then the accounts every Email widget shares. */
export function EmailSettingsForm({ widget }: { widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const [config, setConfig] = useState<TutorConfig | null>(null);
  useEffect(() => {
    void window.mypa.tutor.getConfig().then(setConfig);
  }, []);
  return (
    <>
      <label className="wsettings__field">
        <span className="wsettings__label">AI for summaries and drafts</span>
        <select
          className="wsettings__input"
          value={widget.settings.emailAi ?? ""}
          onChange={(e) => void actions.updateWidgetSettings(widget.id, { emailAi: e.target.value })}
        >
          <option value="">Automatic</option>
          <option value="local">Built-in (offline)</option>
          {config?.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="off">Off</option>
        </select>
        <span className="wsettings__hint">
          The built-in model keeps your mail on this computer. A provider receives the emails you
          ask it about. Models are set up in the Tutor.
        </span>
      </label>
      <EmailAccounts />
    </>
  );
}

/** Connected email accounts, shared by every Email widget. */
export function EmailAccounts() {
  const { accounts } = useEmailState();
  const googleSignIn = useReadyStore().snapshot.meta.googleSignIn;
  const [adding, setAdding] = useState<EmailProvider | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (id: string, fn: () => Promise<EmailAccount[]>) => {
    setBusy(id);
    try {
      setAccounts(await fn());
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="wsettings__field">
      <span className="wsettings__label">Email accounts</span>
      <p className="wsettings__hint">
        Every Email widget shows these. Passwords and Google sign-ins are encrypted on this
        computer and only sent to your mail provider.
      </p>

      {accounts && accounts.length > 0 && (
        <ul className="cal-accounts">
          {accounts.map((a) => (
            <li key={a.id} className="cal-accounts__row email-acc">
              <div className="email-acc__top">
                <div className="cal-accounts__info">
                  <span className="cal-accounts__label">{a.label}</span>
                  <span className={`cal-accounts__meta${a.status === "error" ? " email-acc__error" : ""}`}>
                    {PROVIDER_LABEL[a.provider]}
                    {a.auth === "google" ? " (Google sign-in)" : ""} · {a.address} · {syncedLabel(a)}
                  </span>
                </div>
                <div className="cal-accounts__actions">
                  <button
                    type="button"
                    className="chip"
                    disabled={busy === a.id}
                    onClick={() => void run(a.id, () => window.mypa.email.syncAccount(a.id))}
                  >
                    {busy === a.id ? "Checking…" : "Check now"}
                  </button>
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
                  account={a}
                  busy={busy === a.id}
                  onSave={(patch) =>
                    run(a.id, () => window.mypa.email.updateAccount(a.id, patch)).then(() =>
                      setEditing(null),
                    )
                  }
                  onRemove={() => void run(a.id, () => window.mypa.email.removeAccount(a.id))}
                  onGoogle={
                    a.provider === "gmail" && googleSignIn
                      ? () => window.mypa.email.reconnectGoogle(a.id).then(setAccounts)
                      : undefined
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="cal-accounts__add">
        {(["gmail", "zoho", "imap"] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`chip${adding === p ? " chip--on" : ""}`}
            onClick={() => setAdding((cur) => (cur === p ? null : p))}
          >
            + {PROVIDER_LABEL[p]}
          </button>
        ))}
      </div>

      {adding === "gmail" ? (
        <GmailForm key="gmail" onDone={() => setAdding(null)} />
      ) : adding ? (
        <AddAccountForm key={adding} provider={adding} onDone={() => setAdding(null)} />
      ) : null}
    </div>
  );
}

/**
 * Gmail: an app password first, with Google sign-in as the other choice. App passwords lead
 * until Google verifies myPA's Gmail access; until then the sign-in shows an "unverified" warning.
 */
function GmailForm({ onDone }: { onDone: () => void }) {
  const { snapshot } = useReadyStore();
  const [usePassword, setUsePassword] = useState(true);
  const [label, setLabel] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!snapshot.meta.googleSignIn || usePassword)
    return (
      <AddAccountForm
        provider="gmail"
        onDone={onDone}
        onGoogle={snapshot.meta.googleSignIn ? () => setUsePassword(false) : undefined}
      />
    );

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const account = await window.mypa.email.addGoogle({
        label: label || undefined,
        displayName: displayName || undefined,
      });
      setAccounts(await window.mypa.email.accounts());
      if (account.status === "error") setError(account.errorMessage ?? "Couldn't connect.");
      else onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cal-accounts__form">
      <p className="wsettings__hint">
        Your browser opens so you can pick the Google account and allow myPA to read, send and
        manage its email. No app password needed. Do this once per account.
      </p>
      <p className="wsettings__hint">
        If Google says it hasn't verified myPA, choose Advanced, then Go to myPA. Your mail stays on
        this computer.
      </p>
      <input
        className="wsettings__input"
        placeholder="Your name, as people see it (optional)"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <input
        className="wsettings__input"
        placeholder="Label, e.g. Work (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      {error && (
        <p className="email-acc__error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn" disabled={busy} onClick={() => void connect()}>
        {busy ? "Finish signing in in your browser…" : "Sign in with Google"}
      </button>
      <button type="button" className="cal__link cal-acc__small" onClick={() => setUsePassword(true)}>
        Use an app password instead
      </button>
    </div>
  );
}

function AddAccountForm({
  provider,
  onDone,
  onGoogle,
}: {
  provider: EmailProvider;
  onDone: () => void;
  /** Gmail with Google sign-in available: go back to it. */
  onGoogle?: () => void;
}) {
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [label, setLabel] = useState("");
  const [region, setRegion] = useState<ZohoRegion>("com");
  const [org, setOrg] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    address.includes("@") && password.trim() && (provider !== "imap" || (imapHost && smtpHost));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const input: NewEmailAccount = {
      provider,
      address,
      password,
      label: label || undefined,
      displayName: displayName || undefined,
      ...(provider === "zoho" ? { zohoRegion: region, zohoOrg: org } : {}),
      ...(provider === "imap"
        ? {
            imapHost,
            imapPort: Number(imapPort) || 993,
            smtpHost,
            smtpPort: Number(smtpPort) || 465,
          }
        : {}),
    };
    try {
      const account = await window.mypa.email.addAccount(input);
      if (account.status === "error") {
        // keep the form so the password can be fixed; the half-made account goes
        setAccounts(await window.mypa.email.removeAccount(account.id));
        setError(account.errorMessage ?? "Couldn't connect.");
      } else onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cal-accounts__form">
      {provider === "gmail" && (
        <p className="wsettings__hint">
          Gmail needs an <strong>app password</strong>, not your normal one. Turn on 2-Step
          Verification, then create one at{" "}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
            myaccount.google.com/apppasswords
          </a>{" "}
          and paste the 16 letters here.
        </p>
      )}
      {provider === "zoho" && (
        <p className="wsettings__hint">
          Create an <strong>app-specific password</strong> in{" "}
          <a href="https://accounts.zoho.com/home#security/app_password" target="_blank" rel="noreferrer">
            Zoho Accounts → Security → App passwords
          </a>
          , and turn on IMAP access in Zoho Mail → Settings → Mail accounts.
        </p>
      )}
      {provider === "imap" && (
        <p className="wsettings__hint">
          Any provider with IMAP and SMTP. Your provider's help pages list the server names; use an
          app password if they offer one.
        </p>
      )}
      <input
        className="wsettings__input"
        placeholder="Email address"
        type="email"
        autoComplete="off"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <input
        className="wsettings__input"
        placeholder={provider === "imap" ? "Password" : "App password"}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        className="wsettings__input"
        placeholder="Your name, as people see it (optional)"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <input
        className="wsettings__input"
        placeholder="Label, e.g. Work (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      {provider === "zoho" && (
        <>
          <select
            className="wsettings__input"
            aria-label="Zoho region"
            value={region}
            onChange={(e) => setRegion(e.target.value as ZohoRegion)}
          >
            {Object.entries(ZOHO_REGIONS).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <label className="wsettings__toggle">
            <input type="checkbox" checked={org} onChange={(e) => setOrg(e.target.checked)} />
            <span>
              Business address on my own domain
              <small>Zoho Mail for organisations uses different servers</small>
            </span>
          </label>
        </>
      )}
      {provider === "imap" && (
        <div className="email-acc__servers">
          <input
            className="wsettings__input"
            placeholder="IMAP server, e.g. imap.example.com"
            value={imapHost}
            onChange={(e) => setImapHost(e.target.value)}
          />
          <input
            className="wsettings__input email-acc__port"
            aria-label="IMAP port"
            inputMode="numeric"
            value={imapPort}
            onChange={(e) => setImapPort(e.target.value)}
          />
          <input
            className="wsettings__input"
            placeholder="SMTP server, e.g. smtp.example.com"
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
          />
          <input
            className="wsettings__input email-acc__port"
            aria-label="SMTP port"
            inputMode="numeric"
            value={smtpPort}
            onChange={(e) => setSmtpPort(e.target.value)}
          />
        </div>
      )}
      {error && (
        <p className="email-acc__error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn" disabled={busy || !ready} onClick={() => void submit()}>
        {busy ? "Connecting…" : `Connect ${PROVIDER_LABEL[provider]}`}
      </button>
      {onGoogle && (
        <button type="button" className="cal__link cal-acc__small" onClick={onGoogle}>
          Sign in with Google instead
        </button>
      )}
    </div>
  );
}

function AccountEditor({
  account,
  busy,
  onSave,
  onRemove,
  onGoogle,
}: {
  account: EmailAccount;
  busy: boolean;
  /** Gmail with Google sign-in available: sign in (again) with Google. */
  onGoogle?: () => Promise<void>;
  onSave: (patch: {
    label: string;
    displayName: string;
    signature: string;
    notify: boolean;
    password?: string;
  }) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(account.label);
  const [displayName, setDisplayName] = useState(account.displayName);
  const [signature, setSignature] = useState(account.signature);
  const [notify, setNotify] = useState(account.notify);
  const [password, setPassword] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const google = account.auth === "google";

  const signIn = async () => {
    if (!onGoogle) return;
    setSigningIn(true);
    setSignInError(null);
    try {
      await onGoogle();
    } catch (err) {
      setSignInError(errorText(err));
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="cal-accounts__form email-acc__edit">
      <input
        className="wsettings__input"
        aria-label="Label"
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className="wsettings__input"
        aria-label="Your name"
        placeholder="Your name, as people see it"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <textarea
        className="wsettings__input email-acc__sig"
        aria-label="Signature"
        placeholder="Signature (added under new emails and replies)"
        rows={3}
        value={signature}
        onChange={(e) => setSignature(e.target.value)}
      />
      {onGoogle && (
        <div className="email-acc__google">
          <button type="button" className="chip" disabled={signingIn} onClick={() => void signIn()}>
            {signingIn
              ? "Finish signing in in your browser…"
              : google
                ? "Sign in with Google again"
                : "Switch to Google sign-in"}
          </button>
          {!google && !signingIn && (
            <span className="wsettings__hint">No more app password: sign in once in the browser.</span>
          )}
          {signInError && (
            <p className="email-acc__error" role="alert">
              {signInError}
            </p>
          )}
        </div>
      )}
      {!google && (
        <input
          className="wsettings__input"
          type="password"
          autoComplete="new-password"
          placeholder="New app password (only if it changed)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      <label className="wsettings__toggle">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <span>
          Notify me about new mail
          <small>Uses the app's notification setting</small>
        </span>
      </label>
      <div className="email-acc__edit-actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            onSave({
              label,
              displayName,
              signature,
              notify,
              ...(password.trim() ? { password } : {}),
            })
          }
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {confirmRemove ? (
          <>
            <span className="email-acc__confirm">Remove {account.address} from myPA?</span>
            <button type="button" className="chip email-acc__danger" onClick={onRemove}>
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
      <p className="wsettings__hint">Removing it here doesn't delete any mail.</p>
    </div>
  );
}
