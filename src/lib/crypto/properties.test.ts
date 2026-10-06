// Property tests: each property is checked over many random inputs (fresh randomness per run;
// failures print the offending input). Complements the example-based crypto.test.ts.
import { describe, it, expect } from "vitest";
import { randomBytes, randomInt, createHash } from "node:crypto";
import {
  encrypt, decrypt, addCiphertexts, rerandomize, publicKeyFromSecret, encryptOneHotProved, verifyBallot,
  type BallotProof,
} from "./elgamal";
import { pedersenDkg, partialDecryptWithProof, thresholdDecrypt, verifyTallyCorrectness } from "./threshold";
import { auditorKeypair, eciesEncrypt, eciesDecrypt } from "./ecies";
import { proposalCommit, sealProposal } from "./proposal";
import { buildTree, merklePath, hashLeaf, hashNode, isCanonicalField, FIELD } from "../zk/poseidon";

const RUNS = 25;
const scalar = () => BigInt("0x" + randomBytes(32).toString("hex")) % (2n ** 252n) + 1n;
const times = (n: number, f: (i: number) => void) => { for (let i = 0; i < n; i++) f(i); };
const bump = (s: string) => (BigInt(s) + 1n).toString();

describe("ElGamal properties", () => {
  it("Dec(Enc(m)) = m and Dec(ΣEnc(mᵢ)) = Σmᵢ", () => {
    times(RUNS, () => {
      const sk = scalar(), pk = publicKeyFromSecret(sk);
      const ms = Array.from({ length: randomInt(1, 6) }, () => randomInt(0, 200));
      const cts = ms.map((m) => encrypt(pk, m));
      ms.forEach((m, i) => expect(decrypt(sk, cts[i]), `m=${m}`).toBe(m));
      expect(decrypt(sk, addCiphertexts(cts)), `ms=${ms}`).toBe(ms.reduce((a, b) => a + b, 0));
    });
  });

  it("re-randomization keeps the plaintext and unlinks the ciphertext", () => {
    times(RUNS, () => {
      const sk = scalar(), pk = publicKeyFromSecret(sk), m = randomInt(0, 2);
      const ct = encrypt(pk, m), rr = rerandomize(pk, ct);
      expect(rr.c1).not.toBe(ct.c1);
      expect(rr.c2).not.toBe(ct.c2);
      expect(decrypt(sk, rr)).toBe(m);
    });
  });
});

describe("ballot validity proof properties", () => {
  const sk = scalar(), pk = publicKeyFromSecret(sk);

  it("every honest one-hot ballot verifies, for any choice and context", () => {
    times(RUNS, () => {
      const choice = randomInt(0, 3), ctx = `qrm-${randomBytes(4).toString("hex")}|${randomInt(1e9)}`;
      const { cts, proof } = encryptOneHotProved(pk, choice, 3, ctx);
      expect(verifyBallot(pk, cts, proof, ctx)).toBe(true);
      expect(cts.map((c) => decrypt(sk, c))).toEqual([0, 1, 2].map((i) => (i === choice ? 1 : 0)));
    });
  });

  it("changing any single proof scalar breaks verification", () => {
    times(RUNS, () => {
      const ctx = "v|1";
      const { cts, proof } = encryptOneHotProved(pk, randomInt(0, 3), 3, ctx);
      const p: BallotProof = JSON.parse(JSON.stringify(proof));
      const fields = [...p.bits.flatMap((b, i) => (["c0", "c1", "z0", "z1"] as const).map((k) => [i, k] as const)), ["sum", "c"] as const, ["sum", "z"] as const];
      const [where, key] = fields[randomInt(fields.length)];
      if (where === "sum") p.sum[key as "c" | "z"] = bump(p.sum[key as "c" | "z"]);
      else p.bits[where][key as "c0"] = bump(p.bits[where][key as "c0"]);
      expect(verifyBallot(pk, cts, p, ctx), `${where}.${key}`).toBe(false);
    });
  });

  it("any ballot whose entries aren't a single 1 is rejected", () => {
    times(RUNS, () => {
      const ctx = "v|2";
      const { cts, proof } = encryptOneHotProved(pk, 0, 3, ctx);
      const i = randomInt(0, 3);
      const forged = [...cts];
      forged[i] = encrypt(pk, randomInt(2, 50)); // an over-weighted entry
      expect(verifyBallot(pk, forged, proof, ctx)).toBe(false);
    });
  });
});

describe("threshold decryption properties", () => {
  it("any t of n shares decrypt correctly and the DLEQ transcript verifies", () => {
    times(8, () => {
      const n = randomInt(3, 7), t = randomInt(2, n + 1);
      const { pubkey, shares } = pedersenDkg(n, t);
      const votes = Array.from({ length: randomInt(1, 8) }, () => randomInt(0, 2));
      const sum = addCiphertexts(votes.map((v) => encrypt(pubkey, v)));
      const subset = [...shares].sort(() => Math.random() - 0.5).slice(0, t);
      const partials = subset.map((s) => partialDecryptWithProof(s, sum));
      const total = votes.reduce((a, b) => a + b, 0);
      expect(thresholdDecrypt(partials, sum), `n=${n} t=${t}`).toBe(total);
      expect(verifyTallyCorrectness(pubkey, sum, partials, total)).toBe(true);
      expect(verifyTallyCorrectness(pubkey, sum, partials, total + 1)).toBe(false);
      const p2 = partials.map((p) => ({ ...p, proof: { ...p.proof } }));
      const k = randomInt(t);
      p2[k].proof.z = bump(p2[k].proof.z);
      expect(verifyTallyCorrectness(pubkey, sum, p2, total)).toBe(false);
      const other = pedersenDkg(n, t);
      expect(verifyTallyCorrectness(other.pubkey, sum, partials, total)).toBe(false); // bound to the group key
    });
  });
});

describe("ECIES properties", () => {
  it("roundtrips any text for the right key; any tamper or wrong key throws", async () => {
    for (let i = 0; i < RUNS; i++) {
      const { pubkey, secret } = auditorKeypair();
      const text = randomBytes(randomInt(1, 300)).toString("base64") + "€✓";
      const pkg = await eciesEncrypt(pubkey, text);
      expect(await eciesDecrypt(secret, pkg)).toBe(text);
      await expect(eciesDecrypt(auditorKeypair().secret, pkg)).rejects.toThrow();
      const [e, iv, ct] = pkg.split(".");
      const raw = Buffer.from(ct, "base64");
      raw[randomInt(raw.length)] ^= 1 << randomInt(8);
      await expect(eciesDecrypt(secret, [e, iv, raw.toString("base64")].join("."))).rejects.toThrow();
    }
  });
});

describe("sealed proposal commitment", () => {
  it("client commitment = the server's sha256(salt‖plaintext), with a fresh salt each time", async () => {
    for (let i = 0; i < RUNS; i++) {
      const text = randomBytes(randomInt(1, 200)).toString("hex");
      const a = await sealProposal(text), b = await sealProposal(text);
      expect(a.salt).not.toBe(b.salt);
      expect(a.commitHash).not.toBe(b.commitHash); // same text, unlinkable commitments
      expect(a.commitHash).toBe("0x" + createHash("sha256").update(a.salt + text).digest("hex"));
      expect(await proposalCommit(text, a.salt)).toBe(a.commitHash);
    }
  });
});

describe("Merkle / field properties", () => {
  const fold = (leaf: bigint, path: { pathElements: string[]; pathIndices: number[] }) =>
    path.pathElements.reduce((h, sib, d) =>
      path.pathIndices[d] ? hashNode(BigInt(sib), h) : hashNode(h, BigInt(sib)), leaf);

  it("every member's path folds to the root; a non-member's leaf doesn't", () => {
    times(10, () => {
      const leaves = Array.from({ length: randomInt(1, 40) }, () => hashLeaf(BigInt(randomInt(1, 2 ** 47))));
      const { levels, zeros, root } = buildTree(leaves);
      const i = randomInt(leaves.length);
      const path = merklePath(levels, zeros, i);
      expect(fold(leaves[i], path)).toBe(root);
      expect(fold(leaves[i] + 1n, path)).not.toBe(root);
    });
  });

  it("each field element has exactly one canonical spelling", () => {
    times(200, () => {
      const x = BigInt("0x" + randomBytes(32).toString("hex")) % FIELD;
      expect(isCanonicalField(x.toString())).toBe(true);
      expect(isCanonicalField("0" + x.toString())).toBe(false);
      expect(isCanonicalField("0x" + x.toString(16))).toBe(false);
      expect(isCanonicalField((x + FIELD).toString())).toBe(false);
    });
  });
});
