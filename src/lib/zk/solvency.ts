// Client-side ZK solvency proving: prove balance >= threshold without revealing the balance,
// bound to a Poseidon commitment. snarkjs is dynamically imported.
import { poseidon2 } from "poseidon-lite";
import { FIELD } from "./poseidon";

function randField(): bigint {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return x % FIELD;
}

export async function proveSolvency(balance: bigint, threshold: bigint): Promise<{
  proof: Record<string, unknown>; publicSignals: string[]; commitment: string; threshold: string;
}> {
  const blinding = randField();
  const commitment = poseidon2([balance, blinding]).toString();
  const snarkjs = await import("snarkjs");
  const input = {
    balance: balance.toString(), blinding: blinding.toString(),
    threshold: threshold.toString(), commitment,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input, "/zk/solvency.wasm", "/zk/solvency.zkey",
  );
  return { proof, publicSignals, commitment, threshold: threshold.toString() };
}
