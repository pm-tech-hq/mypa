/** Streaming chat against cloud / self-hosted providers (fetch + SSE). */
import type { ChatMessage, ProviderInfo } from "../../shared/tutor";

type Provider = ProviderInfo & { apiKey: string };

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

async function failure(res: Response): Promise<Error> {
  const body = await res.text().catch(() => "");
  let detail = body.slice(0, 300);
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    detail = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? detail;
  } catch {
    /* not JSON */
  }
  return new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
}

export async function streamProvider(
  p: Provider,
  messages: ChatMessage[],
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<void> {
  if (!p.model) throw new Error(`No model set for "${p.name}".`);
  return p.type === "anthropic"
    ? streamAnthropic(p, messages, signal, onDelta)
    : streamOpenAi(p, messages, signal, onDelta);
}

async function streamOpenAi(
  p: Provider,
  messages: ChatMessage[],
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<void> {
  const base = (p.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: p.model, messages, stream: true }),
  });
  if (!res.ok) throw await failure(res);
  for await (const data of sseData(res)) {
    if (data === "[DONE]") return;
    try {
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      const text = j.choices?.[0]?.delta?.content;
      if (text) onDelta(text);
    } catch {
      /* keep-alive / partial frame */
    }
  }
}

async function streamAnthropic(
  p: Provider,
  messages: ChatMessage[],
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<void> {
  const base = (p.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
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
      messages: messages.filter((m) => m.role !== "system"),
    }),
  });
  if (!res.ok) throw await failure(res);
  for await (const data of sseData(res)) {
    try {
      const j = JSON.parse(data) as { type?: string; delta?: { text?: string } };
      if (j.type === "content_block_delta" && j.delta?.text) onDelta(j.delta.text);
    } catch {
      /* keep-alive / partial frame */
    }
  }
}
