import { fulfil, syncAccount, verifyWebhook } from "@/lib/stripe";

interface StripeEvent {
  type: string;
  data: { object: { id: string } };
}

export async function POST(req: Request) {
  const payload = await req.text();
  if (!verifyWebhook(payload, req.headers.get("stripe-signature")))
    return new Response("Bad signature", { status: 400 });
  const event = JSON.parse(payload) as StripeEvent;
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded")
      await fulfil(event.data.object.id);
    else if (event.type === "account.updated") await syncAccount(event.data.object.id);
  } catch (err) {
    console.error("[stripe webhook]", event.type, err);
    return new Response("Handler failed", { status: 500 }); // Stripe retries
  }
  return Response.json({ received: true });
}
