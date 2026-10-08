// Seed the default DAO settings row. Idempotent. Run: node scripts/db/seed.mjs
// It used to insert illustrative votes, tally nodes, proofs and auditor keys; those were removed
// (2026-10-08) so nothing in the database claims a vote, attestation or proof that never happened.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { ssl } from "./ssl.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {}
}
loadEnv(join(root, ".env.local"));

const client = new pg.Client({
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? "postgres", ssl,
});

const q = (text, params) => client.query(text, params);

const run = async () => {
  await client.connect();

  await q(`insert into settings (dao, quorum_pct, approval_pct, voting_window_days, realms_enabled)
           values ('quorum', 5, 60, 3, true)
           on conflict (dao) do update set quorum_pct=excluded.quorum_pct`);

  const { rows } = await q(`select
     (select count(*) from votes) votes,
     (select count(*) from proposals) proposals,
     (select count(*) from tally_nodes) nodes,
     (select count(*) from proofs) proofs,
     (select count(*) from treasury_records) treasury,
     (select count(*) from auditor_keys) auditors`);
  console.log("Seeded settings. Row counts:", rows[0]);
  await client.end();
};

run().catch((e) => { console.error("SEED FAILED:", e.message); process.exit(1); });
