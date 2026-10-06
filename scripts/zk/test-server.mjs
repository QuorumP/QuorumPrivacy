// Read-only integration test against the REAL DB: replicate tree.server.loadLeaves,
// add one synthetic member in-memory, generate + verify a proof. No DB mutation.
import { poseidon1, poseidon2 } from "poseidon-lite";
import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import pg from "pg";
import { ssl } from "../db/ssl.mjs";

const root = process.cwd();
for (const line of readFileSync(`${root}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DEPTH = 16;
const hashLeaf = (s) => poseidon1([s]);
const hashNode = (l, r) => poseidon2([l, r]);
const voteIdToField = (v) => BigInt("0x" + createHash("sha256").update(v).digest("hex")) % FIELD;
function zeroHashes() { const z = [0n]; for (let i = 1; i <= DEPTH; i++) z[i] = hashNode(z[i-1], z[i-1]); return z; }
function buildTree(leaves) {
  const zeros = zeroHashes(); const levels = [leaves.slice()];
  for (let d = 0; d < DEPTH; d++) {
    const cur = levels[d], next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(hashNode(cur[i], i+1 < cur.length ? cur[i+1] : zeros[d]));
    levels.push(next.length ? next : [zeros[d+1]]);
  }
  return { levels, root: levels[DEPTH].length ? levels[DEPTH][0] : zeros[DEPTH], zeros };
}
function merklePath(levels, zeros, index) {
  const pe = [], pi = []; let idx = index;
  for (let d = 0; d < DEPTH; d++) { const s = idx ^ 1; pe.push((levels[d][s] ?? zeros[d]).toString()); pi.push(idx & 1); idx >>= 1; }
  return { pathElements: pe, pathIndices: pi };
}

const client = new pg.Client({
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE ?? "postgres", ssl,
});
await client.connect();
const { rows } = await client.query(
  `select id_commitment from members where id_commitment is not null order by leaf_index asc nulls last, created_at asc`,
);
await client.end();
console.log(`registered members in DB: ${rows.length}`);

// add a synthetic member at the end (what registerIdentity would do)
const secret = BigInt("0x" + randomBytes(31).toString("hex")) % FIELD;
const leaves = [...rows.map((r) => BigInt(r.id_commitment)), hashLeaf(secret)];
const index = leaves.length - 1;
const { levels, root: troot, zeros } = buildTree(leaves);
const { pathElements, pathIndices } = merklePath(levels, zeros, index);
const voteIdField = voteIdToField("qrm-live-test");

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  { identitySecret: secret.toString(), pathElements, pathIndices, root: troot.toString(), voteId: voteIdField.toString() },
  "public/zk/eligibility.wasm", "public/zk/eligibility.zkey",
);
const vkey = JSON.parse(readFileSync("src/lib/zk/verification_key.json", "utf8"));
const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
console.log("root binds   :", publicSignals[1] === troot.toString());
console.log("voteId binds :", publicSignals[2] === voteIdField.toString());
console.log("server-flow proof verifies:", ok ? "YES ✓" : "NO ✗");
process.exit(ok ? 0 : 1);
