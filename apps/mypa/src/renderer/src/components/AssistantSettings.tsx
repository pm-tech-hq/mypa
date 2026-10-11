import { useEffect, useState } from "react";

import { Cpu, Server } from "lucide-react";

import type { Access, AssistantSettings, ScopeInfo } from "../../../shared/assistant";
import type { TutorConfig } from "../../../shared/tutor";
import { TutorSettings } from "./TutorSettings";

const LEVELS: { value: Access; label: string }[] = [
  { value: "none", label: "Off" },
  { value: "read", label: "See" },
  { value: "write", label: "Change" },
];

/** The assistant's settings: which model, how careful, and what it may touch. */
export function AssistantSettingsView({ onDone }: { onDone: () => void }) {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [config, setConfig] = useState<TutorConfig | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const api = window.mypa.assistant;

  useEffect(() => {
    void api.getSettings().then(setSettings);
    void api.scopes().then(setScopes);
    void window.mypa.tutor.getConfig().then(setConfig);
  }, [api]);

  const save = async (next: AssistantSettings) => {
    setSettings(next);
    setSettings(await api.saveSettings(next));
    setScopes(await api.scopes());
  };

  if (!settings) return <div className="asst-set" />;

  const providers = config?.providers ?? [];
  const modelOptions = (
    <>
      <option value="">Automatic{providers[0] ? ` (${providers[0].name})` : " (built-in)"}</option>
      <option value="local">Built-in, offline</option>
      {providers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {p.model ? ` · ${p.model}` : ""}
        </option>
      ))}
    </>
  );

  return (
    <div className="asst-set">
      <section className="asst-set__section">
        <h3>Model</h3>
        <label className="asst-set__field">
          <span>For chat and actions</span>
          <select
            className="field"
            value={settings.model}
            onChange={(e) => void save({ ...settings, model: e.target.value })}
          >
            {modelOptions}
          </select>
        </label>
        <label className="asst-set__field">
          <span>For building widgets</span>
          <select
            className="field"
            value={settings.codeModel}
            onChange={(e) => void save({ ...settings, codeModel: e.target.value })}
          >
            <option value="">Same as above</option>
            {modelOptions}
          </select>
        </label>
        <p className="asst-set__hint">
          <Cpu size={13} aria-hidden />
          <span>
            The built-in model runs on this PC with nothing to set up, but it's small: fine for
            questions, unreliable at actions.
          </span>
        </p>
        <p className="asst-set__hint">
          <Server size={13} aria-hidden />
          <span>
            For local and capable, run <strong>Ollama</strong> or <strong>LM Studio</strong> with a
            tool-calling model (for example qwen2.5:7b or llama3.1:8b) and add it below. Or add
            Groq, OpenAI or Claude.
          </span>
        </p>
        <button type="button" className="asst-set__button" onClick={() => setModelsOpen(true)}>
          Manage AI models…
        </button>
      </section>

      <section className="asst-set__section">
        <h3>Safety</h3>
        <label className="asst-set__toggle">
          <input
            type="checkbox"
            checked={settings.confirmRisky}
            onChange={(e) => void save({ ...settings, confirmRisky: e.target.checked })}
          />
          <span>
            <strong>Ask before risky actions</strong>
            <em>
              Deleting things and installing widgets wait for your OK. Everything else can be
              undone.
            </em>
          </span>
        </label>
      </section>

      <section className="asst-set__section">
        <h3>Speed</h3>
        <label className="asst-set__toggle">
          <input
            type="checkbox"
            checked={settings.reasoning}
            onChange={(e) => void save({ ...settings, reasoning: e.target.checked })}
          />
          <span>
            <strong>Think before answering</strong>
            <em>
              Reasoning models (Qwen3, DeepSeek-R1…) work through a problem first. Better for tricky
              requests, but much slower on a computer without a strong GPU.
            </em>
          </span>
        </label>
      </section>

      <section className="asst-set__section">
        <h3>What the assistant can access</h3>
        <ul className="asst-set__scopes">
          {scopes.map((s) => (
            <li key={s.id}>
              <span className="asst-set__scope-text">
                <strong>{s.label}</strong>
                <em>{s.description}</em>
              </span>
              <span
                className="asst-set__levels"
                role="radiogroup"
                aria-label={`Access to ${s.label}`}
              >
                {LEVELS.map((l) => {
                  const disabled = l.value === "write" && s.readOnly;
                  return (
                    <button
                      key={l.value}
                      type="button"
                      role="radio"
                      aria-checked={s.access === l.value}
                      disabled={disabled}
                      className={s.access === l.value ? "is-on" : ""}
                      onClick={() =>
                        void save({ ...settings, access: { ...settings.access, [s.id]: l.value } })
                      }
                    >
                      {l.label}
                    </button>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
        <p className="asst-set__hint">
          Marketplace widgets start at Off unless they're official myPA widgets.
        </p>
      </section>

      <div className="asst-set__foot">
        <button type="button" className="asst-set__button is-primary" onClick={onDone}>
          Back to chat
        </button>
      </div>

      <TutorSettings
        open={modelsOpen}
        onOpenChange={(o) => {
          setModelsOpen(o);
          if (!o) void window.mypa.tutor.getConfig().then(setConfig);
        }}
        config={config}
        onConfigChange={setConfig}
        title="AI models"
      />
    </div>
  );
}
