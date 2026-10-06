// Threshold ElGamal over Ristretto255: a (t, n) tally key where no single party holds the
// secret. Uses a Pedersen-style DKG (every node contributes; the group secret is never
// assembled in one place) and Shamir shares over the scalar field. Decryption combines t
// partial decryptions via Lagrange interpolation. Isomorphic (browser + server).
import { RistrettoPoint, ed25519 } from "@noble/curves/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import type { Ciphertext } from "./elgamal";

const ORDER = ed25519.CURVE.n;
const G = RistrettoPoint.BASE;
const mod = (x: bigint) => ((x % ORDER) + ORDER) % ORDER;
type Pt = InstanceType<typeof RistrettoPoint>;
const mul = (P: Pt, s: bigint): Pt => { const k = mod(s); return k === 0n ? RistrettoPoint.ZERO : P.multiply(k); };

function randScalar(): bigint {
  const b = new Uint8Array(64);
  crypto.getRandomValues(b);
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return mod(x) || 1n;
}

// Evaluate polynomial (coeffs[0] + coeffs[1]x + …) at x, mod ORDER.
function polyEval(coeffs: bigint[], x: bigint): bigint {
  let acc = 0n;
  for (let i = coeffs.length - 1; i >= 0; i--) acc = mod(acc * x + coeffs[i]);
  return acc;
}

export type Share = { index: number; value: string }; // value = scalar (decimal string)
export type DkgResult = { pubkey: string; shares: Share[]; t: number; n: number };

// Simulated Pedersen DKG: each of n nodes picks a degree-(t-1) polynomial; node j's share is
// the sum over i of f_i(j). The group secret s = Σ f_i(0) is never computed by any single
// party (we don't assemble it here either). Group pubkey = Σ (f_i(0)·G).
export function pedersenDkg(n: number, t: number): DkgResult {
  if (t < 1 || t > n) throw new Error("require 1 ≤ t ≤ n");
  const shares = new Array(n).fill(0n);
  let pubkey = RistrettoPoint.ZERO;
  for (let i = 0; i < n; i++) {
    const coeffs = Array.from({ length: t }, () => randScalar()); // coeffs[0] = node i's secret a_i
    pubkey = pubkey.add(G.multiply(coeffs[0])); // accumulate a_i·G
    for (let j = 1; j <= n; j++) shares[j - 1] = mod(shares[j - 1] + polyEval(coeffs, BigInt(j)));
  }
  return {
    pubkey: pubkey.toHex(),
    shares: shares.map((v, idx) => ({ index: idx + 1, value: v.toString() })),
    t, n,
  };
}

// A node's partial decryption of a ciphertext: D_i = s_i · C1.
export function partialDecrypt(share: Share, ct: Ciphertext): string {
  return RistrettoPoint.fromHex(ct.c1).multiply(mod(BigInt(share.value))).toHex();
}

// ── Tally correctness: Chaum-Pedersen DLEQ proofs ─────────────────────
// A node proves its partial decryption D_i = s_i·C1 uses the SAME secret s_i committed in its
// verification key Y_i = s_i·G — without revealing s_i. Anyone can then verify the tally was
// decrypted honestly (no trust in the server). Non-interactive via Fiat-Shamir (sha512).
export type DleqProof = { c: string; z: string };
export type PartialProof = { index: number; point: string; vkey: string; proof: DleqProof };

function hashScalar(...pts: Pt[]): bigint {
  const parts = pts.map((p) => p.toRawBytes());
  const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  let x = 0n;
  for (const v of sha512(buf)) x = (x << 8n) | BigInt(v);
  return mod(x);
}

// Prove knowledge of x with Y = x·G and D = x·H (H = C1). Returns (c, z).
function dleqProve(x: bigint, H: Pt): DleqProof {
  const k = randScalar();
  const Y = mul(G, x), D = mul(H, x);
  const c = hashScalar(G, H, Y, D, mul(G, k), mul(H, k));
  return { c: c.toString(), z: mod(k + c * x).toString() };
}

function dleqVerify(Y: Pt, H: Pt, D: Pt, proof: DleqProof): boolean {
  const c = mod(BigInt(proof.c)), z = mod(BigInt(proof.z));
  const R1 = mul(G, z).subtract(mul(Y, c));
  const R2 = mul(H, z).subtract(mul(D, c));
  return hashScalar(G, H, Y, D, R1, R2) === c;
}

// Partial decryption WITH a DLEQ proof + the node's verification key Y_i = s_i·G.
export function partialDecryptWithProof(share: Share, ct: Ciphertext): PartialProof {
  const s = mod(BigInt(share.value));
  const C1 = RistrettoPoint.fromHex(ct.c1);
  return { index: share.index, point: mul(C1, s).toHex(), vkey: mul(G, s).toHex(), proof: dleqProve(s, C1) };
}

/**
 * Verify a tally result is the correct decryption of `ct`, trustlessly:
 *  1. every partial's DLEQ proof is valid (D_i really = s_i·C1 for the s_i behind Y_i);
 *  2. Σ λ_i·Y_i == the committed group public key (binds the Y_i — server can't fake them);
 *  3. C2 − Σ λ_i·D_i == total·G (the decryption yields exactly the announced total).
 */
export function verifyTallyCorrectness(
  groupPubkey: string,
  ct: Ciphertext,
  partials: PartialProof[],
  total: number,
): boolean {
  const C1 = RistrettoPoint.fromHex(ct.c1);
  const C2 = RistrettoPoint.fromHex(ct.c2);
  const indices = partials.map((p) => p.index);
  let combY = RistrettoPoint.ZERO;
  let sC1 = RistrettoPoint.ZERO;
  for (const p of partials) {
    const Y = RistrettoPoint.fromHex(p.vkey);
    const D = RistrettoPoint.fromHex(p.point);
    if (!dleqVerify(Y, C1, D, p.proof)) return false;            // (1)
    const lambda = lagrangeAtZero(indices, p.index);
    combY = combY.add(mul(Y, lambda));
    sC1 = sC1.add(mul(D, lambda));
  }
  if (!combY.equals(RistrettoPoint.fromHex(groupPubkey))) return false; // (2)
  return C2.subtract(sC1).equals(mul(G, BigInt(total)));               // (3)
}

// Lagrange coefficient λ_i(0) for the given participant index set, mod ORDER.
function lagrangeAtZero(indices: number[], i: number): bigint {
  let num = 1n;
  let den = 1n;
  for (const j of indices) {
    if (j === i) continue;
    num = mod(num * BigInt(j));
    den = mod(den * BigInt(j - i));
  }
  // modular inverse of den
  return mod(num * modInverse(den, ORDER));
}

function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [mod(a), m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return mod(old_s);
}

// Combine t partial decryptions { index, point } to recover s·C1, then m·G = C2 − s·C1,
// then m via baby-step discrete log (counts are small).
export function thresholdDecrypt(
  partials: { index: number; point: string }[],
  ct: Ciphertext,
  max = 1_000_000,
): number {
  const indices = partials.map((p) => p.index);
  let sC1 = RistrettoPoint.ZERO;
  for (const p of partials) {
    const lambda = lagrangeAtZero(indices, p.index);
    sC1 = sC1.add(RistrettoPoint.fromHex(p.point).multiply(lambda));
  }
  const M = RistrettoPoint.fromHex(ct.c2).subtract(sC1);
  let acc = RistrettoPoint.ZERO;
  for (let m = 0; m <= max; m++) {
    if (acc.equals(M)) return m;
    acc = acc.add(G);
  }
  throw new Error("DLOG_OUT_OF_RANGE");
}
