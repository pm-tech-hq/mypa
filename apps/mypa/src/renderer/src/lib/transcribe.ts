/** Pure formatting helpers for the Transcribe widget. */

import type { TranscriptKind } from "../../../shared/types";

export function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatCreatedAt(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const MEDIA_HOSTS =
  /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|soundcloud\.com|tiktok\.com|twitch\.tv|dailymotion\.com|instagram\.com|podcasts\.apple\.com|rumble\.com|bilibili\.com|loom\.com)$/i;
const MEDIA_FILE = /\.(mp3|wav|m4a|aac|flac|ogg|opus|mp4|mov|mkv|webm|avi|m4v)(\?|#|$)/i;

/** Best guess at whether a link is audio/video (transcribe the sound) or an
 *  article (extract the text). The user can always override it. */
export function looksLikeMedia(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return MEDIA_HOSTS.test(url.hostname) || MEDIA_FILE.test(url.pathname);
  } catch {
    return false;
  }
}

export const KIND_LABEL: Record<TranscriptKind, string> = {
  file: "File",
  url_media: "Media URL",
  page: "Page",
};
