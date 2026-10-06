// Verifies the castBallot write path against the real DB: transactional insert of
// nullifier + ballot + ballot_count increment, and the double-vote (unique) guard.
// Cleans up after itself so seeded data is unchanged.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { ssl } from "./ssl.mjs";

const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
const env = {};
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl });
const VOTE = "qrm-001";
const NULL = "test-nullifier-" + "deadbeef";

const before = (await pool.query("select ballot_count from votes where vote_id=$1", [VOTE])).rows[0].ballot_count;
console.log("ballot_count before:", before);

const client = await pool.connect();
try {
  await client.query("begin");
  await client.query("insert into nullifiers (vote_id, nullifier) values ($1,$2)", [VOTE, NULL]);
  await client.query("insert into ballots (vote_id, nullifier, enc_choice, commit_hash) values ($1,$2,'enc','0xc0')", [VOTE, NULL]);
  await client.query("update votes set ballot_count = ballot_count + 1 where vote_id=$1", [VOTE]);
  await client.query("commit");
  console.log("insert+increment: OK (transaction committed)");
} catch (e) { await client.query("rollback"); console.error("insert FAILED:", e.message); }
finally { client.release(); }

const after = (await pool.query("select ballot_count from votes where vote_id=$1", [VOTE])).rows[0].ballot_count;
console.log("ballot_count after :", after, after === before + 1 ? "(+1 ✓)" : "(MISMATCH ✗)");

// double-vote guard
let blocked = false;
try {
  await pool.query("insert into nullifiers (vote_id, nullifier) values ($1,$2)", [VOTE, NULL]);
} catch (e) { blocked = e.code === "23505"; }
console.log("double-vote blocked by unique index:", blocked ? "YES ✓" : "NO ✗");

// cleanup
await pool.query("delete from ballots where nullifier=$1", [NULL]);
await pool.query("delete from nullifiers where nullifier=$1", [NULL]);
await pool.query("update votes set ballot_count=$2 where vote_id=$1", [VOTE, before]);
const restored = (await pool.query("select ballot_count from votes where vote_id=$1", [VOTE])).rows[0].ballot_count;
console.log("cleanup → ballot_count restored to:", restored);
await pool.end();
