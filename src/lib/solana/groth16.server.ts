// Server-side: submit a snarkjs Groth16 solvency proof to the on-chain `verify_solvency`
// instruction on devnet (alt_bn128 pairing). Best-effort — callers treat failure as non-fatal.
// The authority signs (anti-spam); the instruction changes no state, it just fails the tx if the
// proof is invalid, giving a public, verifiable on-chain attestation that reserves >= threshold.
import { Connection, Keypair, PublicKey, TransactionInstruction, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import idl from "./idl.json";

const PROGRAM_ID = (idl as { address: string }).address;

const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const be32 = (dec: string) => Buffer.from(BigInt(dec).toString(16).padStart(64, "0"), "hex");
const g1 = (p: string[]) => Buffer.concat([be32(p[0]), be32(p[1])]);
const g1neg = (p: string[]) => Buffer.concat([be32(p[0]), be32(((P - (BigInt(p[1]) % P)) % P).toString())]);
const g2 = (p: string[][]) => Buffer.concat([be32(p[0][1]), be32(p[0][0]), be32(p[1][1]), be32(p[1][0])]);

const DISCRIMINATOR = createHash("sha256").update("global:verify_solvency").digest().subarray(0, 8);

type SnarkProof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

export function groth16OnChainConfigured(): boolean {
  return !!process.env.ANCHOR_AUTHORITY_SECRET && !!PROGRAM_ID;
}

/** Verify a solvency proof on devnet. Returns the tx signature, or throws on invalid/RPC error. */
export async function verifySolvencyOnChain(proof: SnarkProof, publicSignals: string[]): Promise<string> {
  const secret = process.env.ANCHOR_AUTHORITY_SECRET;
  if (!secret || !PROGRAM_ID) throw new Error("ONCHAIN_NOT_CONFIGURED");
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  const conn = new Connection(process.env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");

  const data = Buffer.concat([
    DISCRIMINATOR,
    g1neg(proof.pi_a),          // proof_a (pre-negated for the pairing)
    g2(proof.pi_b),             // proof_b
    g1(proof.pi_c),             // proof_c
    be32(publicSignals[0]),     // threshold
    be32(publicSignals[1]),     // commitment
  ]);
  const ix = new TransactionInstruction({
    programId: new PublicKey(PROGRAM_ID),
    keys: [{ pubkey: authority.publicKey, isSigner: true, isWritable: false }],
    data,
  });
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }))
    .add(ix);
  return sendAndConfirmTransaction(conn, tx, [authority], { commitment: "confirmed" });
}
