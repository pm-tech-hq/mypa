import { Download, Loader2, Pause, Play, RotateCcw, X } from "lucide-react";

import type { LocalModelStatus } from "../../../shared/assistant";
import { LOCAL_MODELS, type LocalModelId } from "../../../shared/tutor";

const mb = (b: number) => Math.round(b / 1_048_576).toLocaleString();

/** Shown in place of the chat until the built-in model is on this computer:
 *  the download starts only when the user asks, shows its progress, and can
 *  be paused, resumed or cancelled. */
export function AssistantSetup({
  status,
  onModelChange,
  onUseProvider,
}: {
  status: LocalModelStatus;
  onModelChange: (id: LocalModelId) => void;
  onUseProvider: () => void;
}) {
  const { model, state, done, total } = status;
  const info = LOCAL_MODELS.find((m) => m.id === model);
  const api = window.mypa.assistant;
  const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  const active = state === "downloading" || state === "pausing";
  const started = active || state === "paused" || (state === "error" && done > 0);

  return (
    <section className="asst-setup" aria-label="Set up the assistant">
      <p className="asst__empty-title">Set up the assistant</p>
      <p className="asst__empty-text">
        The assistant runs on this computer, so what you ask stays on your device. It needs a
        one-time model download first.
      </p>

      <label className="asst-setup__model">
        <span>Model</span>
        <select
          className="field"
          value={model}
          disabled={started}
          onChange={(e) => onModelChange(e.target.value as LocalModelId)}
        >
          {LOCAL_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {info && <p className="asst-setup__note">{info.note}</p>}

      {started && (
        <div className="asst-setup__progress">
          <div
            className="asst-setup__bar"
            role="progressbar"
            aria-label="Model download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="asst-setup__meta num">
            {total > 0
              ? `${mb(done)} of ${mb(total)} MB · ${pct}%`
              : active
                ? "Starting…"
                : `${mb(done)} MB downloaded`}
            {state === "paused" && " · Paused"}
            {state === "pausing" && " · Pausing…"}
          </p>
        </div>
      )}

      {state === "error" && status.error && (
        <p className="asst-setup__error" role="alert">
          {status.error}
        </p>
      )}

      <div className="asst-setup__actions">
        {state === "missing" && (
          <button type="button" className="is-primary" onClick={() => void api.modelDownload(model)}>
            <Download size={13} aria-hidden />
            Download
          </button>
        )}
        {state === "downloading" && (
          <button type="button" onClick={() => void api.modelPause()}>
            <Pause size={13} aria-hidden />
            Pause
          </button>
        )}
        {state === "pausing" && (
          <button type="button" disabled>
            <Loader2 size={13} className="asst__spin" aria-hidden />
            Pausing
          </button>
        )}
        {state === "paused" && (
          <button type="button" className="is-primary" onClick={() => void api.modelDownload(model)}>
            <Play size={13} aria-hidden />
            Resume
          </button>
        )}
        {state === "error" && (
          <button type="button" className="is-primary" onClick={() => void api.modelDownload(model)}>
            <RotateCcw size={13} aria-hidden />
            {done > 0 ? "Resume" : "Try again"}
          </button>
        )}
        {started && (
          <button type="button" onClick={() => void api.modelCancel(model)}>
            <X size={13} aria-hidden />
            Cancel
          </button>
        )}
        {!started && (
          <button type="button" className="asst-setup__link" onClick={onUseProvider}>
            Use an AI provider instead
          </button>
        )}
      </div>
    </section>
  );
}
