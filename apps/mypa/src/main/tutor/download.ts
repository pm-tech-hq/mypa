/** Resumable model downloads. transformers.js restarts a failed download from
 *  zero, so a flaky connection can never finish a ~1 GB model ("terminated").
 *  This fetches in small Range chunks, retries each one, and keeps a `.part`
 *  file so a later attempt resumes where it stopped. Finished files land at
 *  `<cacheDir>/<repo>/<file>` — exactly where transformers.js looks. */
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

const CHUNK = 8 * 1024 * 1024;
const RETRIES = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function friendlyDownloadError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/terminated|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network/i.test(msg)) {
    return "The model download was interrupted (check your internet connection). Whatever was downloaded is kept — press the button again and it will continue where it stopped.";
  }
  return msg;
}

/** Runs `fn` with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = RETRIES): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await sleep(Math.min(1000 * 2 ** i, 15_000));
    }
  }
  throw last;
}

async function totalSize(url: string): Promise<number> {
  return withRetry(async () => {
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    if (res.status === 206) {
      const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "");
      if (m) return Number(m[1]);
    }
    if (res.ok) {
      const len = Number(res.headers.get("content-length"));
      if (len > 0) return len;
    }
    throw new Error(`Could not read size of ${url} (${res.status})`);
  });
}

export interface RemoteFile {
  url: string;
  dest: string;
  total: number;
}

export async function probe(url: string, dest: string): Promise<RemoteFile> {
  return { url, dest, total: await totalSize(url) };
}

/** Files of a Hugging Face repo whose path starts with `prefix` (e.g. `onnx/model_q4.onnx`). */
export async function listRepoFiles(repo: string, prefix: string): Promise<string[]> {
  return withRetry(async () => {
    const res = await fetch(`https://huggingface.co/api/models/${repo}`);
    if (!res.ok) throw new Error(`Hugging Face returned ${res.status} for ${repo}`);
    const j = (await res.json()) as { siblings?: { rfilename: string }[] };
    return (j.siblings ?? []).map((s) => s.rfilename).filter((f) => f.startsWith(prefix));
  });
}

/**
 * Downloads `file.url` to `file.dest` (resuming a partial download).
 * `onBytes` receives the number of new bytes as they arrive.
 */
export async function download(
  file: RemoteFile,
  onBytes: (n: number) => void,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  const { url, dest, total } = file;
  if (existsSync(dest) && statSync(dest).size === total) {
    onBytes(total);
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let offset = existsSync(part) ? statSync(part).size : 0;
  if (offset > total) offset = 0;
  onBytes(offset);

  const fh = await open(part, offset === 0 ? "w" : "r+");
  try {
    while (offset < total) {
      if (isCancelled()) throw new Error("cancelled");
      const end = Math.min(offset + CHUNK, total) - 1;
      const buf = await withRetry(async () => {
        const res = await fetch(url, { headers: { Range: `bytes=${offset}-${end}` } });
        if (res.status !== 206) throw new Error(`Server did not honour a ranged request (${res.status})`);
        const data = Buffer.from(await res.arrayBuffer());
        if (data.length !== end - offset + 1) throw new Error("terminated");
        return data;
      });
      await fh.write(buf, 0, buf.length, offset);
      offset += buf.length;
      onBytes(buf.length);
    }
  } finally {
    await fh.close();
  }
  renameSync(part, dest);
}
