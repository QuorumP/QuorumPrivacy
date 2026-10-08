import { readFileSync } from "node:fs";
import pg from "pg";
import { ssl } from "./ssl.mjs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const c = new pg.Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE ?? "postgres", ssl });
await c.connect();
const SEED_NODES = ["N-08", "N-12", "N-17", "N-21", "tn-1", "tn-2", "tn-3", "tn-4", "tn-5"];
const steps = [
  ["stakes pointing at seeded nodes (must be 0)", `select 1 from stakes where node_id in (select id from tally_nodes where node_id = any($1))`, [SEED_NODES], 0, "select"],
  ["proofs", `delete from proofs where (kind,ref_id) in (('vote','qrm-003'),('tally','T-2041'),('node','N-08'),('treasury','S-0f4a'))`, [], 4],
  ["treasury_records", `delete from treasury_records where (record_id='T-1042' and commitment='commit:0x3a..7c11') or (record_id='S-0f4a' and account is null)`, [], 2],
  ["auditor_keys (placeholder pubkeys)", `delete from auditor_keys where length(pubkey)=10 and pubkey like '0x%..%'`, [], 3],
  ["proposals", `delete from proposals where proposal_id in ('P-012','P-013','P-014') and author_wallet is null and rules_commit='commit:0x..'`, [], 3],
  ["tally_nodes", `delete from tally_nodes where node_id = any($1)`, [SEED_NODES], 9],
  ["votes (+ cascaded tally_results)", `delete from votes where vote_id in ('qrm-001','qrm-002','qrm-003') and created_at < '2026-07-01' and not exists (select 1 from ballots b where b.vote_id=votes.vote_id)`, [], 3],
];
const dry = process.argv[2] !== "commit";
await c.query("begin");
let ok = true;
for (const [what, sql, params, want, kind] of steps) {
  const r = await c.query(sql, params);
  const n = r.rowCount;
  console.log(`${n === want ? "ok " : "BAD"} ${what}: ${n} (want ${want})`);
  if (n !== want) ok = false;
}
const left = await c.query(`select (select count(*) from tally_results)::int tr, (select count(*) from votes)::int v`);
console.log("after:", left.rows[0]);
if (ok && !dry) { await c.query("commit"); console.log("COMMITTED"); } else { await c.query("rollback"); console.log(dry ? "dry run: rolled back" : "mismatch: rolled back"); }
await c.end();
