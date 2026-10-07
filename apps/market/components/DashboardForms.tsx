"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Loader2, UploadCloud } from "lucide-react";

import {
  createPublisher,
  updatePricing,
  updateProfile,
  type ActionState,
} from "@/app/dashboard/actions";

function Feedback({ state }: { state: ActionState }) {
  if (state.error)
    return (
      <p className="note note--error" role="alert">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p className="note" role="status">
        {state.ok}
      </p>
    );
  return null;
}

export function CreatePublisherForm({ suggested }: { suggested: string }) {
  const [state, action, pending] = useActionState(createPublisher, {});
  return (
    <form action={action} className="form">
      <label className="field">
        <span className="field__label">Publisher ID</span>
        <input
          className="input"
          name="slug"
          defaultValue={suggested}
          required
          pattern="[a-z0-9][a-z0-9\-]{1,29}"
        />
        <span className="field__hint">
          Every widget you publish starts with it, like <b>{suggested || "you"}.pomodoro</b>. It
          can&apos;t be changed later.
        </span>
      </label>
      <label className="field">
        <span className="field__label">Display name</span>
        <input className="input" name="name" required maxLength={60} placeholder="Your name or studio" />
      </label>
      <label className="field">
        <span className="field__label">Website (optional)</span>
        <input className="input" name="url" type="url" placeholder="https://" />
      </label>
      <Feedback state={state} />
      <div>
        <button className="btn btn--primary" disabled={pending}>
          {pending && <Loader2 size={16} className="spin" aria-hidden />}
          Create publisher profile
        </button>
      </div>
    </form>
  );
}

export function ProfileForm({ name, url, bio }: { name: string; url: string | null; bio: string | null }) {
  const [state, action, pending] = useActionState(updateProfile, {});
  return (
    <form action={action} className="form">
      <label className="field">
        <span className="field__label">Display name</span>
        <input className="input" name="name" defaultValue={name} required maxLength={60} />
      </label>
      <label className="field">
        <span className="field__label">Website</span>
        <input className="input" name="url" type="url" defaultValue={url ?? ""} placeholder="https://" />
      </label>
      <label className="field">
        <span className="field__label">About</span>
        <textarea className="input" name="bio" defaultValue={bio ?? ""} maxLength={400} />
      </label>
      <Feedback state={state} />
      <div>
        <button className="btn" disabled={pending}>
          Save profile
        </button>
      </div>
    </form>
  );
}

export function PricingForm({
  widgetId,
  price,
  listed,
}: {
  widgetId: string;
  price: number | null;
  listed: boolean;
}) {
  const [state, action, pending] = useActionState(updatePricing, {});
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="widgetId" value={widgetId} />
      <label className="input-prefix" title="Leave empty or 0 for free">
        <span>$</span>
        <input
          className="input num"
          name="price"
          inputMode="decimal"
          defaultValue={price ? (price / 100).toFixed(2) : ""}
          placeholder="Free"
          aria-label={`Price for ${widgetId}`}
          style={{ width: 90 }}
        />
      </label>
      <label className="check">
        <input type="checkbox" name="listed" defaultChecked={listed} />
        Listed
      </label>
      <button className="btn btn--sm" disabled={pending}>
        Save
      </button>
      {(state.ok || state.error) && (
        <span className={state.error ? "note note--error" : "note"} style={{ padding: "4px 10px" }}>
          {state.error ?? state.ok}
        </span>
      )}
    </form>
  );
}

interface UploadResponse {
  ok: boolean;
  errors?: string[];
  id?: string;
  version?: string;
  status?: string;
}

export function UploadForm({ slug }: { slug: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);

  async function send(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setResult(null);
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      const json = (await res.json()) as UploadResponse;
      if (json.ok)
        setResult({
          ok: true,
          lines: [
            json.status === "approved"
              ? `${json.id} ${json.version} is live. It appears in every myPA Marketplace within a minute.`
              : `${json.id} ${json.version} is waiting for review. We usually get to it within a day.`,
          ],
        });
      else setResult({ ok: false, lines: json.errors ?? ["Upload failed."] });
      router.refresh();
    } catch {
      setResult({ ok: false, lines: ["Upload failed. Check your connection and try again."] });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <label
        className={`drop${over ? " is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void send(e.dataTransfer.files[0]);
        }}
      >
        {busy ? <Loader2 size={26} className="spin" aria-hidden /> : <UploadCloud size={26} aria-hidden />}
        <strong>{busy ? "Checking your widget" : "Drop a .mypawidget file, or click to choose"}</strong>
        <span className="muted" style={{ fontSize: 13 }}>
          Its id must start with <b>{slug}.</b> Pack it with <code>mypa-widget pack</code>.
        </span>
        <input
          ref={input}
          type="file"
          accept=".mypawidget"
          className="sr-only"
          onChange={(e) => void send(e.target.files?.[0])}
        />
      </label>
      {result && (
        <div className={result.ok ? "note" : "note note--error"} style={{ marginTop: 12 }} role="status">
          {result.lines.length > 1 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {result.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : (
            result.lines[0]
          )}
        </div>
      )}
    </div>
  );
}
