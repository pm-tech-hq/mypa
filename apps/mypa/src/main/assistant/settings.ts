/** Assistant settings and the access rules every tool call is checked against. */
import {
  CORE_SCOPES,
  DEFAULT_ASSISTANT_SETTINGS,
  DEFAULT_CORE_ACCESS,
  type Access,
  type AssistantSettings,
  type CoreScope,
  type ScopeId,
  type ScopeInfo,
} from "../../shared/assistant";
import * as db from "../db";

const KEY = "assistantSettings";
const READ_ONLY: ReadonlySet<ScopeId> = new Set<ScopeId>(["transcripts"]);

export function getSettings(): AssistantSettings {
  const stored = db.getMetaJson<Partial<AssistantSettings>>(KEY, {});
  return { ...DEFAULT_ASSISTANT_SETTINGS, ...stored, access: { ...(stored.access ?? {}) } };
}

export function saveSettings(next: AssistantSettings): AssistantSettings {
  const clean: AssistantSettings = {
    access: {},
    model: String(next.model ?? ""),
    codeModel: String(next.codeModel ?? ""),
    confirmRisky: next.confirmRisky !== false,
    reasoning: next.reasoning === true,
  };
  for (const [scope, access] of Object.entries(next.access ?? {})) {
    if (access === "none" || access === "read" || access === "write") {
      clean.access[scope as ScopeId] =
        READ_ONLY.has(scope as ScopeId) && access === "write" ? "read" : access;
    }
  }
  db.setMetaJson(KEY, clean);
  db.flush();
  return clean;
}

/** Effective access for a scope, applying defaults. */
export function accessFor(scope: ScopeId, settings = getSettings()): Access {
  const explicit = settings.access[scope];
  if (explicit) return READ_ONLY.has(scope) && explicit === "write" ? "read" : explicit;
  if (scope.startsWith("widget:")) {
    const id = scope.slice("widget:".length);
    const installed = db.getInstalledWidget(id);
    // Official widgets are ours and their data is plain; anything else is off until allowed.
    return installed?.trust === "official" ? "write" : "none";
  }
  return DEFAULT_CORE_ACCESS[scope as CoreScope] ?? "none";
}

export function allows(scope: ScopeId, need: "read" | "write", settings = getSettings()): boolean {
  const a = accessFor(scope, settings);
  return need === "read" ? a !== "none" : a === "write";
}

/** Every scope with its effective access, for the settings screen. */
export function listScopes(): ScopeInfo[] {
  const settings = getSettings();
  const core: ScopeInfo[] = CORE_SCOPES.map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    access: accessFor(s.id, settings),
    readOnly: READ_ONLY.has(s.id),
  }));
  const widgets: ScopeInfo[] = db
    .listInstalledWidgets()
    .filter((w) => w.enabled)
    .map((w) => ({
      id: `widget:${w.manifest.id}` as ScopeId,
      label: w.manifest.name,
      description: w.manifest.summary,
      access: accessFor(`widget:${w.manifest.id}`, settings),
      readOnly: false,
    }));
  return [...core, ...widgets];
}
