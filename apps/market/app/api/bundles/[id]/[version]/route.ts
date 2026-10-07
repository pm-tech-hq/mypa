import { countDownload, getVersion } from "@/lib/data";

/** Counts the download, then hands the app the immutable Blob URL. The app
 *  checks the file against the signed registry's sha256, so the redirect
 *  can't be used to swap contents. */
export async function GET(_req: Request, ctx: RouteContext<"/api/bundles/[id]/[version]">) {
  const { id, version } = await ctx.params;
  const v = await getVersion(decodeURIComponent(id), decodeURIComponent(version));
  if (!v || v.status !== "approved") return new Response("Not found", { status: 404 });
  await countDownload(v.widgetId);
  return Response.redirect(v.bundleUrl, 302);
}
