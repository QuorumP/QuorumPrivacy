// Server-side Groth16 verification of eligibility proofs. Server-only (snarkjs + the
// verifying key). Never reaches the client bundle (import-protection enforces *.server.*).
import * as snarkjs from "snarkjs";
import { createHash } from "node:crypto";
import { FIELD } from "./poseidon";
import vkey from "./verification_key.json";
import solvencyVkey from "./solvency_vkey.json";

// Map a human vote id (e.g. "qrm-ab12") to the field element the circuit binds as `voteId`.
export function voteIdToField(voteId: string): bigint {
  return BigInt("0x" + createHash("sha256").update(voteId).digest("hex")) % FIELD;
}

export type Groth16Proof = {
  proof: Record<string, unknown>;
  publicSignals: string[]; // [nullifierHash, root, voteId]
};

// Vercel serves an ESM serverless bundle where `__filename` is undefined. snarkjs/ffjavascript
// tries to spawn a Worker thread (whose builder references `__filename`) when it lazily builds
// the bn128 curve inside groth16.verify — throwing "__filename is not defined", which the callers'
// try/catch swallowed as a rejected proof. Fix: build the curve ONCE in single-thread mode (no
// Worker) and stash it on globalThis.curve_bn128, which ffjavascript's buildBn128 returns directly
// on later calls — so verify never touches worker_threads. Memoized; safe in Node too.
let bn128Ready: Promise<void> | null = null;
function ensureBn128(): Promise<void> {
  if (!bn128Ready) {
    bn128Ready = (async () => {
      const g = globalThis as { curve_bn128?: unknown };
      if (!g.curve_bn128) {
        g.curve_bn128 = await (
          snarkjs as unknown as {
            curves: { getCurveFromName: (n: string, o: { singleThread: boolean }) => Promise<unknown> };
          }
        ).curves.getCurveFromName("bn128", { singleThread: true });
      }
    })();
  }
  return bn128Ready;
}

export async function verifyEligibility(p: Groth16Proof): Promise<boolean> {
  if (!Array.isArray(p.publicSignals) || p.publicSignals.length !== 3) return false;
  try {
    await ensureBn128();
    return await snarkjs.groth16.verify(vkey as object, p.publicSignals, p.proof);
  } catch (e) {
    console.error("[verifyEligibility] threw:", (e as Error)?.message);
    return false;
  }
}

// publicSignals = [threshold, commitment]
export async function verifySolvency(
  proof: Record<string, unknown>,
  publicSignals: string[],
): Promise<boolean> {
  if (!Array.isArray(publicSignals) || publicSignals.length !== 2) return false;
  try {
    await ensureBn128();
    return await snarkjs.groth16.verify(solvencyVkey as object, publicSignals, proof);
  } catch (e) {
    console.error("[verifySolvency] threw:", (e as Error)?.message);
    return false;
  }
}
