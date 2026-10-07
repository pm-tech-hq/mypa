/** Decodes any audio/video file ffmpeg understands into raw PCM for Whisper. */
import { execFile } from "node:child_process";

import ffmpegPath from "ffmpeg-static";

export const SAMPLE_RATE = 16000;

export interface DecodedAudio {
  audio: Float32Array;
  durationMs: number;
}

/** ~1 hour of mono 16kHz f32 PCM. Long enough for a real recording, bounded
 *  so a bad input can't balloon memory unboundedly. */
const MAX_BUFFER = 1024 * 1024 * 1024;

export function decodeToPcm(filePath: string): Promise<DecodedAudio> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath as string,
      [
        "-i",
        filePath,
        "-f",
        "f32le",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        "-hide_banner",
        "-loglevel",
        "error",
        "pipe:1",
      ],
      { maxBuffer: MAX_BUFFER, encoding: "buffer" },
      (err, stdout, stderr) => {
        if (err) {
          const message = stderr?.toString("utf8").trim();
          reject(new Error(message || err.message));
          return;
        }
        const audio = new Float32Array(
          stdout.buffer,
          stdout.byteOffset,
          Math.floor(stdout.length / 4),
        );
        resolve({ audio, durationMs: (audio.length / SAMPLE_RATE) * 1000 });
      },
    );
  });
}
