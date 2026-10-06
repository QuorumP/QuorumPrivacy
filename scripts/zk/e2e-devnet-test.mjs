// End-to-end ZK test using the REAL production artifacts in public/zk (wasm + zkey + vkeys).
// Mirrors the app: eligibility (Merkle membership + nullifier) and solvency (range proof).
import { poseidon1, poseidon2 } from "poseidon-lite";
import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DEPTH = 16;
const hashLeaf = (s) => poseidon1([s]);
const hashNode = (l, r) => poseidon2([l, r]);

function zeroHashes(depth = DEPTH) {
  const z = [0n];
  for (let i = 1; i <= depth; i++) z[i] = hashNode(z[i - 1], z[i - 1]);
  return z;
}
function buildTree(leaves, depth = DEPTH) {
  const zeros = zeroHashes(depth);
  const levels = [leaves.slice()];
  for (let d = 0; d < depth; d++) {
    const cur = levels[d], next = [];
    for (let i = 0; i < cur.length; i += 2) {
      const left = cur[i], right = i + 1 < cur.length ? cur[i + 1] : zeros[d];
      next.push(hashNode(left, right));
    }
    levels.push(next.length ? next : [zeros[d + 1]]);
  }
  const root = levels[depth].length ? levels[depth][0] : zeros[depth];
  return { levels, root, zeros };
}
function merklePath(levels, zeros, index, depth = DEPTH) {
  const pathElements = [], pathIndices = [];
  let idx = index;
  for (let d = 0; d < depth; d++) {
    const sib = idx ^ 1;
    const node = levels[d][sib];
    pathElements.push((node !== undefined ? node : zeros[d]).toString());
    pathIndices.push(idx & 1);
    idx = idx >> 1;
  }
  return { pathElements, pathIndices };
}
const voteIdToField = (v) => BigInt("0x" + createHash("sha256").update(v).digest("hex")) % FIELD;

const elVkey = JSON.parse(readFileSync(`${ROOT}/src/lib/zk/verification_key.json`));
const solVkey = JSON.parse(readFileSync(`${ROOT}/src/lib/zk/solvency_vkey.json`));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

// ── ELIGIBILITY ───────────────────────────────────────────────
console.log("\n[eligibility] real Groth16 over public/zk/eligibility.{wasm,zkey}");
const secrets = [111n, 222n, 333n, 444n]; // 4 members
const leaves = secrets.map(hashLeaf);
const tree = buildTree(leaves);
const memberIdx = 2;                       // prove membership of member #2
const secret = secrets[memberIdx];
const { pathElements, pathIndices } = merklePath(tree.levels, tree.zeros, memberIdx);
const voteId = "qrm-test-e2e";
const voteIdField = voteIdToField(voteId).toString();

const input = {
  identitySecret: secret.toString(),
  pathElements, pathIndices,
  root: tree.root.toString(),
  voteId: voteIdField,
};
const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input, `${ROOT}/public/zk/eligibility.wasm`, `${ROOT}/public/zk/eligibility.zkey`,
);
console.log(`  proof generated in ${Date.now() - t0}ms  publicSignals=[nullifier,root,voteId]`);
const expectedNullifier = poseidon2([secret, BigInt(voteIdField)]).toString();
ok(publicSignals[1] === tree.root.toString(), "public root matches computed Merkle root");
ok(publicSignals[2] === voteIdField, "public voteId matches sha256→field binding");
ok(publicSignals[0] === expectedNullifier, "nullifier == Poseidon(secret, voteId)");
ok(await snarkjs.groth16.verify(elVkey, publicSignals, proof), "valid proof VERIFIES against vkey");

// negative: tamper a public signal (wrong root) → must fail
ok(!(await snarkjs.groth16.verify(elVkey, [publicSignals[0], (BigInt(publicSignals[1]) + 1n).toString(), publicSignals[2]], proof)),
   "tampered root REJECTED (fails closed)");
// negative: non-member secret cannot produce a valid path to this root
try {
  const badPath = merklePath(tree.levels, tree.zeros, memberIdx);
  const badInput = { identitySecret: "999999", pathElements: badPath.pathElements, pathIndices: badPath.pathIndices, root: tree.root.toString(), voteId: voteIdField };
  await snarkjs.groth16.fullProve(badInput, `${ROOT}/public/zk/eligibility.wasm`, `${ROOT}/public/zk/eligibility.zkey`);
  ok(false, "non-member proof generation should have thrown (root mismatch constraint)");
} catch { ok(true, "non-member CANNOT generate a proof (mp.root === root constraint holds)"); }

// ── SOLVENCY ──────────────────────────────────────────────────
console.log("\n[solvency] real Groth16 over public/zk/solvency.{wasm,zkey}");
const balance = 5_000_000n, threshold = 1_000_000n;
const blinding = 123456789n;
const commitment = poseidon2([balance, blinding]).toString();
const s0 = Date.now();
const sol = await snarkjs.groth16.fullProve(
  { balance: balance.toString(), blinding: blinding.toString(), threshold: threshold.toString(), commitment },
  `${ROOT}/public/zk/solvency.wasm`, `${ROOT}/public/zk/solvency.zkey`,
);
console.log(`  proof generated in ${Date.now() - s0}ms  publicSignals=[threshold,commitment]`);
ok(sol.publicSignals[0] === threshold.toString(), "public threshold correct");
ok(sol.publicSignals[1] === commitment, "public commitment == Poseidon(balance,blinding)");
ok(await snarkjs.groth16.verify(solVkey, sol.publicSignals, sol.proof), "solvent proof (5M ≥ 1M) VERIFIES");

// negative: balance < threshold must be unprovable (64-bit range fails)
try {
  const under = 500_000n;
  const uc = poseidon2([under, blinding]).toString();
  await snarkjs.groth16.fullProve(
    { balance: under.toString(), blinding: blinding.toString(), threshold: threshold.toString(), commitment: uc },
    `${ROOT}/public/zk/solvency.wasm`, `${ROOT}/public/zk/solvency.zkey`);
  ok(false, "insolvent proof should have been unprovable");
} catch { ok(true, "insolvent balance (500k < 1M) CANNOT be proven (range constraint fails closed)"); }

console.log(`\n[zk] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
