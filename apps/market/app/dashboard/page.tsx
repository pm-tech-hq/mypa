import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreditCard, ExternalLink } from "lucide-react";

import { formatPrice } from "@repo/widget-sdk";

import { CreatePublisherForm, PricingForm, ProfileForm, UploadForm } from "@/components/DashboardForms";
import { TrustLabel } from "@/components/icons";
import { viewer } from "@/lib/auth";
import { hasDatabase } from "@/lib/db";
import { dashboardWidgets, publisherForUser, trustOf } from "@/lib/data";
import { platformFeePercent, stripeConfigured } from "@/lib/stripe";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };
export const dynamic = "force-dynamic";

const STRIPE_NOTE: Record<string, { text: string; tone: "" | "warn" | "error" }> = {
  ready: { text: "Payouts are set up. Paid widgets are on sale.", tone: "" },
  incomplete: { text: "Stripe still needs a few details before you can get paid.", tone: "warn" },
  error: { text: "We couldn't reach Stripe. Try again in a moment.", tone: "error" },
};

function money(amount: number, currency = "USD") {
  return formatPrice({ amount: Math.max(amount, 1), currency, checkoutUrl: "" }).replace(/\.00$/, "");
}

export default async function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  const me = await viewer();
  if (!me) redirect("/signin");
  if (!hasDatabase())
    return (
      <div className="wrap">
        <div className="empty">
          <h2>The database isn&apos;t connected yet</h2>
          <p>Provision Neon for this project, then run the migration.</p>
        </div>
      </div>
    );
  const { stripe } = await searchParams;
  const publisher = await publisherForUser(me.id);

  if (!publisher)
    return (
      <div className="wrap" style={{ maxWidth: 760 }}>
        <header className="page-head">
          <h1>Become a publisher</h1>
          <p className="lede">
            Pick the ID your widgets will live under. You&apos;ll get a signing key for license keys
            automatically, and you can connect Stripe whenever you&apos;re ready to sell.
          </p>
        </header>
        <div className="panel">
          <CreatePublisherForm suggested={me.login.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 30)} />
        </div>
      </div>
    );

  const widgets = await dashboardWidgets(publisher.slug);
  const totals = widgets.reduce(
    (t, w) => ({ downloads: t.downloads + w.downloads, sales: t.sales + w.sales, revenue: t.revenue + w.revenue }),
    { downloads: 0, sales: 0, revenue: 0 },
  );
  const note = typeof stripe === "string" ? STRIPE_NOTE[stripe] : undefined;

  return (
    <div className="wrap" style={{ paddingBottom: 80 }}>
      <header className="page-head">
        <h1>{publisher.name}</h1>
        <div className="detail-head__meta">
          <TrustLabel trust={trustOf(publisher)} />
          <span className="mono">{publisher.slug}.*</span>
          <Link href={`/publishers/${publisher.slug}`} className="pub">
            Public page <ExternalLink size={13} aria-hidden />
          </Link>
        </div>
        <dl className="stats" style={{ marginTop: 24 }}>
          <div>
            <dt>Widgets</dt>
            <dd className="num">{widgets.length}</dd>
          </div>
          <div>
            <dt>Installs</dt>
            <dd className="num">{totals.downloads.toLocaleString("en")}</dd>
          </div>
          <div>
            <dt>Sales</dt>
            <dd className="num">{totals.sales}</dd>
          </div>
          <div>
            <dt>Earned (after fees)</dt>
            <dd className="num">{totals.revenue ? money(totals.revenue) : "$0"}</dd>
          </div>
        </dl>
      </header>

      {note && (
        <p className={`note${note.tone ? ` note--${note.tone}` : ""}`} style={{ marginBottom: 16 }}>
          {note.text}
        </p>
      )}

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2 className="h3">Publish a widget or a new version</h2>
            <p className="lede" style={{ fontSize: 14 }}>
              {publisher.verified || publisher.official
                ? "You're verified, so uploads go live straight away."
                : "New uploads are reviewed before they're listed. Verified publishers skip the queue."}
            </p>
          </div>
          <Link href="/developers" className="btn btn--sm btn--ghost">
            How to build one
          </Link>
        </div>
        <UploadForm slug={publisher.slug} />
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="h3">Your widgets</h2>
        </div>
        {widgets.length === 0 ? (
          <p className="muted">Nothing uploaded yet. Your first widget will show up here.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Widget</th>
                <th>Latest version</th>
                <th>Installs</th>
                <th>Sales</th>
                <th>Price and listing</th>
              </tr>
            </thead>
            <tbody>
              {widgets.map((w) => {
                const latest = w.versions[0];
                return (
                  <tr key={w.id}>
                    <td>
                      <strong>{latest?.manifest.name ?? w.id}</strong>
                      <div className="mono muted">{w.id}</div>
                    </td>
                    <td>
                      {latest && (
                        <>
                          <span className="num">{latest.version} </span>
                          <span className={`status status--${latest.status}`}>{latest.status}</span>
                          {latest.reviewNote && (
                            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                              {latest.reviewNote}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="num">{w.downloads.toLocaleString("en")}</td>
                    <td className="num">
                      {w.sales}
                      {w.revenue ? <span className="muted"> ({money(w.revenue, w.priceCurrency)})</span> : null}
                    </td>
                    <td>
                      <PricingForm widgetId={w.id} price={w.priceAmount} listed={w.listed} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2 className="h3">Payouts</h2>
            <p className="lede" style={{ fontSize: 14 }}>
              Buyers pay through Stripe. You receive the price minus a {platformFeePercent()}%
              marketplace fee, paid out by Stripe to your bank.
            </p>
          </div>
          <CreditCard size={22} aria-hidden className="muted" />
        </div>
        {!stripeConfigured() ? (
          <p className="note note--warn">Payments aren&apos;t switched on for the marketplace yet.</p>
        ) : publisher.stripeChargesReady ? (
          <div className="inline-form">
            <span className="status status--approved">Ready to sell</span>
            <a href="/dashboard/stripe?manage=1" className="btn btn--sm">
              Open Stripe dashboard
            </a>
          </div>
        ) : (
          <a href="/dashboard/stripe?start=1" className="btn btn--ink">
            {publisher.stripeAccountId ? "Finish Stripe setup" : "Set up payouts with Stripe"}
          </a>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="h3">Profile</h2>
        </div>
        <ProfileForm name={publisher.name} url={publisher.url} bio={publisher.bio} />
      </section>
    </div>
  );
}
