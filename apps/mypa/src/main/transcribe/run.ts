/** Runs one transcription/extraction job end to end, updating the DB (and
 *  pushing live snapshots) as it goes. Every entry point here swallows its
 *  own errors into the job's `status`/`errorMessage` row rather than
 *  throwing — callers fire-and-forget these, they don't await them. */
import { pushSnapshot } from "../broadcast";
import type { WhisperModelSize } from "../../shared/types";
import * as db from "../db";
import { decodeToPcm } from "./ffmpeg";
import { extractPageText } from "./page";
import { cleanupDownload, downloadMedia, findYtDlp, YTDLP_INSTALL_HINT } from "./ytdlp";
import { transcribeAudio } from "./whisper";

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function reportProgress(id: string, pct: number): void {
  db.updateTranscriptProgress(id, pct);
  pushSnapshot();
}

export async function runFileTranscription(
  id: string,
  filePath: string,
  modelSize: WhisperModelSize,
): Promise<void> {
  try {
    db.updateTranscriptStatus(id, "processing");
    pushSnapshot();
    const { audio, durationMs } = await decodeToPcm(filePath);
    const text = await transcribeAudio(audio, modelSize, (pct) => reportProgress(id, pct));
    db.completeTranscript(id, text, durationMs, wordCount(text));
  } catch (err) {
    db.failTranscript(id, err instanceof Error ? err.message : String(err));
  } finally {
    pushSnapshot();
  }
}

export async function runUrlMediaTranscription(
  id: string,
  url: string,
  modelSize: WhisperModelSize,
  ytdlpPath: string | null,
): Promise<void> {
  let tempFile: string | null = null;
  try {
    db.updateTranscriptStatus(id, "processing");
    pushSnapshot();

    const binary = await findYtDlp(ytdlpPath);
    if (!binary) throw new Error(YTDLP_INSTALL_HINT);

    const { filePath, title } = await downloadMedia(url, binary);
    tempFile = filePath;
    db.renameTranscript(id, title);
    pushSnapshot();

    const { audio, durationMs } = await decodeToPcm(filePath);
    const text = await transcribeAudio(audio, modelSize, (pct) => reportProgress(id, pct));
    db.completeTranscript(id, text, durationMs, wordCount(text));
  } catch (err) {
    db.failTranscript(id, err instanceof Error ? err.message : String(err));
  } finally {
    if (tempFile) await cleanupDownload(tempFile);
    pushSnapshot();
  }
}

export async function runPageExtraction(id: string, url: string): Promise<void> {
  try {
    db.updateTranscriptStatus(id, "processing");
    pushSnapshot();
    const { title, text } = await extractPageText(url);
    db.renameTranscript(id, title);
    db.completeTranscript(id, text, null, wordCount(text));
  } catch (err) {
    db.failTranscript(id, err instanceof Error ? err.message : String(err));
  } finally {
    pushSnapshot();
  }
}
