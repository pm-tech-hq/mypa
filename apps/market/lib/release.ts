import "server-only";

/**
 * The published myPA releases, read from GitHub Releases (the same feed the
 * desktop app updates from). Cached for an hour; if GitHub can't be reached
 * the site falls back to the release it was last built with.
 */

const REPO = "pm-tech-hq/mypa";
export const REPO_URL = `https://github.com/${REPO}`;
export const ISSUES_URL = `${REPO_URL}/issues`;

export interface Release {
  version: string;
  /** ISO date it was published. */
  date: string;
  /** Release notes, as GitHub markdown. */
  notes: string;
  /** Direct link to the Windows installer. */
  installer: string;
  /** Installer size in bytes, when known. */
  size: number | null;
  url: string;
}

const FALLBACK: Release = {
  version: "0.2.2",
  date: "2026-11-15T15:38:56Z",
  notes: "",
  installer: `${REPO_URL}/releases/download/v0.2.2/myPA-Setup-0.2.2.exe`,
  size: 315_111_328,
  url: `${REPO_URL}/releases/tag/v0.2.2`,
};

interface GhAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
interface GhRelease {
  tag_name: string;
  published_at: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: GhAsset[];
}

function toRelease(r: GhRelease): Release {
  const exe = r.assets.find((a) => /\.exe$/i.test(a.name));
  const version = r.tag_name.replace(/^v/, "");
  return {
    version,
    date: r.published_at ?? "",
    notes: (r.body ?? "").trim(),
    installer: exe?.browser_download_url ?? `${REPO_URL}/releases/tag/${r.tag_name}`,
    size: exe?.size ?? null,
    url: r.html_url,
  };
}

async function gh<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function latestRelease(): Promise<Release> {
  const r = await gh<GhRelease>("/releases/latest");
  return r ? toRelease(r) : FALLBACK;
}

export async function allReleases(): Promise<Release[]> {
  const list = await gh<GhRelease[]>("/releases?per_page=30");
  if (!list) return [FALLBACK];
  return list.filter((r) => !r.draft && !r.prerelease).map(toRelease);
}

export function megabytes(bytes: number | null): string | null {
  return bytes ? `${Math.round(bytes / 1_000_000)} MB` : null;
}

export function releaseDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
