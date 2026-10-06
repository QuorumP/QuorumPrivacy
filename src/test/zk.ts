// Node-side Groth16 proving for tests: the same circuits and zkeys the browser uses.
import * as snarkjs from "snarkjs";
import { resolve } from "node:path";
import { poseidon2 } from "poseidon-lite";
import { randomBytes } from "node:crypto";
import { FIELD, hashLeaf } from "../lib/zk/poseidon";

const ZK = resolve(__dirname, "../../public/zk");
type Proof = { proof: Record<string, unknown>; publicSignals: string[] };

export const randField = () => BigInt("0x" + randomBytes(31).toString("hex")) % FIELD;

export function newIdentity() {
  const secret = randField();
  return { secret: secret.toString(), commitment: hashLeaf(secret).toString() };
}

export async function proveEligibility(secret: string, w: {
  root: string; pathElements: string[]; pathIndices: number[]; voteIdField: string;
}): Promise<Proof> {
  return snarkjs.groth16.fullProve(
    { identitySecret: secret, pathElements: w.pathElements, pathIndices: w.pathIndices, root: w.root, voteId: w.voteIdField },
    `${ZK}/eligibility.wasm`, `${ZK}/eligibility.zkey`,
  ) as Promise<Proof>;
}

export async function proveSolvency(balance: bigint, threshold: bigint): Promise<Proof & { commitment: string }> {
  const blinding = randField();
  const commitment = poseidon2([balance, blinding]).toString();
  const r = await snarkjs.groth16.fullProve(
    { balance: balance.toString(), blinding: blinding.toString(), threshold: threshold.toString(), commitment },
    `${ZK}/solvency.wasm`, `${ZK}/solvency.zkey`,
  );
  return { ...(r as Proof), commitment };
}
