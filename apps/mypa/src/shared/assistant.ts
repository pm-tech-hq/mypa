/** The Assistant: an app-wide AI that chats and acts across widgets through
 *  permission-checked tools. Shared between the main process and the UI. */

import type { LocalModelId } from "./tutor";

export type Access = "none" | "read" | "write";

/** Built-in data areas. Installed widgets add `widget:<manifest id>` scopes. */
export type CoreScope =
  | "tasks"
  | "calendar"
  | "email"
  | "notes"
  | "transcripts"
  | "expenses"
  | "reminders"
  | "planner"
  | "capture"
  | "shopping"
  | "journal"
  | "study"
  | "timers"
  | "memory"
  | "board";
export type ScopeId = CoreScope | `widget:${string}`;

export const CORE_SCOPES: { id: CoreScope; label: string; description: string }[] = [
  { id: "tasks", label: "Tasks and goals", description: "Your to-do lists, steps and goals." },
  {
    id: "calendar",
    label: "Calendar",
    description: "Your own events and connected calendars: add, change, delete and answer invitations.",
  },
  {
    id: "email",
    label: "Email",
    description:
      "Find, read and sort your mail into categories, mark it, archive it or move it to Trash (you approve moves), and write drafts for you to send. It can't send email or delete it for good.",
  },
  { id: "notes", label: "Notes", description: "The text in your Note widgets." },
  {
    id: "transcripts",
    label: "Transcripts",
    description: "Everything you transcribed. Read only.",
  },
  {
    id: "expenses",
    label: "Expenses",
    description: "Your spending, categories, budgets and bills: log and fix expenses, answer what you spent.",
  },
  {
    id: "reminders",
    label: "Reminders",
    description: "Your reminders: set, move, snooze, tick off and delete them.",
  },
  {
    id: "planner",
    label: "Daily Planner",
    description: "Your day plans: draft a plan around your meetings, move blocks and approve it.",
  },
  {
    id: "capture",
    label: "Quick Capture",
    description: "Things you jotted down: save new ones and file or clear your notes inbox.",
  },
  {
    id: "shopping",
    label: "Shopping Lists",
    description: "Your shopping lists: read them, add, tick off and remove items.",
  },
  {
    id: "journal",
    label: "Journal",
    description: "Your private journal: read past entries and add to a day. Off unless you allow it, and never while it's locked.",
  },
  {
    id: "timers",
    label: "Timers",
    description: "Your timers and stopwatches: start, pause, add time and stop them.",
  },
  {
    id: "study",
    label: "Study Planner",
    description: "Your subjects, exams and study sessions: book sessions in free time and plan revision.",
  },
  {
    id: "memory",
    label: "Personal Memory",
    description:
      "What you've told it about yourself. Read: it uses your memories in every chat. Read and change: it can also remember new things you tell it, which you check in the Personal Memory widget.",
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
  email: "write",
  notes: "write",
  transcripts: "read",
  expenses: "write",
  reminders: "write",
  planner: "write",
  capture: "write",
  shopping: "write",
  journal: "none",
  study: "write",
  timers: "write",
  memory: "write",
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
  /** Set when the built-in on-device model answers: it has to be downloaded first. */
  local?: LocalModelId;
}

/** Where the built-in model's one-time download stands. */
export type LocalModelState = "missing" | "downloading" | "pausing" | "paused" | "ready" | "error";

export interface LocalModelStatus {
  model: LocalModelId;
  state: LocalModelState;
  /** Bytes on disk so far, and the full size (0 until the download has started once). */
  done: number;
  total: number;
  error?: string;
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
  modelStatus: "assistant:modelStatus",
  modelDownload: "assistant:modelDownload",
  modelPause: "assistant:modelPause",
  modelCancel: "assistant:modelCancel",
  modelEvent: "assistant:modelEvent",
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
  /** The built-in model's download: status, start/resume, pause, cancel (deletes the partial files). */
  modelStatus: (model: LocalModelId) => Promise<LocalModelStatus>;
  modelDownload: (model: LocalModelId) => Promise<void>;
  modelPause: () => Promise<void>;
  modelCancel: (model: LocalModelId) => Promise<void>;
  onModelStatus: (cb: (s: LocalModelStatus) => void) => () => void;
}
