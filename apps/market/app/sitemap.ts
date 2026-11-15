import type { MetadataRoute } from "next";

import { listListed } from "@/lib/data";
import { latestRelease } from "@/lib/release";
import { SITE_URL } from "@/lib/seo";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [rel, widgets] = await Promise.all([latestRelease(), listListed().catch(() => [])]);
  const released = new Date(rel.date);
  const page = (path: string, priority: number, lastModified: Date = released) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    priority,
  });
  const publishers = [...new Set(widgets.map((w) => w.publisher.slug))];
  return [
    page("", 1),
    page("/download", 0.9),
    page("/features", 0.9),
    page("/marketplace", 0.8),
    page("/help", 0.7),
    page("/changelog", 0.6),
    page("/developers", 0.6),
    page("/privacy", 0.3, new Date("2026-11-15")),
    page("/terms", 0.3, new Date("2026-11-15")),
    ...widgets.map((w) => page(`/widgets/${encodeURIComponent(w.id)}`, 0.6, new Date(w.updatedAt))),
    ...publishers.map((slug) => page(`/publishers/${slug}`, 0.4)),
  ];
}
