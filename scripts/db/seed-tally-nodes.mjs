// Seed the 5 DKG tally nodes (3-of-5 threshold) so the dashboard reflects the real setup.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { ssl } from "./ssl.mjs";

const root = process.cwd();
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const client = new pg.Client({
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE ?? "postgres", ssl,
});
await client.connect();
for (let i = 1; i <= 5; i++) {
  await client.query(
    `insert into tally_nodes (node_id, operator_wallet, attestation, status, stake_amount, slash_events)
     values ($1,$2,'TEE-attested','active',50000,0)
     on conflict (node_id) do update set status='active', attestation='TEE-attested'`,
    [`tn-${i}`, `dkg-node-${i}`],
  );
}
const { rows } = await client.query(`select count(*)::int n from tally_nodes where status='active'`);
console.log("active tally nodes:", rows[0].n);
await client.end();
