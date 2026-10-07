import { buildRegistry } from "@/lib/registry";

// Always reflects the latest approvals; the CDN absorbs repeat reads.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const registry = await buildRegistry();
    return Response.json(registry, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("[registry]", err);
    return Response.json({ error: "The registry is temporarily unavailable." }, { status: 503 });
  }
}
