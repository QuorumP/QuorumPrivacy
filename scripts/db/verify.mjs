// Verify all migrations are applied: expected tables + columns present.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { ssl } from "./ssl.mjs";

const root = process.cwd();
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const c = new pg.Client({
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE ?? "postgres", ssl,
});
await c.connect();

const tables = (await c.query(
  `select table_name from information_schema.tables where table_schema='public' order by table_name`,
)).rows.map((r) => r.table_name);

const checks = [
  ["table", "rate_limits", tables.includes("rate_limits")],                         // 0005
  ["col", "members.id_commitment", await hasCol("members", "id_commitment")],       // 0003
  ["col", "members.leaf_index", await hasCol("members", "leaf_index")],             // 0003
  ["col", "votes.tally_tx", await hasCol("votes", "tally_tx")],                     // 0004
  ["col", "votes.eligibility_root", await hasCol("votes", "eligibility_root")],
  ["seq", "members_leaf_seq", (await c.query(`select 1 from pg_class where relkind='S' and relname='members_leaf_seq'`)).rowCount > 0],
];
async function hasCol(t, col) {
  const r = await c.query(`select 1 from information_schema.columns where table_name=$1 and column_name=$2`, [t, col]);
  return r.rowCount > 0;
}

console.log("tables:", tables.length, "->", tables.join(", "));
console.log("--- migration checks ---");
let allOk = true;
for (const [kind, name, ok] of checks) { console.log(`  [${ok ? "OK" : "MISSING"}] ${kind} ${name}`); if (!ok) allOk = false; }
console.log(allOk ? "\nALL MIGRATIONS APPLIED ✓" : "\nSOME MISSING ✗");
await c.end();
process.exit(allOk ? 0 : 1);
