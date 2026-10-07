/**
 * "Other calendars" sibling for media: downloads audio from a URL (YouTube
 * and hundreds of other sites) via a user-installed `yt-dlp` — bring your
 * own, the same philosophy as Calendar's OAuth apps. Audio is extracted with
 * our own bundled ffmpeg (`--ffmpeg-location`), so the user doesn't also
 * need ffmpeg on PATH just for this.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

const INSTALL_HINT =
  "yt-dlp isn't installed or couldn't be found. Install it " +
  '(e.g. "winget install yt-dlp" or "pip install yt-dlp") or set a custom path ' +
  "in this widget's settings.";

const FORBIDDEN_HINT =
  "YouTube rejected the request (403). This is usually because yt-dlp is out of " +
  'date — YouTube frequently changes its extraction logic. Run "yt-dlp -U" ' +
  "(or reinstall it) to update, then try again.";

function candidates(customPath: string | null): string[] {
  const list: string[] = [];
  if (customPath) list.push(customPath);
  list.push(process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  return list;
}

export async function findYtDlp(customPath: string | null): Promise<string | null> {
  for (const candidate of candidates(customPath)) {
    try {
      await execFileAsync(candidate, ["--version"]);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** YouTube extraction needs a JS runtime. yt-dlp only looks for deno on the
 *  app's PATH by default, which can be stale (installed after launch) or
 *  missing — so resolve deno/node ourselves and pass them explicitly. */
async function jsRuntimeArgs(): Promise<string[]> {
  const locate = process.platform === "win32" ? "where" : "which";
  const args: string[] = [];
  for (const runtime of ["deno", "node"]) {
    try {
      const { stdout } = await execFileAsync(locate, [runtime]);
      const found = stdout.trim().split(/\r?\n/)[0];
      if (found) args.push("--js-runtimes", `${runtime}:${found}`);
    } catch {
      // not installed — skip
    }
  }
  return args;
}

export interface DownloadedMedia {
  filePath: string;
  title: string;
}

/** Downloads just the audio track to a temp file. Caller is responsible for
 *  deleting `filePath` once done with it. */
export async function downloadMedia(url: string, ytdlpBinary: string): Promise<DownloadedMedia> {
  const outDir = path.join(os.tmpdir(), "mypa-transcribe");
  await mkdir(outDir, { recursive: true });

  const id = randomUUID();
  const outputTemplate = path.join(outDir, `${id}.%(ext)s`);
  const ffmpegDir = path.dirname(ffmpegPath as string);

  const runtimeArgs = await jsRuntimeArgs();

  let title = url;
  try {
    const { stdout } = await execFileAsync(
      ytdlpBinary,
      // yt-dlp prints in the console's code page on Windows unless told
      // otherwise, which mangles any non-ASCII title (a curly apostrophe
      // arrived as U+FFFD); force UTF-8 to match how stdout is decoded.
      [...runtimeArgs, "--encoding", "utf-8", "--skip-download", "--print", "%(title)s", url],
      { maxBuffer: 1024 * 1024 * 10, env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
    );
    title = stdout.trim().split("\n").at(-1) || url;
  } catch {
    // Non-fatal — fall back to the URL as the title and let the actual
    // download attempt below surface any real error.
  }

  try {
    await execFileAsync(
      ytdlpBinary,
      [
        ...runtimeArgs,
        "--ffmpeg-location",
        ffmpegDir,
        "-x",
        "--audio-format",
        "mp3",
        "-o",
        outputTemplate,
        url,
      ],
      { maxBuffer: 1024 * 1024 * 10 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let hint = `yt-dlp couldn't download that: ${message}`;
    if (message.includes("ENOENT")) {
      hint = INSTALL_HINT;
    } else if (message.includes("403") && message.includes("Forbidden")) {
      hint =
        `${FORBIDDEN_HINT} If it's already current, install a JavaScript runtime ` +
        `(e.g. "winget install DenoLand.Deno") and restart myPA.\n\n${message}`;
    }
    throw new Error(hint, { cause: err });
  }

  return { filePath: outputTemplate.replace("%(ext)s", "mp3"), title };
}

export async function cleanupDownload(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => {});
}

export { INSTALL_HINT as YTDLP_INSTALL_HINT };
