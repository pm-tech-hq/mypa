import { redirect } from "next/navigation";

import { createCheckout } from "@/lib/stripe";

/** Linked from the widget page and from inside myPA (the registry's checkoutUrl). */
export async function GET(_req: Request, ctx: RouteContext<"/widgets/[id]/buy">) {
  const { id } = await ctx.params;
  const widgetId = decodeURIComponent(id);
  let url: string;
  try {
    url = await createCheckout(widgetId);
  } catch (err) {
    console.error("[checkout]", err);
    redirect(`/widgets/${encodeURIComponent(widgetId)}?checkout=unavailable`);
  }
  redirect(url);
}
