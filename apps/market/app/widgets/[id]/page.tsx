import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ExternalLink } from "lucide-react";

import { CATEGORY_LABEL, formatPrice } from "@repo/widget-sdk";

import { PermissionList, Tile, TrustLabel } from "@/components/icons";
import { approvedVersions, getListed } from "@/lib/data";
import { stripeReady } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/widgets/[id]">): Promise<Metadata> {
  const { id } = await params;
  const w = await getListed(decodeURIComponent(id)).catch(() => null);
  return w ? { title: w.manifest.name, description: w.manifest.summary } : { title: "Widget not found" };
}

function formatBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

export default async function WidgetPage({ params, searchParams }: PageProps<"/widgets/[id]">) {
  const { id } = await params;
  const { checkout } = await searchParams;
  const w = await getListed(decodeURIComponent(id));
  if (!w) notFound();
  const m = w.manifest;
  const versions = await approvedVersions(w.id);
  const paid = Boolean(w.priceAmount);
  const price = paid
    ? formatPrice({ amount: w.priceAmount!, currency: w.priceCurrency, checkoutUrl: "" })
    : "Free";
  const canBuy = paid && (await stripeReady(w.publisher.slug));
  const paragraphs = (m.description ?? m.summary).split(/\n\s*\n/);

  return (
    <div className="wrap">
      <header className="detail-head">
        <Tile icon={m.icon} size="xl" />
        <div className="detail-head__id">
          <h1>{m.name}</h1>
          <div className="detail-head__meta">
            <Link href={`/publishers/${w.publisher.slug}`} className="pub">
              {w.publisher.name}
            </Link>
            <TrustLabel trust={w.trust} />
            <span>{CATEGORY_LABEL[m.category]}</span>
            <span className="num">Version {w.version}</span>
          </div>
        </div>
        <div className="detail-head__cta">
          {paid ? (
            canBuy ? (
              <Link href={`/widgets/${encodeURIComponent(w.id)}/buy`} className="btn btn--primary btn--lg">
                Buy for {price}
              </Link>
            ) : (
              <span className="btn btn--primary btn--lg" aria-disabled="true">
                {price}, not on sale yet
              </span>
            )
          ) : (
            <a href={`mypa://widget/${encodeURIComponent(w.id)}`} className="btn btn--primary btn--lg">
              Open in myPA
            </a>
          )}
          <span className="muted" style={{ fontSize: 12, textAlign: "center" }}>
            {paid ? "One-time purchase. The key works on all your computers." : "Free forever"}
          </span>
        </div>
      </header>

      {checkout === "unavailable" && (
        <p className="note note--error" style={{ marginTop: 20 }}>
          Checkout isn't available for this widget right now. Please try again later.
        </p>
      )}
      {checkout === "cancelled" && (
        <p className="note note--warn" style={{ marginTop: 20 }}>
          Checkout was cancelled. You weren't charged.
        </p>
      )}

      <div className="detail-cols">
        <div>
          <div className="prose">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>

          <h2 className="h3" style={{ margin: "32px 0 12px" }}>
            How to install
          </h2>
          <ol className="howto">
            <li>Open myPA and click Add widget, then Browse the marketplace.</li>
            <li>
              Find <strong>{m.name}</strong> and click {paid ? "Install" : "Get"}.
            </li>
            {paid && <li>Paste the license key from your purchase on the widget's page.</li>}
            <li>Click Add to this page. Drag it anywhere, resize it however you like.</li>
          </ol>

          {versions.length > 0 && (
            <>
              <h2 className="h3" style={{ margin: "32px 0 4px" }}>
                Versions
              </h2>
              <ul className="versions">
                {versions.slice(0, 6).map((v) => (
                  <li key={v.id}>
                    <span className="num">{v.version}</span>
                    <span className="muted">
                      {new Date(v.createdAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <aside>
          <section className="box">
            <h2 className="box__title">This widget can</h2>
            <PermissionList permissions={m.permissions} />
          </section>
          <section className="box">
            <h2 className="box__title">Details</h2>
            <dl className="facts">
              <dt>Price</dt>
              <dd>{price}</dd>
              <dt>Installs</dt>
              <dd className="num">{w.downloads.toLocaleString("en")}</dd>
              <dt>Size</dt>
              <dd className="num">{formatBytes(w.bytes)}</dd>
              <dt>Widget ID</dt>
              <dd className="mono">{w.id}</dd>
            </dl>
            {m.homepage && (
              <a href={m.homepage} className="pub" style={{ marginTop: 14 }} rel="noopener noreferrer" target="_blank">
                Publisher's website <ExternalLink size={13} aria-hidden />
              </a>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
