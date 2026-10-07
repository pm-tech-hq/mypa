"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { viewer } from "@/lib/auth";
import { newPublisherKeys } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { publisherForUser } from "@/lib/data";

export interface ActionState {
  error?: string;
  ok?: string;
}

const RESERVED = new Set(["mypa", "admin", "official", "myp-a", "support", "me", "test"]);

async function requirePublisher() {
  const me = await viewer();
  if (!me) redirect("/signin");
  const publisher = await publisherForUser(me.id);
  if (!publisher) redirect("/dashboard");
  return publisher;
}

export async function createPublisher(_prev: ActionState, form: FormData): Promise<ActionState> {
  const me = await viewer();
  if (!me) return { error: "Sign in first." };
  if (await publisherForUser(me.id)) return { error: "You already have a publisher profile." };
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(slug))
    return { error: "Your ID must be 2 to 30 lowercase letters, numbers or dashes." };
  if (RESERVED.has(slug) && !me.isAdmin) return { error: `"${slug}" is reserved. Pick another ID.` };
  if (!name || name.length > 60) return { error: "Add a display name (up to 60 characters)." };
  if (url && !/^https:\/\/\S+$/.test(url)) return { error: "Your website must be an https link." };
  const [taken] = await sql()`SELECT 1 FROM publishers WHERE slug = ${slug}`;
  if (taken) return { error: `"${slug}" is taken. Try another ID.` };
  const keys = newPublisherKeys();
  await sql()`
    INSERT INTO publishers (slug, user_id, name, url, license_public_key, license_private_key)
    VALUES (${slug}, ${me.id}, ${name}, ${url || null}, ${keys.publicKey}, ${keys.sealedPrivateKey})`;
  revalidatePath("/dashboard");
  return { ok: "Profile created." };
}

export async function updateProfile(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePublisher();
  const name = String(form.get("name") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  const bio = String(form.get("bio") ?? "").trim();
  if (!name || name.length > 60) return { error: "Add a display name (up to 60 characters)." };
  if (url && !/^https:\/\/\S+$/.test(url)) return { error: "Your website must be an https link." };
  if (bio.length > 400) return { error: "Keep the bio under 400 characters." };
  await sql()`UPDATE publishers SET name = ${name}, url = ${url || null}, bio = ${bio || null} WHERE slug = ${p.slug}`;
  revalidatePath("/", "layout");
  return { ok: "Saved." };
}

export async function updatePricing(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePublisher();
  const widgetId = String(form.get("widgetId"));
  const [w] = await sql()`SELECT publisher_slug FROM widgets WHERE id = ${widgetId}`;
  if (!w || w.publisher_slug !== p.slug) return { error: "That isn't your widget." };
  const priceText = String(form.get("price") ?? "").trim();
  const listed = form.get("listed") === "on";
  let amount: number | null = null;
  if (priceText && Number(priceText) > 0) {
    const n = Math.round(Number(priceText) * 100);
    if (!Number.isFinite(n) || n < 99 || n > 99900) return { error: "Prices run from 0.99 to 999." };
    amount = n;
  }
  await sql()`UPDATE widgets SET price_amount = ${amount}, listed = ${listed} WHERE id = ${widgetId}`;
  revalidatePath("/", "layout");
  return {
    ok:
      amount && !p.stripeChargesReady
        ? "Saved. Buyers can't check out until you finish Stripe setup."
        : "Saved.",
  };
}
