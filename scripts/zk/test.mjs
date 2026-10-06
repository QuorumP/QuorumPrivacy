// Validates the compiled eligibility circuit + trusted setup end-to-end:
// build a Merkle tree of member commitments, generate a real Groth16 proof for one
// member, verify it, and confirm a tampered proof fails.
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const DEPTH = 16;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const randField = () => BigInt("0x" + randomBytes(31).toString("hex")) % FIELD;

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (arr) => BigInt(F.toString(poseidon(arr)));

// zero subtree hashes
const zeros = [0n];
for (let i = 1; i <= DEPTH; i++) zeros[i] = H([zeros[i - 1], zeros[i - 1]]);

// build a sparse incremental tree from filled leaves (left to right)
function buildTree(leaves) {
  const levels = [leaves.slice()];
  for (let d = 0; d < DEPTH; d++) {
    const cur = levels[d];
    const next = [];
    for (let i = 0; i < Math.ceil(cur.length / 2) || i === 0; i++) {
      const left = cur[2 * i] ?? zeros[d];
      const right = cur[2 * i + 1] ?? zeros[d];
      next.push(H([left, right]));
      if (2 * i + 2 >= cur.length) break;
    }
    levels.push(next.length ? next : [zeros[d + 1]]);
  }
  return levels;
}
function merklePath(levels, index) {
  const pathElements = [];
  const pathIndices = [];
  let idx = index;
  for (let d = 0; d < DEPTH; d++) {
    const sib = idx ^ 1;
    pathElements.push((levels[d][sib] ?? zeros[d]).toString());
    pathIndices.push(idx & 1);
    idx = idx >> 1;
  }
  return { pathElements, pathIndices };
}

// 5 eligible members
const secrets = Array.from({ length: 5 }, () => randField());
const leaves = secrets.map((s) => H([s]));
const levels = buildTree(leaves);
const root = levels[DEPTH][0];
const k = 2; // prove membership of member #2
const { pathElements, pathIndices } = merklePath(levels, k);
const voteId = randField();

const input = {
  identitySecret: secrets[k].toString(),
  pathElements,
  pathIndices,
  root: root.toString(),
  voteId: voteId.toString(),
};

console.log("root:", root.toString().slice(0, 18), "…");
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input,
  "public/zk/eligibility.wasm",
  "public/zk/eligibility.zkey",
);
console.log("publicSignals [nullifierHash, root, voteId]:");
console.log("  nullifierHash:", publicSignals[0].slice(0, 18), "…");
console.log("  root matches  :", publicSignals[1] === root.toString());
console.log("  voteId matches:", publicSignals[2] === voteId.toString());

const vkey = JSON.parse(readFileSync("src/lib/zk/verification_key.json", "utf8"));
const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
console.log("VALID proof verifies:", ok ? "YES ✓" : "NO ✗");

// tamper: flip the root in the public signals → must fail
const tampered = [...publicSignals];
tampered[1] = (root + 1n).toString();
const bad = await snarkjs.groth16.verify(vkey, tampered, proof);
console.log("TAMPERED proof rejected:", bad ? "NO ✗ (BAD!)" : "YES ✓");

process.exit(ok && !bad ? 0 : 1);
