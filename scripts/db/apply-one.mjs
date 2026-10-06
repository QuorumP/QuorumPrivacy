// Apply a single migration file. Usage: node scripts/db/apply-one.mjs <file.sql>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { ssl } from "./ssl.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const file = process.argv[2];
const sql = readFileSync(join(root, "supabase", "migrations", file), "utf8");
const client = new pg.Client({
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? "postgres", ssl,
});
await client.connect();
await client.query(sql);
const { rows } = await client.query(
  `select column_name from information_schema.columns
   where table_name='members' and column_name in ('id_commitment','leaf_index') order by column_name`,
);
console.log(`Applied ${file}. members now has:`, rows.map((r) => r.column_name).join(", "));
await client.end();
