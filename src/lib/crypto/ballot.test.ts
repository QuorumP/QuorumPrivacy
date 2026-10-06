// Regression tests for the 2026-10-06 audit: ballot validity proofs + canonical nullifiers.
import { describe, it, expect } from "vitest";
import { encrypt, encryptOneHotProved, verifyBallot, publicKeyFromSecret, decrypt } from "./elgamal";
import { isCanonicalField, FIELD } from "../zk/poseidon";

const secret = 123456789n;
const P = publicKeyFromSecret(secret);
const ctx = "qrm-abc123|42";

describe("ballot validity proofs", () => {
  it("accepts an honest one-hot ballot that decrypts to the choice", () => {
    const { cts, proof } = encryptOneHotProved(P, 1, 3, ctx);
    expect(verifyBallot(P, cts, proof, ctx)).toBe(true);
    expect(cts.map((c) => decrypt(secret, c))).toEqual([0, 1, 0]);
  });

  it("rejects an entry that encrypts 2 (vote inflation)", () => {
    const { cts, proof } = encryptOneHotProved(P, 0, 3, ctx);
    cts[0] = encrypt(P, 2);
    expect(verifyBallot(P, cts, proof, ctx)).toBe(false);
  });

  it("rejects a row of valid bits that sums to 2", () => {
    const a = encryptOneHotProved(P, 0, 3, ctx);
    const b = encryptOneHotProved(P, 1, 3, ctx);
    const cts = [a.cts[0], b.cts[1], a.cts[2]]; // [1,1,0] — every bit proof holds on its own
    const proof = { bits: [a.proof.bits[0], b.proof.bits[1], a.proof.bits[2]], sum: a.proof.sum };
    expect(verifyBallot(P, cts, proof, ctx)).toBe(false);
  });

  it("rejects a proof replayed under another vote or nullifier", () => {
    const { cts, proof } = encryptOneHotProved(P, 2, 3, ctx);
    expect(verifyBallot(P, cts, proof, "qrm-abc123|43")).toBe(false);
  });

  it("rejects tampered scalars and throws on non-point hex", () => {
    const { cts, proof } = encryptOneHotProved(P, 2, 3, ctx);
    const bad = { ...proof, sum: { ...proof.sum, z: (BigInt(proof.sum.z) + 1n).toString() } };
    expect(verifyBallot(P, cts, bad, ctx)).toBe(false);
    expect(() => verifyBallot(P, [{ c1: "ff".repeat(32), c2: cts[0].c2 }, cts[1], cts[2]], proof, ctx)).toThrow();
  });
});

describe("canonical field strings (nullifier aliasing)", () => {
  it("accepts only one spelling per field element", () => {
    expect(isCanonicalField("0")).toBe(true);
    expect(isCanonicalField("123")).toBe(true);
    expect(isCanonicalField("0123")).toBe(false); // snarkjs reads this as 123
    expect(isCanonicalField("0x7b")).toBe(false); // ...and this
    expect(isCanonicalField(FIELD.toString())).toBe(false); // = 0 mod r
    expect(isCanonicalField("")).toBe(false);
  });
});
