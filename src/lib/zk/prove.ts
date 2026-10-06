// Client-side ZK proving. Derives a deterministic private identity from a wallet signature
// and generates an in-browser Groth16 eligibility proof. snarkjs is dynamically imported so
// it never weighs on SSR / initial load.
import { hashLeaf, FIELD } from "./poseidon";

const IDENTITY_MSG =
  "QUORUM identity v1 — sign to derive your private voting key. Do not share this signature.";

// ed25519 signatures are deterministic, so the same wallet always derives the same secret.
export async function deriveIdentity(signRaw: (m: Uint8Array) => Promise<Uint8Array>) {
  const sig = await signRaw(new TextEncoder().encode(IDENTITY_MSG));
  const digest = await crypto.subtle.digest("SHA-256", sig as BufferSource);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const secret = BigInt("0x" + hex) % FIELD;
  return { secret: secret.toString(), commitment: hashLeaf(secret).toString() };
}

export async function proveEligibility(args: {
  secret: string;
  root: string;
  pathElements: string[];
  pathIndices: number[];
  voteIdField: string;
}): Promise<{ proof: Record<string, unknown>; publicSignals: string[] }> {
  const snarkjs = await import("snarkjs");
  const input = {
    identitySecret: args.secret,
    pathElements: args.pathElements,
    pathIndices: args.pathIndices,
    root: args.root,
    voteId: args.voteIdField,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    "/zk/eligibility.wasm",
    "/zk/eligibility.zkey",
  );
  return { proof, publicSignals };
}
