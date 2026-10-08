// Submits a REAL snarkjs solvency proof to the deployed on-chain `verify_solvency` instruction
// on devnet (alt_bn128 pairing in the quorum_anchor program), signed by the authority — the only
// key the instruction accepts. Mirrors src/lib/solana/groth16.server.ts exactly. Negative tests:
// a tampered proof fails, and a valid proof signed by any other key is refused (Unauthorized).
import {
  Connection, Keypair, PublicKey, TransactionInstruction, Transaction, ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { poseidon2 } from "poseidon-lite";
import * as snarkjs from "snarkjs";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const idl = JSON.parse(readFileSync(`${ROOT}/src/lib/solana/idl.json`));
const PROGRAM_ID = new PublicKey(idl.address);
const RPC = "https://api.devnet.solana.com";

const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const be32 = (dec) => Buffer.from(BigInt(dec).toString(16).padStart(64, "0"), "hex");
const g1 = (p) => Buffer.concat([be32(p[0]), be32(p[1])]);
const g1neg = (p) => Buffer.concat([be32(p[0]), be32(((P - (BigInt(p[1]) % P)) % P).toString())]);
const g2 = (p) => Buffer.concat([be32(p[0][1]), be32(p[0][0]), be32(p[1][1]), be32(p[1][0])]);
const DISCRIMINATOR = createHash("sha256").update("global:verify_solvency").digest().subarray(0, 8);

const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${ROOT}/.devnet/qrm-authority.json`))));
const conn = new Connection(RPC, "confirmed");
console.log("program:", PROGRAM_ID.toBase58());
console.log("signer :", signer.publicKey.toBase58());

function buildIx(proof, publicSignals, by = signer) {
  const data = Buffer.concat([
    DISCRIMINATOR, g1neg(proof.pi_a), g2(proof.pi_b), g1(proof.pi_c),
    be32(publicSignals[0]), be32(publicSignals[1]),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: by.publicKey, isSigner: true, isWritable: false }],
    data,
  });
}
// `by` signs the instruction; the authority always pays the fee, so `by` needs no SOL.
async function send(proof, publicSignals, by = signer) {
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }))
    .add(buildIx(proof, publicSignals, by));
  return sendAndConfirmTransaction(conn, tx, by === signer ? [signer] : [signer, by], { commitment: "confirmed" });
}

// real proof: balance 5M >= threshold 1M
const balance = 5_000_000n, threshold = 1_000_000n, blinding = 987654321n;
const commitment = poseidon2([balance, blinding]).toString();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  { balance: balance.toString(), blinding: blinding.toString(), threshold: threshold.toString(), commitment },
  `${ROOT}/public/zk/solvency.wasm`, `${ROOT}/public/zk/solvency.zkey`,
);

console.log("\n[on-chain #1] submit VALID proof → expect tx success");
try {
  const sig = await send(proof, publicSignals);
  console.log("  ✓ VALID proof accepted on-chain");
  console.log("  tx:", sig);
  console.log("  explorer: https://explorer.solana.com/tx/" + sig + "?cluster=devnet");
} catch (e) {
  console.log("  ✗ valid proof was rejected:", e.message);
  process.exit(1);
}

console.log("\n[on-chain #2] submit TAMPERED proof (commitment+1) → expect tx failure");
try {
  const sig = await send(proof, [publicSignals[0], (BigInt(publicSignals[1]) + 1n).toString()]);
  console.log("  ✗ tampered proof was ACCEPTED (should have failed!) tx:", sig);
  process.exit(1);
} catch {
  console.log("  ✓ tampered proof REJECTED on-chain (pairing check fails → tx errors)");
}
console.log("\n[on-chain #3] VALID proof signed by another key → expect Unauthorized");
try {
  const sig = await send(proof, publicSignals, Keypair.generate());
  console.log("  ✗ non-authority proof was ACCEPTED tx:", sig);
  process.exit(1);
} catch (e) {
  const why = `${e?.message} ${(e?.logs ?? e?.transactionLogs ?? []).join(" ")}`;
  if (!/0x1771|Unauthorized/.test(why)) { console.log("  ✗ failed for another reason:", why); process.exit(1); }
  console.log("  ✓ non-authority REJECTED (Unauthorized)");
}
console.log("\n[on-chain] deployed Groth16 verifier: PASS");
process.exit(0); // the RPC client keeps sockets open
