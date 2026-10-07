/**
 * Registers the platform + Connect webhook endpoints with Stripe and stores their
 * signing secrets in Vercel (production + preview) without printing them.
 * Run: pnpm --filter market stripe:webhooks (reads .env.local). Safe to re-run:
 * existing endpoints for the same URL are left alone.
 */
import { execFileSync } from "node:child_process";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set. Install the Stripe integration and run `vercel env pull` first.");
  process.exit(1);
}
const site = process.argv[2] ?? "https://mypa-market.vercel.app";
const url = `${site}/api/stripe/webhook`;

async function stripe(path: string, body?: URLSearchParams) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${key}` },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path}: ${json.error?.message ?? res.status}`);
  return json;
}

function storeSecret(name: string, value: string) {
  for (const env of ["production", "preview"]) {
    try {
      execFileSync("vercel", ["env", "rm", name, env, "--yes"], { stdio: "ignore", shell: true });
    } catch {
      // not set yet
    }
    execFileSync("vercel", ["env", "add", name, env, "--sensitive"], { input: value, stdio: ["pipe", "ignore", "inherit"], shell: true });
  }
  console.log(`✔ ${name} stored in Vercel`);
}

const existing: { url: string; application: string | null; metadata?: { kind?: string } }[] = (
  await stripe("webhook_endpoints?limit=100")
).data;

const endpoints = [
  { kind: "platform", secret: "STRIPE_WEBHOOK_SECRET", connect: false, events: ["checkout.session.completed", "checkout.session.async_payment_succeeded"] },
  { kind: "connect", secret: "STRIPE_CONNECT_WEBHOOK_SECRET", connect: true, events: ["account.updated"] },
];

for (const e of endpoints) {
  if (existing.some((x) => x.url === url && x.metadata?.kind === e.kind)) {
    console.log(`✔ ${e.kind} endpoint already exists (secret unchanged)`);
    continue;
  }
  const body = new URLSearchParams({ url, "metadata[kind]": e.kind, description: `myPA marketplace (${e.kind})` });
  if (e.connect) body.set("connect", "true");
  e.events.forEach((ev, i) => body.set(`enabled_events[${i}]`, ev));
  const created = await stripe("webhook_endpoints", body);
  storeSecret(e.secret, created.secret);
}
console.log("Done. Redeploy for the new secrets to take effect.");
