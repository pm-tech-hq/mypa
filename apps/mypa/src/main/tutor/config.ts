/** Tutor provider settings, persisted as JSON in userData. API keys are
 *  encrypted with the OS keychain (Electron safeStorage) and never sent to
 *  the renderer. */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { app, safeStorage } from "electron";

import type {
  LocalModelId,
  ProviderInfo,
  SaveProviderInput,
  TutorConfig,
  VoiceService,
} from "../../shared/tutor";

interface StoredProvider extends Omit<ProviderInfo, "hasKey"> {
  /** base64 of the safeStorage ciphertext, or "plain:<key>" if encryption is unavailable. */
  key: string;
}

interface Stored {
  providers: StoredProvider[];
  localModel: LocalModelId;
  /** Encrypted like provider keys. */
  voiceKeys: Partial<Record<VoiceService, string>>;
}

const file = (): string => path.join(app.getPath("userData"), "tutor-config.json");

function load(): Stored {
  try {
    if (existsSync(file())) {
      const raw = JSON.parse(readFileSync(file(), "utf8")) as Partial<Stored>;
      return {
        providers: raw.providers ?? [],
        localModel: raw.localModel ?? "qwen-1.5b",
        voiceKeys: raw.voiceKeys ?? {},
      };
    }
  } catch {
    /* corrupt file — fall back to defaults */
  }
  return { providers: [], localModel: "qwen-1.5b", voiceKeys: {} };
}

function save(s: Stored): void {
  writeFileSync(file(), JSON.stringify(s, null, 2), "utf8");
}

function encrypt(key: string): string {
  if (!key) return "";
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key).toString("base64")
    : `plain:${key}`;
}

function decrypt(stored: string): string {
  if (!stored) return "";
  if (stored.startsWith("plain:")) return stored.slice(6);
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    return "";
  }
}

function publicView(s: Stored): TutorConfig {
  return {
    localModel: s.localModel,
    providers: s.providers.map(({ key, ...p }) => ({ ...p, hasKey: key !== "" })),
    voiceKeys: {
      openai: s.voiceKeys.openai ? "saved" : openAiProvider(s) ? "provider" : null,
      elevenlabs: s.voiceKeys.elevenlabs ? "saved" : null,
    },
  };
}

/** An OpenAI chat provider whose key can also be used for OpenAI voices. */
function openAiProvider(s: Stored): StoredProvider | undefined {
  return s.providers.find(
    (p) => p.type === "openai" && p.key !== "" && /^https:\/\/api\.openai\.com\b/.test(p.baseUrl),
  );
}

export function setVoiceKey(service: VoiceService, key: string): TutorConfig {
  const s = load();
  s.voiceKeys = { ...s.voiceKeys, [service]: encrypt(key.trim()) };
  if (!s.voiceKeys[service]) delete s.voiceKeys[service];
  save(s);
  return publicView(s);
}

/** Main-process only: the decrypted key for a voice service ("" when there is none). */
export function getVoiceKey(service: VoiceService): string {
  const s = load();
  const own = s.voiceKeys[service];
  if (own) return decrypt(own);
  if (service === "openai") {
    const p = openAiProvider(s);
    if (p) return decrypt(p.key);
  }
  return "";
}

export function getConfig(): TutorConfig {
  return publicView(load());
}

export function saveProvider(input: SaveProviderInput): TutorConfig {
  const s = load();
  const existing = input.id ? s.providers.find((p) => p.id === input.id) : undefined;
  const next: StoredProvider = {
    id: existing?.id ?? randomUUID(),
    name: input.name.trim() || "Provider",
    type: input.type,
    baseUrl: input.baseUrl.trim(),
    model: input.model.trim(),
    key: input.apiKey === undefined ? (existing?.key ?? "") : encrypt(input.apiKey.trim()),
  };
  s.providers = existing
    ? s.providers.map((p) => (p.id === next.id ? next : p))
    : [...s.providers, next];
  save(s);
  return publicView(s);
}

export function deleteProvider(id: string): TutorConfig {
  const s = load();
  s.providers = s.providers.filter((p) => p.id !== id);
  save(s);
  return publicView(s);
}

export function setLocalModel(id: LocalModelId): TutorConfig {
  const s = load();
  s.localModel = id;
  save(s);
  return publicView(s);
}

/** Main-process only: a provider together with its decrypted key. */
export function getProviderWithKey(id: string): (ProviderInfo & { apiKey: string }) | null {
  const p = load().providers.find((x) => x.id === id);
  if (!p) return null;
  const { key, ...rest } = p;
  return { ...rest, hasKey: key !== "", apiKey: decrypt(key) };
}

export function getLocalModel(): LocalModelId {
  return load().localModel;
}
