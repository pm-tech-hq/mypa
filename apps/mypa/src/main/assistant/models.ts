/**
 * One conversation format, three ways to run it: OpenAI-compatible APIs
 * (OpenAI, Groq, OpenRouter, Ollama, LM Studio…), Anthropic, and the built-in
 * on-device model. Tool calls use each API's native mechanism; the built-in
 * model (and servers without tool support) use Qwen's <tool_call> text format.
 */
import type { LocalModelId, ProviderInfo } from "../../shared/tutor";
import { streamLocal } from "../tutor/local";
import type { JsonSchema } from "./tools";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type AgentMsg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export type Target =
  | { kind: "local"; model: LocalModelId; label: string }
  | { kind: "provider"; provider: ProviderInfo & { apiKey: string }; label: string };

export interface ModelReply {
  text: string;
  toolCalls: ToolCall[];
  /** The model tried to call a tool but the call couldn't be parsed. */
  malformed?: boolean;
}

let callSeq = 0;
const newCallId = () => `call_${Date.now().toString(36)}_${(callSeq++).toString(36)}`;

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return { __invalid: raw.slice(0, 500) };
  }
}

/* ---------------------------------------------------------------- shared -- */

async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}

class ModelError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function failure(res: Response): Promise<ModelError> {
  const body = await res.text().catch(() => "");
  let detail = body.slice(0, 300);
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    detail = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? detail;
  } catch {
    /* not JSON */
  }
  return new ModelError(
    `${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    res.status,
  );
}

/** A provider said it can't do tools; fall back to the text protocol. */
function noToolSupport(err: unknown): boolean {
  return err instanceof ModelError && err.status === 400 && /tool|function/i.test(err.message);
}

/* --------------------------------------------------------- text protocol -- */

/** Qwen 2.5's own function-calling prompt; other instruct models follow it well. */
function toolPrompt(tools: ToolSpec[]): string {
  if (!tools.length) return "";
  const lines = tools.map((t) =>
    JSON.stringify({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }),
  );
  return [
    "",
    "# Tools",
    "",
    "You may call one or more functions to assist with the user query.",
    "",
    "You are provided with function signatures within <tools></tools> XML tags:",
    "<tools>",
    ...lines,
    "</tools>",
    "",
    "For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:",
    "<tool_call>",
    '{"name": <function-name>, "arguments": <args-json-object>}',
    "</tool_call>",
    "",
    "Call tools yourself; never describe a call or ask the user which arguments to use. Pick sensible defaults. For example, if the user asks what to do today, reply with exactly:",
    "<tool_call>",
    '{"name": "list_tasks", "arguments": {"section": "today"}}',
    "</tool_call>",
    "After you get the results, answer the user in plain words.",
  ].join("\n");
}

function toTextMessages(
  messages: AgentMsg[],
  tools: ToolSpec[],
): { role: "system" | "user" | "assistant"; content: string }[] {
  const out: { role: "system" | "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    if (m.role === "system") out.push({ role: "system", content: m.content + toolPrompt(tools) });
    else if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const calls = (m.toolCalls ?? [])
        .map(
          (c) =>
            `<tool_call>\n${JSON.stringify({ name: c.name, arguments: c.args })}\n</tool_call>`,
        )
        .join("\n");
      out.push({ role: "assistant", content: [m.content, calls].filter(Boolean).join("\n") });
    } else {
      const response = `<tool_response>\n${m.content}\n</tool_response>`;
      const last = out[out.length - 1];
      // consecutive tool results share one user turn, like Qwen's template does
      if (last?.role === "user" && last.content.startsWith("<tool_response>"))
        last.content += `\n${response}`;
      else out.push({ role: "user", content: response });
    }
  }
  return out;
}

function parseTextToolCalls(text: string): ModelReply {
  const calls: ToolCall[] = [];
  let malformed = false;
  const re = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[1]!.trim();
    if (!raw) continue;
    try {
      const j = JSON.parse(raw) as { name?: string; arguments?: unknown };
      if (j.name)
        calls.push({
          id: newCallId(),
          name: j.name,
          args:
            typeof j.arguments === "string"
              ? parseArgs(j.arguments)
              : ((j.arguments as Record<string, unknown>) ?? {}),
        });
    } catch {
      malformed = true;
    }
  }
  const cut = text.indexOf("<tool_call>");
  return {
    text: (cut >= 0 ? text.slice(0, cut) : text).trim(),
    toolCalls: calls,
    malformed: malformed && calls.length === 0,
  };
}

/** Removes <think>…</think> reasoning (Qwen3, DeepSeek-R1, …) from a text
 *  stream, holding back partial tags so nothing leaks between chunks. */
function thinkFilter() {
  let buf = "";
  let thinking = false;
  const OPEN = "<think>";
  const CLOSE = "</think>";
  const take = (final: boolean): string => {
    let out = "";
    for (;;) {
      if (thinking) {
        const end = buf.indexOf(CLOSE);
        if (end < 0) {
          buf = final ? "" : buf.slice(Math.max(0, buf.length - CLOSE.length));
          return out;
        }
        buf = buf.slice(end + CLOSE.length);
        thinking = false;
      } else {
        const start = buf.indexOf(OPEN);
        if (start < 0) {
          const keep = final ? 0 : Math.min(buf.length, OPEN.length - 1);
          out += buf.slice(0, buf.length - keep);
          buf = buf.slice(buf.length - keep);
          return out;
        }
        out += buf.slice(0, start);
        buf = buf.slice(start + OPEN.length);
        thinking = true;
      }
    }
  };
  return {
    push(delta: string): string {
      buf += delta;
      return take(false);
    },
    flush(): string {
      return take(true);
    },
  };
}

/** Streams visible text until a <tool_call> starts, then keeps it to parse. */
function textStreamer(onText: (t: string) => void) {
  const think = thinkFilter();
  let all = "";
  let shown = 0;
  let hidden = false;
  const add = (visible: string) => {
    all += visible;
    if (hidden) return;
    const at = all.indexOf("<tool_call>");
    if (at >= 0) {
      if (at > shown) onText(all.slice(shown, at));
      hidden = true;
      return;
    }
    // hold back a possible partial "<tool_call" at the end
    const safe = Math.max(shown, all.length - "<tool_call>".length);
    if (safe > shown) {
      onText(all.slice(shown, safe));
      shown = safe;
    }
  };
  return {
    push(delta: string) {
      add(think.push(delta));
    },
    finish(): ModelReply {
      add(think.flush());
      if (!hidden && all.length > shown) onText(all.slice(shown));
      if (process.env.MYPA_DEBUG_ASSISTANT)
        console.log("[assistant] raw reply:", JSON.stringify(all));
      return parseTextToolCalls(all);
    },
  };
}

/* ---------------------------------------------------------------- OpenAI -- */

async function runOpenAi(
  p: ProviderInfo & { apiKey: string },
  messages: AgentMsg[],
  tools: ToolSpec[],
  signal: AbortSignal,
  onText: (t: string) => void,
  onStatus: (t: string) => void = () => undefined,
): Promise<ModelReply> {
  const base = (p.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const body = {
    model: p.model,
    stream: true,
    messages: messages.map((m) =>
      m.role === "assistant"
        ? {
            role: "assistant",
            content: m.content || (m.toolCalls?.length ? null : ""),
            ...(m.toolCalls?.length
              ? {
                  tool_calls: m.toolCalls.map((c) => ({
                    id: c.id,
                    type: "function",
                    function: { name: c.name, arguments: JSON.stringify(c.args) },
                  })),
                }
              : {}),
          }
        : m.role === "tool"
          ? { role: "tool", tool_call_id: m.callId, content: m.content }
          : { role: m.role, content: m.content },
    ),
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
  };
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  let text = "";
  const think = thinkFilter();
  let lastReasoning = 0;
  const emit = (visible: string) => {
    if (!visible) return;
    text += visible;
    onText(visible);
  };
  const partial = new Map<number, { id: string; name: string; args: string }>();
  for await (const data of sseData(res)) {
    if (data === "[DONE]") break;
    try {
      const j = JSON.parse(data) as {
        choices?: {
          delta?: {
            content?: string | null;
            /** Reasoning models (LM Studio, DeepSeek, OpenRouter) stream their thinking here. */
            reasoning_content?: string | null;
            reasoning?: string | null;
            tool_calls?: {
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
      };
      const delta = j.choices?.[0]?.delta;
      if (delta?.content) emit(think.push(delta.content));
      if ((delta?.reasoning_content || delta?.reasoning) && Date.now() - lastReasoning > 1500) {
        lastReasoning = Date.now();
        onStatus("Reasoning…");
      }
      for (const tc of delta?.tool_calls ?? []) {
        const i = tc.index ?? partial.size;
        const cur = partial.get(i) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        partial.set(i, cur);
      }
    } catch {
      /* keep-alive / partial frame */
    }
  }
  emit(think.flush());
  const toolCalls = [...partial.values()]
    .filter((c) => c.name)
    .map((c) => ({ id: c.id || newCallId(), name: c.name, args: parseArgs(c.args) }));
  return { text: text.trim(), toolCalls };
}

/* ------------------------------------------------------------- Anthropic -- */

async function runAnthropic(
  p: ProviderInfo & { apiKey: string },
  messages: AgentMsg[],
  tools: ToolSpec[],
  signal: AbortSignal,
  onText: (t: string) => void,
): Promise<ModelReply> {
  const base = (p.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  type Block = Record<string, unknown>;
  const out: { role: "user" | "assistant"; content: Block[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") out.push({ role: "user", content: [{ type: "text", text: m.content }] });
    else if (m.role === "assistant") {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls ?? [])
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      if (blocks.length) out.push({ role: "assistant", content: blocks });
    } else {
      const block = { type: "tool_result", tool_use_id: m.callId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === "user" && last.content.every((b) => b.type === "tool_result"))
        last.content.push(block);
      else out.push({ role: "user", content: [block] });
    }
  }
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": p.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: 4096,
      stream: true,
      ...(system ? { system } : {}),
      messages: out,
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
          }
        : {}),
    }),
  });
  if (!res.ok) throw await failure(res);
  let text = "";
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  for await (const data of sseData(res)) {
    try {
      const j = JSON.parse(data) as {
        type?: string;
        index?: number;
        content_block?: { type?: string; id?: string; name?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
      };
      if (j.type === "content_block_start" && j.content_block?.type === "tool_use")
        blocks.set(j.index ?? blocks.size, {
          id: j.content_block.id ?? "",
          name: j.content_block.name ?? "",
          json: "",
        });
      else if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) {
        text += j.delta.text;
        onText(j.delta.text);
      } else if (j.type === "content_block_delta" && j.delta?.type === "input_json_delta") {
        const b = blocks.get(j.index ?? -1);
        if (b) b.json += j.delta.partial_json ?? "";
      }
    } catch {
      /* keep-alive / partial frame */
    }
  }
  const toolCalls = [...blocks.values()].map((b) => ({
    id: b.id || newCallId(),
    name: b.name,
    args: parseArgs(b.json),
  }));
  return { text: text.trim(), toolCalls };
}

/* ----------------------------------------------------------------- local -- */

async function runTextProtocol(
  stream: (
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    onDelta: (t: string) => void,
  ) => Promise<void>,
  messages: AgentMsg[],
  tools: ToolSpec[],
  onText: (t: string) => void,
): Promise<ModelReply> {
  const s = textStreamer(onText);
  await stream(toTextMessages(messages, tools), (t) => s.push(t));
  return s.finish();
}

/* ------------------------------------------------------------------ entry -- */

export async function runModel(
  target: Target,
  messages: AgentMsg[],
  tools: ToolSpec[],
  signal: AbortSignal,
  onText: (t: string) => void,
  onStatus: (t: string) => void,
  jobId: string,
): Promise<ModelReply> {
  if (target.kind === "local") {
    return runTextProtocol(
      (msgs, onDelta) => streamLocal(jobId, target.model, msgs, signal, onDelta, onStatus),
      messages,
      tools,
      onText,
    );
  }
  const p = target.provider;
  if (!p.model) throw new Error(`No model set for “${p.name}”. Choose one in AI providers.`);
  try {
    return p.type === "anthropic"
      ? await runAnthropic(p, messages, tools, signal, onText)
      : await runOpenAi(p, messages, tools, signal, onText, onStatus);
  } catch (err) {
    if (!tools.length || !noToolSupport(err) || p.type === "anthropic") throw err;
    // e.g. an Ollama model without tool support: ask for <tool_call> text instead
    onStatus("This model can't call tools directly; using text instructions instead…");
    return runTextProtocol(
      async (msgs, onDelta) => {
        const r = await runOpenAi(p, msgs, [], signal, onDelta, onStatus);
        void r;
      },
      messages,
      tools,
      onText,
    );
  }
}
