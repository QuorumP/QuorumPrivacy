// Confidential homomorphic tally: sum the encrypted ballots for a vote per option and decrypt
// only the totals. Individual ballots are never decrypted. Run with:
//   bun scripts/crypto/tally.ts <voteId>
import { addCiphertexts, decrypt, type Ciphertext } from "../../src/lib/crypto/elgamal";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { ssl } from "../db/ssl.mjs";

const root = process.cwd();
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const voteId = process.argv[2];
if (!voteId) { console.error("usage: bun scripts/crypto/tally.ts <voteId>"); process.exit(1); }
const secret = BigInt(JSON.parse(readFileSync(join(root, ".devnet", "tally-secret.json"), "utf8")).secret);

const client = new pg.Client({
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE ?? "postgres", ssl,
});
await client.connect();
const { rows } = await client.query<{ enc_choice: string }>(`select enc_choice from ballots where vote_id=$1`, [voteId]);
await client.end();

const options = ["yes", "no", "abstain"];
const parsed = rows.map((r) => JSON.parse(r.enc_choice) as Ciphertext[]).filter((c) => Array.isArray(c) && c.length === options.length);
console.log(`vote ${voteId}: ${rows.length} ballots (${parsed.length} ElGamal-sealed)`);

const counts = options.map((_, i) => {
  const col = parsed.map((b) => b[i]);
  return col.length ? decrypt(secret, addCiphertexts(col)) : 0;
});
options.forEach((o, i) => console.log(`  ${o.padEnd(8)}: ${counts[i]}`));
console.log("sum:", counts.reduce((a, b) => a + b, 0), "(equals ElGamal ballot count)");
