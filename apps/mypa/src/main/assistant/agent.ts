/** The assistant's loop: ask the model, run the tools it calls (checked,
 *  approved when risky, undoable), feed results back, repeat. */
import { randomUUID } from "node:crypto";

import type {
  ActionCard,
  AssistantEvent,
  AssistantModelInfo,
  AssistantRequest,
  AssistantSettings,
} from "../../shared/assistant";
import { LOCAL_MODELS } from "../../shared/tutor";
import { pushSnapshot } from "../broadcast";
import * as db from "../db";
import * as tutorConfig from "../tutor/config";
import { buildWidget } from "./builder";
import { runModel, type AgentMsg, type Target, type ToolCall } from "./models";
import { getSettings, listScopes } from "./settings";
import { availableTools, checkAccess, findTool, ToolError, type ToolContext } from "./tools";

const MAX_ROUNDS = 10;

/** Undo functions for finished actions, by action id (this session only). */
const undos = new Map<string, () => void | Promise<void>>();
/** Actions waiting for the user's answer. */
const approvals = new Map<string, (allow: boolean) => void>();

/** "local", a provider id, or "" (auto: the first configured provider, else local). */
export function resolveTarget(choice: string): Target {
  const config = tutorConfig.getConfig();
  const localModel = config.localModel;
  const local: Target = {
    kind: "local",
    model: localModel,
    label: `Built-in · ${LOCAL_MODELS.find((m) => m.id === localModel)?.label ?? localModel}`,
  };
  if (choice === "local") return local;
  const id = choice || config.providers[0]?.id;
  if (!id) return local;
  const provider = tutorConfig.getProviderWithKey(id);
  if (!provider) return local;
  return {
    kind: "provider",
    provider,
    label: `${provider.name} · ${provider.model || "no model"}`,
  };
}

export function modelInfo(): AssistantModelInfo {
  const t = resolveTarget(getSettings().model);
  return { label: t.label, capable: t.kind === "provider" };
}

/** Qwen3-family models think aloud by default; "/no_think" turns it off. */
function wantsNoThink(target: Target, settings: AssistantSettings): boolean {
  if (settings.reasoning || target.kind !== "provider") return false;
  const model = target.provider.model.toLowerCase();
  return model.includes("qwen3") && !model.includes("thinking");
}

function systemPrompt(settings: AssistantSettings, pageId: string | null): string {
  const now = new Date();
  const snap = db.getSnapshot();
  const page = snap.pages.find((p) => p.id === pageId);
  const scopes = listScopes()
    .map(
      (s) =>
        `- ${s.label}: ${s.access === "none" ? "no access" : s.access === "read" ? "read only" : "read and change"}`,
    )
    .join("\n");
  return [
    "You are the assistant inside myPA, a local-first desktop app where the user keeps pages of widgets: a to-do list with goals, a calendar, notes, transcripts, and marketplace widgets such as Habits or Countdown.",
    "You help by chatting and by acting with your tools. Read before you change: look things up to get real ids, never invent them.",
    "When asked to change something, do it with the tools, then confirm in one short sentence. Don't ask for confirmation yourself; the app asks the user when an action is risky.",
    "For a marketplace widget (like Habits), find it with list_pages_and_widgets, read it with get_widget_data, then write back the same data shape with set_widget_data.",
    "If the user wants a widget that doesn't exist, build it with build_widget.",
    "If a tool says something isn't allowed, tell the user which permission to turn on in Assistant settings.",
    "Answer questions directly and briefly. Use markdown lists when helpful. Never claim you did something a tool didn't confirm.",
    "",
    `Now: ${now.toLocaleString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
    `The user is looking at the page “${page?.title ?? "unknown"}” (id ${pageId ?? "none"}).`,
    "",
    "What you may access:",
    scopes,
    settings.confirmRisky
      ? "Risky actions (deleting, installing widgets) wait for the user's approval."
      : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function waitForApproval(actionId: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (allow: boolean) => {
      approvals.delete(actionId);
      signal.removeEventListener("abort", onAbort);
      resolve(allow);
    };
    const onAbort = () => done(false);
    approvals.set(actionId, done);
    signal.addEventListener("abort", onAbort);
  });
}

export function answerApproval(actionId: string, allow: boolean): void {
  approvals.get(actionId)?.(allow);
}

export async function undoAction(actionId: string): Promise<boolean> {
  const fn = undos.get(actionId);
  if (!fn) return false;
  undos.delete(actionId);
  await fn();
  pushSnapshot();
  return true;
}

/** Tool groups and the words that suggest them. Small built-in models get lost
 *  in 20+ tool definitions (and pay for them in prompt time), so for those we
 *  only send the groups a message seems to be about. */
const TOOL_GROUPS: { words: RegExp; tools: string[] }[] = [
  {
    words:
      /task|to-?do|today|tomorrow|plan|plate|remind|due|goal|step|finish|done|work on|need to/i,
    tools: [
      "list_tasks",
      "add_task",
      "update_task",
      "delete_task",
      "add_steps",
      "list_goals",
      "add_goal",
    ],
  },
  {
    words: /calendar|event|meeting|schedule|appointment|today|tomorrow|week|plan|plate|busy|free/i,
    tools: ["list_events", "add_event", "update_event", "delete_event"],
  },
  {
    words: /note|write down|jot/i,
    tools: ["list_notes", "read_note", "create_note", "update_note"],
  },
  {
    words: /transcript|said|call|meeting notes|recording/i,
    tools: ["search_transcripts", "read_transcript"],
  },
  {
    words: /widget|page|habit|board|open|show|countdown|tracker/i,
    tools: [
      "list_pages_and_widgets",
      "open_page",
      "add_widget",
      "build_widget",
      "get_widget_data",
      "set_widget_data",
    ],
  },
];

function toolsFor<T extends { name: string }>(message: string, all: T[]): T[] {
  const wanted = new Set(TOOL_GROUPS.filter((g) => g.words.test(message)).flatMap((g) => g.tools));
  // Nothing matched: it's probably chat, but keep the core lookups available.
  if (!wanted.size)
    ["list_tasks", "list_events", "list_pages_and_widgets"].forEach((n) => wanted.add(n));
  return all.filter((t) => wanted.has(t.name));
}

export async function runAgent(
  req: AssistantRequest,
  send: (e: AssistantEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const id = req.requestId;
  const settings = getSettings();
  const target = resolveTarget(settings.model);
  const codeTarget = settings.codeModel ? resolveTarget(settings.codeModel) : target;
  const status = (text: string) => send({ requestId: id, type: "status", text });

  const ctx: ToolContext = {
    pageId: req.pageId,
    buildWidget: (spec) => buildWidget(codeTarget, spec, signal, status, id),
  };

  const messages: AgentMsg[] = [
    {
      role: "system",
      content:
        systemPrompt(settings, req.pageId) + (wantsNoThink(target, settings) ? "\n/no_think" : ""),
    },
    ...req.turns
      .filter((t) => t.text.trim() !== "")
      .slice(-24)
      .map((t) =>
        t.role === "user"
          ? ({ role: "user", content: t.text } as const)
          : ({ role: "assistant", content: t.text } as const),
      ),
  ];

  const execute = async (call: ToolCall): Promise<unknown> => {
    const tool = findTool(call.name);
    if (!tool) return { error: `There is no tool called ${call.name}.` };
    if ("__invalid" in call.args) return { error: "The arguments weren't valid JSON. Try again." };
    let label = tool.name;
    try {
      label = tool.label(call.args);
    } catch {
      /* label is cosmetic */
    }
    const card: ActionCard = {
      id: randomUUID(),
      tool: tool.name,
      label,
      status: "running",
      kind: tool.need,
      undoable: false,
    };
    const show = (patch: Partial<ActionCard>) => {
      Object.assign(card, patch);
      if (card.kind === "write") send({ requestId: id, type: "action", action: { ...card } });
    };
    try {
      checkAccess(tool);
      if (tool.need === "read") status(`${label}…`);
      if (tool.risky && settings.confirmRisky) {
        show({ status: "needs-approval" });
        if (!(await waitForApproval(card.id, signal))) {
          show({ status: "denied" });
          return { error: "The user declined this action. Don't retry it unless they ask." };
        }
      }
      show({ status: "running" });
      const r = await tool.run(call.args, ctx);
      if (tool.need === "write") {
        if (r.undo) undos.set(card.id, r.undo);
        pushSnapshot();
      }
      show({ status: "done", undoable: Boolean(r.undo) });
      return r.result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      show({ status: "error", error: message });
      return { error: err instanceof ToolError ? message : `Failed: ${message}` };
    }
  };

  const all = availableTools();
  const lastUser = [...req.turns].reverse().find((t) => t.role === "user")?.text ?? "";
  const tools = (target.kind === "local" ? toolsFor(lastUser, all) : all).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  if (target.kind === "local") status("Thinking on this computer…");

  let retriedMalformed = false;
  let didSomething = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal.aborted) return;
    const reply = await runModel(
      target,
      messages,
      tools,
      signal,
      (text) => send({ requestId: id, type: "delta", text }),
      status,
      `${id}-${round}`,
    );
    if (process.env.MYPA_DEBUG_ASSISTANT)
      console.log(`[assistant] round ${round}:`, JSON.stringify(reply).slice(0, 2000));
    // Small local models sometimes garble a call, or describe it instead of
    // making it ("I need to call list_tasks…"). Give them one more go.
    const described = !reply.toolCalls.length && tools.some((t) => reply.text.includes(t.name));
    if (!reply.toolCalls.length && (reply.malformed || described) && !retriedMalformed) {
      retriedMalformed = true;
      messages.push({ role: "assistant", content: reply.text });
      messages.push({
        role: "user",
        content: reply.malformed
          ? "Your tool call couldn't be read. Reply again with exactly one valid JSON object inside <tool_call></tool_call>."
          : "Don't describe the call; make it. Reply with the tool call inside <tool_call></tool_call> and nothing else.",
      });
      if (reply.text) send({ requestId: id, type: "retract" });
      continue;
    }
    messages.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls });
    if (!reply.toolCalls.length) {
      if (!reply.text && !didSomething)
        send({
          requestId: id,
          type: "delta",
          text: "I couldn't work out how to do that. Try rephrasing it, or pick a more capable model in Assistant settings.",
        });
      return;
    }
    didSomething = true;
    // Text before tool calls and the final answer belong to one reply: separate them.
    if (reply.text) send({ requestId: id, type: "delta", text: "\n\n" });
    for (const call of reply.toolCalls) {
      if (signal.aborted) return;
      const result = await execute(call);
      messages.push({
        role: "tool",
        callId: call.id,
        name: call.name,
        content: JSON.stringify(result).slice(0, 24_000),
      });
    }
  }
  send({
    requestId: id,
    type: "delta",
    text: "\n\n(I stopped after many steps. Tell me if you want me to keep going.)",
  });
}
