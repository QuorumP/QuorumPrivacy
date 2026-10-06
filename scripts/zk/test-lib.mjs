// Validates the exact poseidon.ts algorithm (poseidon-lite + clean buildTree/merklePath)
// against the compiled circuit. Run with: node scripts/zk/test-lib.mjs
import { poseidon1, poseidon2 } from "poseidon-lite";
import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";

// --- inlined byte-for-byte from src/lib/zk/poseidon.ts ---
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
    const cur = levels[d];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      const left = cur[i];
      const right = i + 1 < cur.length ? cur[i + 1] : zeros[d];
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
// ---------------------------------------------------------

const randField = () => BigInt("0x" + randomBytes(31).toString("hex")) % FIELD;
const voteIdToField = (v) => BigInt("0x" + createHash("sha256").update(v).digest("hex")) % FIELD;

const secrets = Array.from({ length: 7 }, () => randField());
const leaves = secrets.map(hashLeaf);
const { levels, root, zeros } = buildTree(leaves);

const k = 4;
const { pathElements, pathIndices } = merklePath(levels, zeros, k);
const voteIdField = voteIdToField("qrm-demo-001");
const input = {
  identitySecret: secrets[k].toString(),
  pathElements, pathIndices,
  root: root.toString(), voteId: voteIdField.toString(),
};

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input, "public/zk/eligibility.wasm", "public/zk/eligibility.zkey",
);
const vkey = JSON.parse(readFileSync("src/lib/zk/verification_key.json", "utf8"));
const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
console.log("root matches  :", publicSignals[1] === root.toString());
console.log("voteId matches:", publicSignals[2] === voteIdField.toString());
console.log("lib tree -> valid proof verifies:", ok ? "YES ✓" : "NO ✗");

let nonMemberRejected = false;
try {
  const bad = await snarkjs.groth16.fullProve(
    { ...input, identitySecret: randField().toString() },
    "public/zk/eligibility.wasm", "public/zk/eligibility.zkey",
  );
  nonMemberRejected = !(await snarkjs.groth16.verify(vkey, bad.publicSignals, bad.proof));
} catch { nonMemberRejected = true; }
console.log("non-member rejected:", nonMemberRejected ? "YES ✓" : "NO ✗");

process.exit(ok && nonMemberRejected ? 0 : 1);
