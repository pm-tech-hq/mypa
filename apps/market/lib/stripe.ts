import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { issueLicense } from "./crypto";
import { sql } from "./db";
import { publisherBySlug, siteUrl } from "./data";

/**
 * Stripe Connect (Express) over the REST API.
 * - Each publisher onboards to their own Express account from the dashboard.
 * - Checkout is a destination charge: the buyer pays the platform, Stripe
 *   moves the price minus `PLATFORM_FEE_PERCENT` to the publisher.
 * - After payment the webhook (or the success page, whichever lands first)
 *   signs a license key with the publisher's key; the desktop app verifies it
 *   offline against the public half published in the registry.
 */

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function platformFeePercent(): number {
  const n = Number(process.env.PLATFORM_FEE_PERCENT ?? 15);
  return Number.isFinite(n) && n >= 0 && n <= 50 ? n : 15;
}

type Params = Record<string, string | number | boolean | undefined>;

async function stripe<T>(method: "GET" | "POST", path: string, params: Params = {}): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe isn't configured");
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.append(k, String(v));
  const url = `https://api.stripe.com/v1/${path}${method === "GET" && body.size ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body : undefined,
    cache: "no-store",
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Stripe error ${res.status}`);
  return json;
}

/* ---- publishers: Express onboarding ------------------------------------- */

interface StripeAccount {
  id: string;
  charges_enabled: boolean;
  details_submitted: boolean;
}

export async function onboardingLink(slug: string): Promise<string> {
  const p = await publisherBySlug(slug);
  if (!p) throw new Error("Unknown publisher");
  let accountId = p.stripeAccountId;
  if (!accountId) {
    const account = await stripe<StripeAccount>("POST", "accounts", {
      type: "express",
      "capabilities[card_payments][requested]": true,
      "capabilities[transfers][requested]": true,
      "business_profile[url]": `${siteUrl()}/publishers/${slug}`,
      "metadata[publisher]": slug,
    });
    accountId = account.id;
    await sql()`UPDATE publishers SET stripe_account_id = ${accountId} WHERE slug = ${slug}`;
  }
  const link = await stripe<{ url: string }>("POST", "account_links", {
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${siteUrl()}/dashboard/stripe?refresh=1`,
    return_url: `${siteUrl()}/dashboard/stripe`,
  });
  return link.url;
}

/** Re-reads the account (used on return from onboarding and by the webhook). */
export async function syncAccount(accountId: string): Promise<boolean> {
  const account = await stripe<StripeAccount>("GET", `accounts/${accountId}`);
  await sql()`
    UPDATE publishers SET stripe_charges_ready = ${account.charges_enabled}
    WHERE stripe_account_id = ${accountId}`;
  return account.charges_enabled;
}

export async function dashboardLoginLink(accountId: string): Promise<string> {
  const link = await stripe<{ url: string }>("POST", `accounts/${accountId}/login_links`);
  return link.url;
}

export async function stripeReady(slug: string): Promise<boolean> {
  if (!stripeConfigured()) return false;
  const p = await publisherBySlug(slug);
  return Boolean(p?.stripeAccountId && p.stripeChargesReady);
}

/* ---- buyers: checkout + fulfilment ---------------------------------------- */

interface CheckoutSession {
  id: string;
  url: string | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  currency: string;
  customer_details: { email: string | null } | null;
  metadata: Record<string, string>;
}

export async function createCheckout(widgetId: string): Promise<string> {
  const [row] = await sql()`
    SELECT w.id, w.price_amount, w.price_currency, w.publisher_slug, p.stripe_account_id,
           p.stripe_charges_ready,
           (SELECT manifest->>'name' FROM widget_versions v
             WHERE v.widget_id = w.id AND v.status = 'approved'
             ORDER BY v.created_at DESC LIMIT 1) AS name
    FROM widgets w JOIN publishers p ON p.slug = w.publisher_slug
    WHERE w.id = ${widgetId} AND w.listed`;
  if (!row || !row.price_amount || !row.name) throw new Error("This widget isn't for sale.");
  if (!row.stripe_account_id || !row.stripe_charges_ready)
    throw new Error("The publisher hasn't finished setting up payouts yet.");
  const amount = Number(row.price_amount);
  const site = siteUrl();
  const session = await stripe<CheckoutSession>("POST", "checkout/sessions", {
    mode: "payment",
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": String(row.price_currency).toLowerCase(),
    "line_items[0][price_data][unit_amount]": amount,
    "line_items[0][price_data][product_data][name]": `${String(row.name)} for myPA`,
    "line_items[0][price_data][product_data][description]": "One-time purchase. License key delivered instantly.",
    "payment_intent_data[application_fee_amount]": Math.round((amount * platformFeePercent()) / 100),
    "payment_intent_data[transfer_data][destination]": String(row.stripe_account_id),
    "metadata[widget_id]": widgetId,
    success_url: `${site}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/widgets/${encodeURIComponent(widgetId)}?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout page.");
  return session.url;
}

/** Idempotent: safe to call from both the webhook and the success page. */
export async function fulfil(sessionId: string): Promise<boolean> {
  const [done] = await sql()`SELECT 1 FROM purchases WHERE stripe_session_id = ${sessionId}`;
  if (done) return true;
  const session = await stripe<CheckoutSession>("GET", `checkout/sessions/${sessionId}`);
  if (session.payment_status !== "paid") return false;
  const widgetId = session.metadata.widget_id;
  const email = session.customer_details?.email ?? "customer";
  if (!widgetId) return false;
  const [w] = await sql()`
    SELECT p.license_private_key FROM widgets w JOIN publishers p ON p.slug = w.publisher_slug
    WHERE w.id = ${widgetId}`;
  if (!w) return false;
  const licenseKey = issueLicense(String(w.license_private_key), widgetId, email);
  const amount = session.amount_total ?? 0;
  await sql()`
    INSERT INTO purchases (widget_id, stripe_session_id, buyer_email, amount, platform_fee, currency, license_key)
    VALUES (${widgetId}, ${sessionId}, ${email}, ${amount},
            ${Math.round((amount * platformFeePercent()) / 100)}, ${session.currency}, ${licenseKey})
    ON CONFLICT (stripe_session_id) DO NOTHING`;
  return true;
}

/* ---- webhooks -------------------------------------------------------------- */

/** Verifies a `Stripe-Signature` header against any configured endpoint secret. */
export function verifyWebhook(payload: string, header: string | null): boolean {
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
    (s): s is string => Boolean(s),
  );
  if (!header || !secrets.length) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, ...v] = kv.split("=");
      return [k, v.join("=")];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const signatures = header
    .split(",")
    .filter((kv) => kv.startsWith("v1="))
    .map((kv) => Buffer.from(kv.slice(3), "hex"));
  return secrets.some((secret) => {
    const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest();
    return signatures.some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected));
  });
}
