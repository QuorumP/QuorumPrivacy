// Validates the solvency circuit: balance >= threshold proves+verifies; balance < threshold fails.
import { poseidon2 } from "poseidon-lite";
import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";

const vkey = JSON.parse(readFileSync("src/lib/zk/solvency_vkey.json", "utf8"));
const prove = async (balance, threshold) => {
  const blinding = 1234567890123456789n;
  const commitment = poseidon2([balance, blinding]);
  const input = { balance: balance.toString(), blinding: blinding.toString(), threshold: threshold.toString(), commitment: commitment.toString() };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, "public/zk/solvency.wasm", "public/zk/solvency.zkey");
  return { proof, publicSignals, commitment };
};

// solvent: 1,250,000 >= 1,000,000
const ok1 = await prove(1_250_000n, 1_000_000n);
const v1 = await snarkjs.groth16.verify(vkey, ok1.publicSignals, ok1.proof);
console.log("solvent proof verifies:", v1 ? "YES ✓" : "NO ✗");
console.log("  publicSignals [threshold, commitment]:", ok1.publicSignals[0], "/", ok1.publicSignals[1].slice(0, 12) + "…");

// insolvent: 500,000 < 1,000,000 -> circuit must fail to produce a valid witness
let insolventRejected = false;
try {
  await prove(500_000n, 1_000_000n);
} catch { insolventRejected = true; }
console.log("insolvent rejected:", insolventRejected ? "YES ✓" : "NO ✗");

process.exit(v1 && insolventRejected ? 0 : 1);
