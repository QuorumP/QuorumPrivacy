// Apply SQL migrations in supabase/migrations/ to the configured Postgres DB.
// Loads .env.local, connects via discrete PG* vars (avoids URL-encoding issues),
// and runs each *.sql file in lexical order. Idempotent migrations recommended.
//
// Usage: node scripts/db/apply-migrations.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { ssl } from "./ssl.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

// minimal .env.local loader (no extra deps)
function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* file optional */ }
}
loadEnv(join(root, ".env.local"));

const { Client } = pg;
const client = new Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? "postgres",
  ssl,
});

const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const run = async () => {
  await client.connect();
  console.log(`Connected to ${process.env.PGHOST} as ${process.env.PGUSER}`);
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    process.stdout.write(`Applying ${f} ... `);
    await client.query(sql);
    console.log("ok");
  }
  // quick sanity check: list public tables
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema='public' order by table_name"
  );
  console.log("\nPublic tables now present:");
  for (const r of rows) console.log("  -", r.table_name);
  await client.end();
};

run().catch((e) => {
  console.error("\nMIGRATION FAILED:", e.message);
  process.exit(1);
});
