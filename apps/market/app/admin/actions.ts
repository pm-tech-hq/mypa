"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { viewer } from "@/lib/auth";
import { sql } from "@/lib/db";

async function requireAdmin() {
  const me = await viewer();
  if (!me?.isAdmin) notFound();
  return me;
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function reviewVersion(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get("versionId"));
  const decision = form.get("decision") === "approve" ? "approved" : "rejected";
  const note = String(form.get("note") ?? "").trim() || null;
  await sql()`
    UPDATE widget_versions SET status = ${decision}, review_note = ${note}, reviewed_at = now()
    WHERE id = ${id} AND status = 'pending'`;
  refresh();
}

export async function setPublisherFlags(form: FormData): Promise<void> {
  await requireAdmin();
  const slug = String(form.get("slug"));
  const verified = form.get("verified") === "on";
  const official = form.get("official") === "on";
  await sql()`UPDATE publishers SET verified = ${verified}, official = ${official} WHERE slug = ${slug}`;
  refresh();
}

export async function setWidgetFlags(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get("widgetId"));
  const featured = form.get("featured") === "on";
  const listed = form.get("listed") === "on";
  await sql()`UPDATE widgets SET featured = ${featured}, listed = ${listed} WHERE id = ${id}`;
  refresh();
}
