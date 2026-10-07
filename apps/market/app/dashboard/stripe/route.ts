import { redirect } from "next/navigation";

import { viewer } from "@/lib/auth";
import { publisherForUser } from "@/lib/data";
import { dashboardLoginLink, onboardingLink, syncAccount } from "@/lib/stripe";

/** ?start=1 begins (or resumes) Express onboarding; ?manage=1 opens the
 *  publisher's Stripe dashboard; a bare visit is Stripe's return trip. */
export async function GET(req: Request) {
  const me = await viewer();
  if (!me) redirect("/signin");
  const publisher = await publisherForUser(me.id);
  if (!publisher) redirect("/dashboard");
  const params = new URL(req.url).searchParams;
  let target = "/dashboard?stripe=error";
  try {
    if (params.has("start") || params.has("refresh")) target = await onboardingLink(publisher.slug);
    else if (params.has("manage") && publisher.stripeAccountId)
      target = await dashboardLoginLink(publisher.stripeAccountId);
    else if (publisher.stripeAccountId) {
      const ready = await syncAccount(publisher.stripeAccountId);
      target = ready ? "/dashboard?stripe=ready" : "/dashboard?stripe=incomplete";
    }
  } catch (err) {
    console.error("[stripe onboarding]", err);
  }
  redirect(target);
}
