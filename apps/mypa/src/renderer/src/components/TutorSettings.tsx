import { useEffect, useMemo, useRef, useState } from "react";

import { Check, Pencil, Square, Trash2, Volume2 } from "lucide-react";

import {
  KOKORO_VOICES,
  LOCAL_MODELS,
  OPENAI_VOICES,
  type ProviderInfo,
  type ProviderType,
  type TutorConfig,
  type VoiceService,
} from "../../../shared/tutor";
import { ENGINE_LABEL, errorText, Speaker, type Engine } from "../lib/tutor";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export const PRESETS: { label: string; type: ProviderType; baseUrl: string; model: string }[] = [
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
  /** Scroll straight to the voice settings when the dialog opens. */
  showVoice?: boolean;
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
  showVoice = false,
}: Props) {
  const voiceSection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open || !showVoice) return;
    // after the dialog has laid out
    const t = window.setTimeout(() => voiceSection.current?.scrollIntoView({ block: "start" }), 50);
    return () => window.clearTimeout(t);
  }, [open, showVoice]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [cloudVoices, setCloudVoices] = useState<{ id: string; label: string }[]>([]);
  const [voiceKey, setVoiceKey] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const speaker = useMemo(() => new Speaker(), []);

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

  const cloud: VoiceService | null = engine === "openai" || engine === "elevenlabs" ? engine : null;
  const keySource = cloud ? (config?.voiceKeys?.[cloud] ?? null) : null;
  const hasVoiceKey = keySource !== null;

  useEffect(() => {
    setVoiceKey("");
    setReplacingKey(false);
    setCloudVoices([]);
    if (!open || cloud !== "elevenlabs" || !hasVoiceKey) return;
    let live = true;
    tutor
      .listVoices("elevenlabs")
      .then((vs) => live && setCloudVoices(vs))
      .catch((err: unknown) => live && setVoiceError(errorText(err)));
    return () => {
      live = false;
    };
  }, [open, cloud, hasVoiceKey, tutor]);

  useEffect(() => () => speaker.stop(), [speaker]);

  const saveVoiceKey = async (key: string) => {
    if (!cloud) return;
    setVoiceError(null);
    onConfigChange(await tutor.setVoiceKey(cloud, key));
    if (!key) onVoiceChange?.("");
  };

  const preview = async () => {
    if (!engine) return;
    if (previewing) {
      speaker.stop();
      setPreviewing(false);
      return;
    }
    setVoiceError(null);
    setPreviewing(true);
    try {
      await speaker.speak(
        "Hi! This is how I'll sound when I teach you. Let's learn something useful today.",
        { engine, voice: voice || (engine === "neural" ? "af_heart" : "") },
      );
    } catch (err) {
      setVoiceError(errorText(err));
    } finally {
      setPreviewing(false);
    }
  };

  const voiceOptions =
    engine === "neural"
      ? KOKORO_VOICES
      : engine === "openai"
        ? OPENAI_VOICES
        : engine === "elevenlabs"
          ? cloudVoices
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
          <section className="tut-set" ref={voiceSection}>
            <h4>Voice</h4>
            <div className="tut-set__field">
              <Label>Engine</Label>
              <select
                className="field tut__select"
                value={engine}
                onChange={(e) => {
                  onEngineChange(e.target.value as Engine);
                  onVoiceChange("");
                  setVoiceError(null);
                }}
              >
                {(Object.keys(ENGINE_LABEL) as Engine[]).map((e) => (
                  <option key={e} value={e}>
                    {ENGINE_LABEL[e]}
                  </option>
                ))}
              </select>
            </div>
            {cloud && (
              <div className="tut-set__field">
                <Label htmlFor="tv-key">{cloud === "openai" ? "OpenAI" : "ElevenLabs"} API key</Label>
                {hasVoiceKey && !replacingKey ? (
                  <div className="tut-set__keyrow">
                    <span>
                      <Check size={13} />
                      {keySource === "provider" ? "Using your OpenAI provider's key" : "Key saved"}
                    </span>
                    <button type="button" className="tut__link" onClick={() => setReplacingKey(true)}>
                      {keySource === "provider" ? "Use another key" : "Replace"}
                    </button>
                    {keySource === "saved" && (
                      <button
                        type="button"
                        className="tut__link"
                        onClick={() => void saveVoiceKey("")}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="tut-set__keyrow">
                    <Input
                      id="tv-key"
                      type="password"
                      autoComplete="off"
                      placeholder={cloud === "openai" ? "sk-…" : "Your ElevenLabs API key"}
                      value={voiceKey}
                      onChange={(e) => setVoiceKey(e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!voiceKey.trim()}
                      onClick={() => void saveVoiceKey(voiceKey)}
                    >
                      Save key
                    </Button>
                  </div>
                )}
                <p className="tut-set__hint">
                  The text being read aloud is sent to{" "}
                  {cloud === "openai" ? "OpenAI" : "ElevenLabs"}, which charges your account for it.
                  The key is encrypted and stays on this device.
                </p>
              </div>
            )}
            <div className="tut-set__field">
              <Label>Voice</Label>
              <div className="tut-set__keyrow">
                <select
                  className="field tut__select"
                  value={voice}
                  disabled={cloud !== null && !hasVoiceKey}
                  onChange={(e) => onVoiceChange(e.target.value)}
                >
                  <option value="">Default</option>
                  {voiceOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cloud !== null && !hasVoiceKey}
                  onClick={() => void preview()}
                >
                  {previewing ? <Square size={13} /> : <Volume2 size={13} />}
                  {previewing ? "Stop" : "Preview"}
                </Button>
              </div>
              {voiceError && <p className="tut-set__error">{voiceError}</p>}
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
