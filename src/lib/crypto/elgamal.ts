// Exponential ElGamal over Ristretto255 — additively homomorphic, so encrypted ballots can
// be summed and the per-option totals decrypted at tally time without ever decrypting an
// individual ballot. Isomorphic (browser + server).
//
// Threshold note: today a single tally key holds the secret. The scheme is threshold-ready —
// the secret can be split across tally nodes via DKG and decryption done in MPC (Phase 4);
// nothing about the ciphertext format changes.
import { RistrettoPoint, ed25519 } from "@noble/curves/ed25519";
import { sha512 } from "@noble/hashes/sha512";

const ORDER = ed25519.CURVE.n; // prime group order ℓ
const G = RistrettoPoint.BASE;

export type Ciphertext = { c1: string; c2: string };

function randScalar(): bigint {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return (x % (ORDER - 1n)) + 1n; // 1 ≤ r < ℓ
}

const enc = (p: { toHex: () => string }) => p.toHex();
const dec = (h: string) => RistrettoPoint.fromHex(h);
const mG = (m: number) => (m === 0 ? RistrettoPoint.ZERO : G.multiply(BigInt(m)));

// Encrypt a small integer m (0/1 for one-hot ballots) to public key P.
export function encrypt(pubHex: string, m: number): Ciphertext {
  const P = dec(pubHex);
  const r = randScalar();
  return { c1: enc(G.multiply(r)), c2: enc(mG(m).add(P.multiply(r))) };
}

// One-hot encode a choice over n options as n ciphertexts of 0/1.
export function encryptOneHot(pubHex: string, choice: number, n: number): Ciphertext[] {
  return Array.from({ length: n }, (_, i) => encrypt(pubHex, i === choice ? 1 : 0));
}

// ── Ballot validity proofs ────────────────────────────────────────────
// Without these, a ballot could encrypt 1000 (or -5) instead of 0/1 and the homomorphic tally
// would count it. The voter proves, without revealing the choice:
//   • each ciphertext encrypts 0 or 1  — disjunctive Chaum-Pedersen (CDS OR-proof)
//   • the row sums to exactly 1        — Chaum-Pedersen on the summed ciphertext
// Fiat-Shamir challenges bind `context` (voteId|nullifier) so a proof can't be replayed onto
// another ballot. Scalars travel as decimal strings.
type Pt = InstanceType<typeof RistrettoPoint>;
const mod = (x: bigint) => ((x % ORDER) + ORDER) % ORDER;
const mul = (P: Pt, s: bigint): Pt => { const k = mod(s); return k === 0n ? RistrettoPoint.ZERO : P.multiply(k); };

function challenge(context: string, ...pts: Pt[]): bigint {
  const parts = [new TextEncoder().encode(context), ...pts.map((p) => p.toRawBytes())];
  const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  let x = 0n;
  for (const v of sha512(buf)) x = (x << 8n) | BigInt(v);
  return mod(x);
}

export type BitProof = { c0: string; c1: string; z0: string; z1: string };
export type BallotProof = { bits: BitProof[]; sum: { c: string; z: string } };

// For bit k the statement is (A, B − k·G) = (r·G, r·P). Rebuild the prover's commitments.
const bitCommit = (P: Pt, A: Pt, B: Pt, k: number, c: bigint, z: bigint): [Pt, Pt] =>
  [mul(G, z).subtract(mul(A, c)), mul(P, z).subtract(mul(k === 0 ? B : B.subtract(G), c))];

function proveBit(P: Pt, A: Pt, B: Pt, m: 0 | 1, r: bigint, context: string): BitProof {
  const fake = (1 - m) as 0 | 1;
  const cF = randScalar(), zF = randScalar();
  const [aF, bF] = bitCommit(P, A, B, fake, cF, zF);
  const w = randScalar();
  const [aR, bR] = [mul(G, w), mul(P, w)];
  const [a0, b0, a1, b1] = m === 0 ? [aR, bR, aF, bF] : [aF, bF, aR, bR];
  const c = challenge(context, P, A, B, a0, b0, a1, b1);
  const cR = mod(c - cF), zR = mod(w + cR * r);
  const [c0, c1, z0, z1] = m === 0 ? [cR, cF, zR, zF] : [cF, cR, zF, zR];
  return { c0: c0.toString(), c1: c1.toString(), z0: z0.toString(), z1: z1.toString() };
}

function verifyBit(P: Pt, A: Pt, B: Pt, p: BitProof, context: string): boolean {
  const [c0, c1, z0, z1] = [p.c0, p.c1, p.z0, p.z1].map((s) => mod(BigInt(s)));
  const [a0, b0] = bitCommit(P, A, B, 0, c0, z0);
  const [a1, b1] = bitCommit(P, A, B, 1, c1, z1);
  return mod(c0 + c1) === challenge(context, P, A, B, a0, b0, a1, b1);
}

// One-hot ballot + validity proof. `context` must be what the verifier will use (voteId|nullifier).
export function encryptOneHotProved(pubHex: string, choice: number, n: number, context: string) {
  const P = dec(pubHex);
  const rs = Array.from({ length: n }, () => randScalar());
  const ms = rs.map((_, i) => (i === choice ? 1 : 0) as 0 | 1);
  const pts = rs.map((r, i) => ({ A: mul(G, r), B: mGb(ms[i]).add(mul(P, r)) }));
  const bits = pts.map(({ A, B }, i) => proveBit(P, A, B, ms[i], rs[i], context));
  const R = rs.reduce((s, r) => mod(s + r), 0n);
  const As = pts.reduce((s, p) => s.add(p.A), RistrettoPoint.ZERO);
  const Bs = pts.reduce((s, p) => s.add(p.B), RistrettoPoint.ZERO).subtract(G);
  const k = randScalar();
  const c = challenge(context + "|sum", P, As, Bs, mul(G, k), mul(P, k));
  const cts: Ciphertext[] = pts.map(({ A, B }) => ({ c1: enc(A), c2: enc(B) }));
  return { cts, proof: { bits, sum: { c: c.toString(), z: mod(k + c * R).toString() } } as BallotProof };
}

// Throws on malformed input (bad hex / non-points); returns false on a proof that doesn't hold.
export function verifyBallot(pubHex: string, cts: Ciphertext[], proof: BallotProof, context: string): boolean {
  if (cts.length === 0 || proof.bits.length !== cts.length) return false;
  const P = dec(pubHex);
  const pts = cts.map((c) => ({ A: dec(c.c1), B: dec(c.c2) }));
  if (!pts.every(({ A, B }, i) => verifyBit(P, A, B, proof.bits[i], context))) return false;
  const As = pts.reduce((s, p) => s.add(p.A), RistrettoPoint.ZERO);
  const Bs = pts.reduce((s, p) => s.add(p.B), RistrettoPoint.ZERO).subtract(G);
  const c = mod(BigInt(proof.sum.c)), z = mod(BigInt(proof.sum.z));
  const t1 = mul(G, z).subtract(mul(As, c));
  const t2 = mul(P, z).subtract(mul(Bs, c));
  return challenge(context + "|sum", P, As, Bs, t1, t2) === c;
}

const mGb = (m: 0 | 1) => (m === 0 ? RistrettoPoint.ZERO : G);

// Re-randomize a ciphertext (receipt-freeness): identical plaintext, fresh randomness, so the
// voter cannot prove to a briber what they submitted.
export function rerandomize(pubHex: string, ct: Ciphertext): Ciphertext {
  const P = dec(pubHex);
  const r = randScalar();
  return { c1: enc(dec(ct.c1).add(G.multiply(r))), c2: enc(dec(ct.c2).add(P.multiply(r))) };
}

export const rerandomizeAll = (pubHex: string, cts: Ciphertext[]): Ciphertext[] =>
  cts.map((c) => rerandomize(pubHex, c));

// Homomorphic sum of ciphertexts (component-wise) — used at tally.
export function addCiphertexts(cts: Ciphertext[]): Ciphertext {
  let a = RistrettoPoint.ZERO;
  let b = RistrettoPoint.ZERO;
  for (const c of cts) { a = a.add(dec(c.c1)); b = b.add(dec(c.c2)); }
  return { c1: enc(a), c2: enc(b) };
}

// Keypair from a secret scalar.
export function publicKeyFromSecret(secret: bigint): string {
  return enc(G.multiply(secret));
}

// Decrypt m where m·G = c2 − s·c1, recovering the small count via baby-step discrete log.
export function decrypt(secret: bigint, ct: Ciphertext, max = 1_000_000): number {
  const M = dec(ct.c2).subtract(dec(ct.c1).multiply(secret));
  let acc = RistrettoPoint.ZERO;
  for (let m = 0; m <= max; m++) {
    if (acc.equals(M)) return m;
    acc = acc.add(G);
  }
  throw new Error("DLOG_OUT_OF_RANGE");
}
