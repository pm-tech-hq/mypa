import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TrustLabel } from "@/components/icons";
import { WidgetCard } from "@/components/WidgetCard";
import { listListed, publisherBySlug, trustOf } from "@/lib/data";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/publishers/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const p = await publisherBySlug(slug).catch(() => null);
  if (!p) return { title: "Publisher not found", robots: { index: false } };
  return pageMeta({
    title: `${p.name}: widgets for myPA`,
    description: p.bio ?? `Widgets for the myPA board, made by ${p.name}.`,
    path: `/publishers/${slug}`,
  });
}

export default async function PublisherPage({ params }: PageProps<"/publishers/[slug]">) {
  const { slug } = await params;
  const p = await publisherBySlug(slug);
  if (!p) notFound();
  const widgets = (await listListed()).filter((w) => w.publisher.slug === slug);
  return (
    <div className="wrap">
      <header className="page-head">
        <h1>{p.name}</h1>
        <div className="detail-head__meta">
          <TrustLabel trust={trustOf(p)} />
          {p.url && (
            <a href={p.url} rel="noopener noreferrer" target="_blank" className="pub">
              {p.url.replace(/^https:\/\//, "")}
            </a>
          )}
        </div>
        {p.bio && <p className="lede">{p.bio}</p>}
      </header>
      <section className="section" style={{ paddingTop: 8 }}>
        {widgets.length ? (
          <div className="grid">
            {widgets.map((w) => (
              <WidgetCard key={w.id} w={w} />
            ))}
          </div>
        ) : (
          <p className="muted">No published widgets yet.</p>
        )}
      </section>
    </div>
  );
}
