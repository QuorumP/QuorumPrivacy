// Isomorphic ZK helpers (browser + server). Pure JS via poseidon-lite, whose Poseidon
// matches circomlib exactly (verified) — so trees built here agree with the circuit.
import { poseidon1, poseidon2 } from "poseidon-lite";

export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DEPTH = 16;

// One canonical decimal spelling per field element. snarkjs parses "007", "0x7" and "7" to the
// same value, so anything stored or compared as text (nullifiers!) must be canonical first.
export const isCanonicalField = (s: string) => /^(0|[1-9]\d*)$/.test(s) && BigInt(s) < FIELD;

export const hashLeaf = (secret: bigint) => poseidon1([secret]);
export const hashNode = (l: bigint, r: bigint) => poseidon2([l, r]);

export function zeroHashes(depth = DEPTH): bigint[] {
  const z: bigint[] = [0n];
  for (let i = 1; i <= depth; i++) z[i] = hashNode(z[i - 1], z[i - 1]);
  return z;
}

// Build a left-filled binary Merkle tree; empty siblings use the zero-subtree hash.
export function buildTree(leaves: bigint[], depth = DEPTH) {
  const zeros = zeroHashes(depth);
  const levels: bigint[][] = [leaves.slice()];
  for (let d = 0; d < depth; d++) {
    const cur = levels[d];
    const next: bigint[] = [];
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

export function merklePath(
  levels: bigint[][],
  zeros: bigint[],
  index: number,
  depth = DEPTH,
) {
  const pathElements: string[] = [];
  const pathIndices: number[] = [];
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
