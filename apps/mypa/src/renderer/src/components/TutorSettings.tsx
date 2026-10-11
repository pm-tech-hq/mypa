import { useEffect, useState } from "react";

import { Check, Pencil, Trash2 } from "lucide-react";

import {
  KOKORO_VOICES,
  LOCAL_MODELS,
  type ProviderInfo,
  type ProviderType,
  type TutorConfig,
} from "../../../shared/tutor";
import type { Engine } from "../lib/tutor";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const PRESETS: { label: string; type: ProviderType; baseUrl: string; model: string }[] = [
  {
    label: "Groq",
    type: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  { label: "OpenAI", type: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "Claude (Anthropic)", type: "anthropic", baseUrl: "", model: "claude-sonnet-5" },
  {
    label: "OpenRouter",
    type: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
  },
  {
    label: "Ollama (on this PC)",
    type: "openai",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
  },
  {
    label: "LM Studio (on this PC)",
    type: "openai",
    baseUrl: "http://localhost:1234/v1",
    model: "",
  },
  { label: "Other OpenAI-compatible", type: "openai", baseUrl: "", model: "" },
];

interface Draft {
  id?: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  apiKey: string;
  hasKey: boolean;
}

const EMPTY: Draft = {
  name: "",
  type: "openai",
  baseUrl: "",
  model: "",
  apiKey: "",
  hasKey: false,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: TutorConfig | null;
  onConfigChange: (config: TutorConfig) => void;
  /** Voice settings are Tutor-only; leave these out to show just the AI models. */
  engine?: Engine;
  onEngineChange?: (engine: Engine) => void;
  voice?: string;
  onVoiceChange?: (voice: string) => void;
  title?: string;
}

export function TutorSettings({
  open,
  onOpenChange,
  config,
  onConfigChange,
  engine,
  onEngineChange,
  voice,
  onVoiceChange,
  title = "Tutor settings",
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!open) return;
    setDraft(null);
    const load = () => setSystemVoices(window.speechSynthesis?.getVoices() ?? []);
    load();
    window.speechSynthesis?.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", load);
  }, [open]);

  const tutor = window.mypa.tutor;

  const edit = (p: ProviderInfo) =>
    setDraft({
      id: p.id,
      name: p.name,
      type: p.type,
      baseUrl: p.baseUrl,
      model: p.model,
      apiKey: "",
      hasKey: p.hasKey,
    });

  const save = async () => {
    if (!draft) return;
    const next = await tutor.saveProvider({
      id: draft.id,
      name: draft.name,
      type: draft.type,
      baseUrl: draft.baseUrl,
      model: draft.model,
      // blank on an existing provider = keep the stored key
      apiKey: draft.apiKey === "" && draft.hasKey ? undefined : draft.apiKey,
    });
    onConfigChange(next);
    setDraft(null);
  };

  const canSave = draft && draft.name.trim() !== "" && draft.model.trim() !== "";
  const voiceOptions =
    engine === "neural"
      ? KOKORO_VOICES.map((v) => ({ id: v.id, label: v.label }))
      : systemVoices.map((v) => ({ id: v.voiceURI, label: `${v.name} (${v.lang})` }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            The built-in model runs on this PC and needs no account. Add a provider for smarter
            answers. API keys are encrypted and stay on this device.
          </DialogDescription>
        </DialogHeader>

        <section className="tut-set">
          <h4>Built-in model (offline)</h4>
          {LOCAL_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`tut-set__row${config?.localModel === m.id ? " is-on" : ""}`}
              onClick={() => void tutor.setLocalModel(m.id).then(onConfigChange)}
            >
              <span className="tut-set__check">
                {config?.localModel === m.id && <Check size={13} />}
              </span>
              <span>
                <strong>{m.label}</strong>
                <em>{m.note}</em>
              </span>
            </button>
          ))}
          <p className="tut-set__hint">Downloaded once, on first use.</p>
        </section>

        <section className="tut-set">
          <h4>Your AI providers</h4>
          {config?.providers.length === 0 && !draft && (
            <p className="tut-set__hint">None yet. Add Groq, OpenAI, Claude or Ollama.</p>
          )}
          {config?.providers.map((p) => (
            <div key={p.id} className="tut-set__provider">
              <span>
                <strong>{p.name}</strong>
                <em>
                  {p.model}
                  {p.hasKey ? "" : " · no key"}
                </em>
              </span>
              <span className="tut-set__actions">
                <button type="button" aria-label={`Edit ${p.name}`} onClick={() => edit(p)}>
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => void tutor.deleteProvider(p.id).then(onConfigChange)}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          ))}

          {draft ? (
            <div className="tut-set__form">
              {!draft.id && (
                <div className="tut-set__field">
                  <Label>Start from</Label>
                  <select
                    className="field tut__select"
                    defaultValue=""
                    onChange={(e) => {
                      const p = PRESETS.find((x) => x.label === e.target.value);
                      if (p)
                        setDraft({
                          ...draft,
                          name: p.label.replace(/ \(.*\)/, ""),
                          type: p.type,
                          baseUrl: p.baseUrl,
                          model: p.model,
                        });
                    }}
                  >
                    <option value="" disabled>
                      Choose a preset…
                    </option>
                    {PRESETS.map((p) => (
                      <option key={p.label}>{p.label}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="tut-set__field">
                <Label htmlFor="tp-name">Name</Label>
                <Input
                  id="tp-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="tut-set__field">
                <Label>Type</Label>
                <select
                  className="field tut__select"
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value as ProviderType })}
                >
                  <option value="openai">OpenAI-compatible (Groq, OpenAI, Ollama…)</option>
                  <option value="anthropic">Claude (Anthropic)</option>
                </select>
              </div>
              {draft.type === "openai" && (
                <div className="tut-set__field">
                  <Label htmlFor="tp-url">Base URL</Label>
                  <Input
                    id="tp-url"
                    placeholder="https://api.openai.com/v1"
                    value={draft.baseUrl}
                    onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  />
                </div>
              )}
              <div className="tut-set__field">
                <Label htmlFor="tp-model">Model</Label>
                <Input
                  id="tp-model"
                  value={draft.model}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                />
              </div>
              <div className="tut-set__field">
                <Label htmlFor="tp-key">API key</Label>
                <Input
                  id="tp-key"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    draft.hasKey ? "Saved. Leave blank to keep it" : "Not needed for local servers"
                  }
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                />
              </div>
              <div className="tut-set__buttons">
                <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button type="button" size="sm" disabled={!canSave} onClick={() => void save()}>
                  Save provider
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft({ ...EMPTY })}
            >
              Add provider
            </Button>
          )}
        </section>

        {engine && onEngineChange && onVoiceChange && (
          <section className="tut-set">
            <h4>Voice</h4>
            <div className="tut-set__field">
              <Label>Engine</Label>
              <select
                className="field tut__select"
                value={engine}
                onChange={(e) => {
                  onEngineChange(e.target.value as Engine);
                  onVoiceChange("");
                }}
              >
                <option value="system">System voice: instant, basic quality</option>
                <option value="neural">Neural voice: natural, ~90 MB download on first use</option>
              </select>
            </div>
            <div className="tut-set__field">
              <Label>Voice</Label>
              <select
                className="field tut__select"
                value={voice}
                onChange={(e) => onVoiceChange(e.target.value)}
              >
                <option value="">Default</option>
                {voiceOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
