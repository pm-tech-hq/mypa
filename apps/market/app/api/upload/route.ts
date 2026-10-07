import { put } from "@vercel/blob";
import { revalidatePath } from "next/cache";

import { checkBundle, compareVersions } from "@repo/widget-sdk";

import { viewer } from "@/lib/auth";
import { sha256Hex } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { publisherForUser } from "@/lib/data";

const fail = (error: string | string[], status = 400) =>
  Response.json({ ok: false, errors: Array.isArray(error) ? error : [error] }, { status });

/** A publisher uploads a packed `.mypawidget`. Verified publishers go live
 *  immediately; everyone else waits for review. */
export async function POST(req: Request) {
  const me = await viewer();
  if (!me) return fail("Sign in first.", 401);
  const publisher = await publisherForUser(me.id);
  if (!publisher) return fail("Create your publisher profile first.", 403);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Choose a .mypawidget file.");
  const text = await file.text();
  const checked = checkBundle(text);
  if (!checked.ok) return fail(checked.errors);
  const m = checked.bundle.manifest;

  if (m.publisher.id !== publisher.slug || !m.id.startsWith(`${publisher.slug}.`))
    return fail(
      `This widget belongs to "${m.publisher.id}". Set publisher.id to "${publisher.slug}" and the id to "${publisher.slug}.<name>" in manifest.json.`,
    );

  const [owner] = await sql()`SELECT publisher_slug FROM widgets WHERE id = ${m.id}`;
  if (owner && owner.publisher_slug !== publisher.slug) return fail("That widget id is taken.");

  const existing = await sql()`SELECT version FROM widget_versions WHERE widget_id = ${m.id}`;
  if (existing.some((v) => v.version === m.version))
    return fail(`Version ${m.version} was already uploaded. Bump "version" in manifest.json.`);
  const newest = existing.map((v) => String(v.version)).sort(compareVersions).at(-1);
  if (newest && compareVersions(m.version, newest) < 0)
    return fail(`Version ${m.version} is older than ${newest}, the newest you've uploaded.`);

  const sha256 = sha256Hex(text);
  const blob = await put(`bundles/${m.id}/${m.version}-${sha256.slice(0, 12)}.mypawidget`, text, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });

  const autoApprove = publisher.verified || publisher.official;
  await sql()`
    INSERT INTO widgets (id, publisher_slug) VALUES (${m.id}, ${publisher.slug})
    ON CONFLICT (id) DO NOTHING`;
  await sql()`
    INSERT INTO widget_versions (widget_id, version, manifest, bundle_url, sha256, bytes, status, reviewed_at)
    VALUES (${m.id}, ${m.version}, ${JSON.stringify(m)}, ${blob.url}, ${sha256},
            ${Buffer.byteLength(text)}, ${autoApprove ? "approved" : "pending"},
            ${autoApprove ? new Date().toISOString() : null})`;

  revalidatePath("/dashboard");
  if (autoApprove) revalidatePath("/", "layout");
  return Response.json({ ok: true, id: m.id, version: m.version, status: autoApprove ? "approved" : "pending" });
}
