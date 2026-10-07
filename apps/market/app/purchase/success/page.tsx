import type { Metadata } from "next";
import Link from "next/link";

import { CopyButton } from "@/components/CopyButton";
import { purchaseBySession } from "@/lib/data";
import { fulfil } from "@/lib/stripe";

export const metadata: Metadata = { title: "Your license key", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Success({ searchParams }: PageProps<"/purchase/success">) {
  const { session_id } = await searchParams;
  const sessionId = typeof session_id === "string" ? session_id : "";
  let purchase = sessionId ? await purchaseBySession(sessionId) : null;
  // The webhook usually lands first; if not, fulfil here (it's idempotent).
  if (!purchase && sessionId && (await fulfil(sessionId).catch(() => false)))
    purchase = await purchaseBySession(sessionId);

  return (
    <div className="wrap" style={{ maxWidth: 720 }}>
      <header className="page-head">
        <h1>{purchase ? "Thanks, it's yours" : "We're confirming your payment"}</h1>
        <p className="lede">
          {purchase
            ? `Here's your license key for ${purchase.widgetId}. Save it somewhere safe; it works on every computer you use myPA on.`
            : "This can take a few seconds. Refresh the page shortly. If it doesn't appear, reply to your Stripe receipt."}
        </p>
      </header>
      {purchase && (
        <div className="panel">
          <div className="key-box">
            <code>{purchase.licenseKey}</code>
            <CopyButton text={purchase.licenseKey} />
          </div>
          <ol className="howto" style={{ marginTop: 20 }}>
            <li>In myPA, open Add widget, then Browse the marketplace.</li>
            <li>Open the widget, click Install, then paste this key under License.</li>
          </ol>
          <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>
            Licensed to {purchase.buyerEmail}.{" "}
            <Link href={`/widgets/${encodeURIComponent(purchase.widgetId)}`}>Back to the widget</Link>
          </p>
        </div>
      )}
    </div>
  );
}
