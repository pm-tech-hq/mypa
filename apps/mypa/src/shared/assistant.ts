/** The Assistant: an app-wide AI that chats and acts across widgets through
 *  permission-checked tools. Shared between the main process and the UI. */

export type Access = "none" | "read" | "write";

/** Built-in data areas. Installed widgets add `widget:<manifest id>` scopes. */
export type CoreScope = "tasks" | "calendar" | "notes" | "transcripts" | "board";
export type ScopeId = CoreScope | `widget:${string}`;

export const CORE_SCOPES: { id: CoreScope; label: string; description: string }[] = [
  { id: "tasks", label: "Tasks and goals", description: "Your to-do lists, steps and goals." },
  {
    id: "calendar",
    label: "Calendar",
    description: "Your own events, and connected calendars (read only).",
  },
  { id: "notes", label: "Notes", description: "The text in your Note widgets." },
  {
    id: "transcripts",
    label: "Transcripts",
    description: "Everything you transcribed. Read only.",
  },
  {
    id: "board",
    label: "Pages and widgets",
    description: "Open pages, add widgets, build new ones.",
  },
];

/** What the assistant may do when a scope has no explicit setting. */
export const DEFAULT_CORE_ACCESS: Record<CoreScope, Access> = {
  tasks: "write",
  calendar: "write",
  notes: "write",
  transcripts: "read",
  board: "write",
};

export interface AssistantSettings {
  /** Per-scope access. Missing keys fall back to the defaults above (and, for
   *  widgets, to "write" for official widgets and "none" for everything else). */
  access: Partial<Record<ScopeId, Access>>;
  /** "local", a provider id, or "" for automatic. */
  model: string;
  /** Model for writing widget code; "" = same as `model`. */
  codeModel: string;
  /** Ask before deleting, bulk changes and installing widgets. */
  confirmRisky: boolean;
  /** Let reasoning models think before answering (slower, sometimes smarter). */
  reasoning: boolean;
}

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  access: {},
  model: "",
  codeModel: "",
  confirmRisky: true,
  reasoning: false,
};

/** A scope as the settings screen shows it. */
export interface ScopeInfo {
  id: ScopeId;
  label: string;
  description: string;
  access: Access;
  /** Transcripts and connected data can't be written. */
  readOnly: boolean;
}

export type ActionStatus = "running" | "needs-approval" | "done" | "denied" | "error" | "undone";

/** One thing the assistant did (or wants to do), shown as a card in the chat. */
export interface ActionCard {
  id: string;
  tool: string;
  /** Plain-language summary, e.g. "Add habit “Meditate 10 min”". */
  label: string;
  status: ActionStatus;
  /** Reads don't change anything and aren't shown; writes are. */
  kind: "read" | "write";
  undoable: boolean;
  error?: string;
}

/** A turn of the conversation as the UI stores it. */
export interface AssistantTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions?: ActionCard[];
  createdAt: number;
}

export interface AssistantRequest {
  requestId: string;
  /** Earlier turns, oldest first, plus the new user message last. */
  turns: { role: "user" | "assistant"; text: string }[];
  /** The page the user is looking at, so "add it here" works. */
  pageId: string | null;
}

export type AssistantEvent =
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "status"; text: string }
  /** Drop the reply text streamed so far (the model is retrying). */
  | { requestId: string; type: "retract" }
  | { requestId: string; type: "action"; action: ActionCard }
  | { requestId: string; type: "open-page"; pageId: string }
  | { requestId: string; type: "done" }
  | { requestId: string; type: "error"; message: string };

export interface AssistantModelInfo {
  /** The model the next request will use, e.g. "Groq · llama-3.3-70b". */
  label: string;
  /** False when only the small built-in model is available. */
  capable: boolean;
}

export const ASSISTANT_IPC = {
  getSettings: "assistant:getSettings",
  saveSettings: "assistant:saveSettings",
  scopes: "assistant:scopes",
  modelInfo: "assistant:modelInfo",
  send: "assistant:send",
  cancel: "assistant:cancel",
  approve: "assistant:approve",
  undo: "assistant:undo",
  event: "assistant:event",
} as const;

export interface MypaAssistant {
  getSettings: () => Promise<AssistantSettings>;
  saveSettings: (s: AssistantSettings) => Promise<AssistantSettings>;
  scopes: () => Promise<ScopeInfo[]>;
  modelInfo: () => Promise<AssistantModelInfo>;
  /** Starts a reply; events arrive via `onEvent`. */
  send: (req: AssistantRequest) => Promise<void>;
  cancel: (requestId: string) => Promise<void>;
  /** Answer a "needs-approval" card. */
  approve: (actionId: string, allow: boolean) => Promise<void>;
  /** Reverts a finished action; resolves false if it can no longer be undone. */
  undo: (actionId: string) => Promise<boolean>;
  onEvent: (cb: (e: AssistantEvent) => void) => () => void;
}
