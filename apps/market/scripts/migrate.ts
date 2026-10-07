/** Applies db/schema.sql. Run: pnpm --filter market db:migrate (reads .env.local). */
import { readFileSync } from "node:fs";

import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Provision Neon and run `vercel env pull` first.");
  process.exit(1);
}
const sql = neon(url);
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
for (const statement of schema.split(/;\s*$/m).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) {
  await sql.query(statement);
}
console.log("\u2714 Schema is up to date");
