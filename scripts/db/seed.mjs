// Seed representative QUORUM data matching the current dashboard UI.
// Idempotent: uses ON CONFLICT upserts. Run: node scripts/db/seed.mjs
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

  const votes = [
    ["qrm-001", "Adopt fee-routing v2 (60/20/10/10 split)", 412, "open", "2026-07-02T14:00:00Z"],
    ["qrm-002", "Onboard Realms integration adapter", 198, "open", "2026-07-05T03:00:00Z"],
    ["qrm-003", "Treasury allocation: ecosystem grants Q3", 1041, "verified", "2026-06-20T00:00:00Z"],
  ];
  for (const [vid, title, count, status, closes] of votes) {
    await q(
      `insert into votes (vote_id, title, ballot_count, status, closes_at, opens_at)
       values ($1,$2,$3,$4::vote_status,$5, now())
       on conflict (vote_id) do update set title=excluded.title, ballot_count=excluded.ballot_count, status=excluded.status`,
      [vid, title, count, status, closes]
    );
  }
  // verified vote gets a published tally result
  await q(
    `insert into tally_results (vote_id, totals, ballot_count, correctness_zk_ref, tally_attest, verified_on_chain)
     values ('qrm-003', $1::jsonb, 1041, 'groth16:0x9c..a47e', 'mpc:7of9', true)
     on conflict (vote_id) do nothing`,
    [JSON.stringify({ yes: 712, no: 244, abstain: 85 })]
  );

  const proposals = [
    ["P-014", "hidden", "on_pass", null],
    ["P-013", "hidden", "timelock", "2026-07-07T00:00:00Z"],
    ["P-012", "executed", "on_pass", null],
  ];
  for (const [pid, status, reveal, revealAt] of proposals) {
    await q(
      `insert into proposals (proposal_id, status, reveal, reveal_at, rules_commit, quorum_rule)
       values ($1,$2::proposal_status,$3::reveal_mode,$4,'commit:0x..','>= 5% staked QRM, 3-day window')
       on conflict (proposal_id) do update set status=excluded.status`,
      [pid, status, reveal, revealAt]
    );
  }

  const nodes = [
    ["N-08", 120000, "SGX"], ["N-12", 85000, "SEV-SNP"],
    ["N-17", 64000, "SGX"], ["N-21", 210000, "SEV-SNP"],
  ];
  for (const [nid, stake, attest] of nodes) {
    await q(
      `insert into tally_nodes (node_id, stake_amount, attestation, attestation_verified, slash_events, status)
       values ($1,$2,$3,true,0,'active')
       on conflict (node_id) do update set stake_amount=excluded.stake_amount`,
      [nid, stake, attest]
    );
  }

  const proofs = [
    ["vote", "qrm-003", "Treasury allocation Q3", "ZK Groth16 · Verified"],
    ["tally", "T-2041", "MPC cluster · 7/9 nodes", "Attestation OK"],
    ["treasury", "S-117", "Solvency proof", "Valid"],
    ["node", "N-08", "Tally node — no slash events", "Honest"],
  ];
  await q(`delete from proofs`);
  for (const [kind, ref, detail, label] of proofs) {
    await q(`insert into proofs (kind, ref_id, detail, proof_label, verified) values ($1,$2,$3,$4,true)`,
      [kind, ref, detail, label]);
  }

  const treasury = [
    ["S-117", "solvency", true, "treasury >= obligations"],
    ["T-1042", "transfer", false, null],
  ];
  for (const [rid, kind, disclosed, note] of treasury) {
    await q(
      `insert into treasury_records (record_id, kind, disclosed, solvency_proof_ref, commitment)
       values ($1,$2,$3,$4,'commit:0x3a..7c11')
       on conflict (record_id) do nothing`,
      [rid, kind, disclosed, note]
    );
  }

  const auditors = [
    ["Foundation auditor", "0xa1..42c1", "full"],
    ["Member auditor", "0xb8..77af", "transfers"],
    ["External auditor", "0xd2..91ee", "solvency"],
  ];
  for (const [label, pk, scope] of auditors) {
    await q(`insert into auditor_keys (label, pubkey, scope) values ($1,$2,$3)
             on conflict do nothing`, [label, pk, scope]);
  }

  const { rows } = await q(`select
     (select count(*) from votes) votes,
     (select count(*) from proposals) proposals,
     (select count(*) from tally_nodes) nodes,
     (select count(*) from proofs) proofs,
     (select count(*) from treasury_records) treasury,
     (select count(*) from auditor_keys) auditors`);
  console.log("Seeded:", rows[0]);
  await client.end();
};

run().catch((e) => { console.error("SEED FAILED:", e.message); process.exit(1); });
