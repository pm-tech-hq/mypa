import "server-only";

import type { TrustLevel, WidgetManifest } from "@repo/widget-sdk";

import { hasDatabase, sql } from "./db";

export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3100";
}

export interface PublisherRow {
  slug: string;
  userId: string;
  name: string;
  url: string | null;
  bio: string | null;
  verified: boolean;
  official: boolean;
  licensePublicKey: string;
  licensePrivateKey: string;
  stripeAccountId: string | null;
  stripeChargesReady: boolean;
  createdAt: string;
}

export interface ListedWidget {
  id: string;
  manifest: WidgetManifest;
  version: string;
  sha256: string;
  bytes: number;
  bundleUrl: string;
  updatedAt: string;
  downloads: number;
  featured: boolean;
  priceAmount: number | null;
  priceCurrency: string;
  publisher: { slug: string; name: string; verified: boolean; official: boolean; licensePublicKey: string };
  trust: TrustLevel;
}

export interface VersionRow {
  id: string;
  widgetId: string;
  version: string;
  manifest: WidgetManifest;
  bundleUrl: string;
  sha256: string;
  bytes: number;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

export function trustOf(p: { official: boolean; verified: boolean }): TrustLevel {
  return p.official ? "official" : p.verified ? "verified" : "community";
}

function toPublisher(r: Row): PublisherRow {
  return {
    slug: String(r.slug),
    userId: String(r.user_id),
    name: String(r.name),
    url: (r.url as string | null) ?? null,
    bio: (r.bio as string | null) ?? null,
    verified: Boolean(r.verified),
    official: Boolean(r.official),
    licensePublicKey: String(r.license_public_key),
    licensePrivateKey: String(r.license_private_key),
    stripeAccountId: (r.stripe_account_id as string | null) ?? null,
    stripeChargesReady: Boolean(r.stripe_charges_ready),
    createdAt: String(r.created_at),
  };
}

function toVersion(r: Row): VersionRow {
  return {
    id: String(r.id),
    widgetId: String(r.widget_id),
    version: String(r.version),
    manifest: r.manifest as WidgetManifest,
    bundleUrl: String(r.bundle_url),
    sha256: String(r.sha256),
    bytes: Number(r.bytes),
    status: r.status as VersionRow["status"],
    reviewNote: (r.review_note as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

function toListed(r: Row): ListedWidget {
  const publisher = {
    slug: String(r.publisher_slug),
    name: String(r.pub_name),
    verified: Boolean(r.verified),
    official: Boolean(r.official),
    licensePublicKey: String(r.license_public_key),
  };
  return {
    id: String(r.id),
    manifest: r.manifest as WidgetManifest,
    version: String(r.version),
    sha256: String(r.sha256),
    bytes: Number(r.bytes),
    bundleUrl: String(r.bundle_url),
    updatedAt: String(r.reviewed_at ?? r.version_created_at),
    downloads: Number(r.downloads),
    featured: Boolean(r.featured),
    priceAmount: r.price_amount == null ? null : Number(r.price_amount),
    priceCurrency: String(r.price_currency),
    publisher,
    trust: trustOf(publisher),
  };
}

/* ------------------------------------------------------------ storefront -- */

/** Every listed widget at its newest approved version. */
export async function listListed(): Promise<ListedWidget[]> {
  if (!hasDatabase()) return [];
  const rows = await sql()`
    SELECT DISTINCT ON (w.id)
      w.id, w.publisher_slug, w.price_amount, w.price_currency, w.featured, w.downloads,
      v.version, v.manifest, v.sha256, v.bytes, v.bundle_url, v.reviewed_at,
      v.created_at AS version_created_at,
      p.name AS pub_name, p.verified, p.official, p.license_public_key
    FROM widgets w
    JOIN widget_versions v ON v.widget_id = w.id AND v.status = 'approved'
    JOIN publishers p ON p.slug = w.publisher_slug
    WHERE w.listed
    ORDER BY w.id, v.created_at DESC`;
  return rows.map(toListed);
}

export async function getListed(id: string): Promise<ListedWidget | null> {
  return (await listListed()).find((w) => w.id === id) ?? null;
}

export async function approvedVersions(widgetId: string): Promise<VersionRow[]> {
  const rows = await sql()`
    SELECT * FROM widget_versions WHERE widget_id = ${widgetId} AND status = 'approved'
    ORDER BY created_at DESC`;
  return rows.map(toVersion);
}

export async function getVersion(widgetId: string, version: string): Promise<VersionRow | null> {
  const rows = await sql()`
    SELECT * FROM widget_versions WHERE widget_id = ${widgetId} AND version = ${version}`;
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function countDownload(widgetId: string): Promise<void> {
  await sql()`UPDATE widgets SET downloads = downloads + 1 WHERE id = ${widgetId}`;
}

/* ------------------------------------------------------------ publishers -- */

export async function publisherBySlug(slug: string): Promise<PublisherRow | null> {
  if (!hasDatabase()) return null;
  const rows = await sql()`SELECT * FROM publishers WHERE slug = ${slug}`;
  return rows[0] ? toPublisher(rows[0]) : null;
}

export async function publisherForUser(userId: string): Promise<PublisherRow | null> {
  const rows = await sql()`SELECT * FROM publishers WHERE user_id = ${userId}`;
  return rows[0] ? toPublisher(rows[0]) : null;
}

export async function publisherByStripeAccount(accountId: string): Promise<PublisherRow | null> {
  const rows = await sql()`SELECT * FROM publishers WHERE stripe_account_id = ${accountId}`;
  return rows[0] ? toPublisher(rows[0]) : null;
}

export interface DashboardWidget {
  id: string;
  listed: boolean;
  priceAmount: number | null;
  priceCurrency: string;
  downloads: number;
  versions: VersionRow[];
  sales: number;
  revenue: number;
}

export async function dashboardWidgets(slug: string): Promise<DashboardWidget[]> {
  const [widgets, versions, sales] = await Promise.all([
    sql()`SELECT * FROM widgets WHERE publisher_slug = ${slug} ORDER BY created_at DESC`,
    sql()`
      SELECT v.* FROM widget_versions v JOIN widgets w ON w.id = v.widget_id
      WHERE w.publisher_slug = ${slug} ORDER BY v.created_at DESC`,
    sql()`
      SELECT p.widget_id, COUNT(*)::int AS n, COALESCE(SUM(p.amount - p.platform_fee), 0)::int AS net
      FROM purchases p JOIN widgets w ON w.id = p.widget_id
      WHERE w.publisher_slug = ${slug} GROUP BY p.widget_id`,
  ]);
  const vs = versions.map(toVersion);
  return widgets.map((w) => {
    const s = sales.find((x) => x.widget_id === w.id);
    return {
      id: String(w.id),
      listed: Boolean(w.listed),
      priceAmount: w.price_amount == null ? null : Number(w.price_amount),
      priceCurrency: String(w.price_currency),
      downloads: Number(w.downloads),
      versions: vs.filter((v) => v.widgetId === w.id),
      sales: Number(s?.n ?? 0),
      revenue: Number(s?.net ?? 0),
    };
  });
}

/* ----------------------------------------------------------------- admin -- */

export interface PendingVersion extends VersionRow {
  publisher: { slug: string; name: string; verified: boolean };
}

export async function pendingVersions(): Promise<PendingVersion[]> {
  const rows = await sql()`
    SELECT v.*, p.slug AS p_slug, p.name AS p_name, p.verified AS p_verified
    FROM widget_versions v
    JOIN widgets w ON w.id = v.widget_id
    JOIN publishers p ON p.slug = w.publisher_slug
    WHERE v.status = 'pending' ORDER BY v.created_at`;
  return rows.map((r) => ({
    ...toVersion(r),
    publisher: { slug: String(r.p_slug), name: String(r.p_name), verified: Boolean(r.p_verified) },
  }));
}

export async function allPublishers(): Promise<(PublisherRow & { login: string; widgets: number })[]> {
  const rows = await sql()`
    SELECT p.*, u.login, (SELECT COUNT(*)::int FROM widgets w WHERE w.publisher_slug = p.slug) AS widgets
    FROM publishers p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC`;
  return rows.map((r) => ({ ...toPublisher(r), login: String(r.login), widgets: Number(r.widgets) }));
}

export async function allWidgetsForAdmin() {
  const rows = await sql()`
    SELECT w.id, w.featured, w.listed, w.publisher_slug FROM widgets w ORDER BY w.created_at DESC`;
  return rows.map((r) => ({
    id: String(r.id),
    featured: Boolean(r.featured),
    listed: Boolean(r.listed),
    publisherSlug: String(r.publisher_slug),
  }));
}

/* -------------------------------------------------------------- purchases -- */

export async function purchaseBySession(sessionId: string) {
  const rows = await sql()`SELECT * FROM purchases WHERE stripe_session_id = ${sessionId}`;
  const r = rows[0];
  return r
    ? {
        widgetId: String(r.widget_id),
        buyerEmail: String(r.buyer_email),
        licenseKey: String(r.license_key),
        amount: Number(r.amount),
        currency: String(r.currency),
      }
    : null;
}
