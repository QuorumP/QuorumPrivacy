import { describe, it, expect } from "vitest";
import { poseidon1, poseidon2 } from "poseidon-lite";
import { ed25519 } from "@noble/curves/ed25519";
import {
  encrypt, encryptOneHot, rerandomize, addCiphertexts, decrypt, publicKeyFromSecret,
} from "./elgamal";
import { pedersenDkg, partialDecrypt, thresholdDecrypt, partialDecryptWithProof, verifyTallyCorrectness } from "./threshold";
import { auditorKeypair, eciesEncrypt, eciesDecrypt } from "./ecies";
import { hashLeaf, hashNode, buildTree, merklePath } from "../zk/poseidon";

const ORDER = ed25519.CURVE.n;
const randScalar = () => {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return (x % (ORDER - 1n)) + 1n;
};

describe("ElGamal (exponential, Ristretto255)", () => {
  it("encrypt/decrypt roundtrip for small m", () => {
    const s = randScalar();
    const P = publicKeyFromSecret(s);
    for (const m of [0, 1, 5, 42]) expect(decrypt(s, encrypt(P, m))).toBe(m);
  });

  it("is additively homomorphic", () => {
    const s = randScalar();
    const P = publicKeyFromSecret(s);
    const sum = addCiphertexts([encrypt(P, 1), encrypt(P, 1), encrypt(P, 0), encrypt(P, 1)]);
    expect(decrypt(s, sum)).toBe(3);
  });

  it("re-randomization preserves plaintext but changes the ciphertext", () => {
    const s = randScalar();
    const P = publicKeyFromSecret(s);
    const ct = encrypt(P, 1);
    const rr = rerandomize(P, ct);
    expect(rr.c1).not.toBe(ct.c1);
    expect(decrypt(s, rr)).toBe(1);
  });

  it("one-hot encodes a choice", () => {
    const s = randScalar();
    const P = publicKeyFromSecret(s);
    const cts = encryptOneHot(P, 2, 3);
    expect(cts.map((c) => decrypt(s, c))).toEqual([0, 0, 1]);
  });
});

describe("Threshold ElGamal (t-of-n)", () => {
  it("any t shares recover the homomorphic total; t-1 cannot", () => {
    const dkg = pedersenDkg(5, 3);
    const choices = [0, 0, 0, 1, 2, 1]; // yes=3 no=2 abstain=1
    const sealed = choices.map((c) => encryptOneHot(dkg.pubkey, c, 3));

    const tally = (idxs: number[]) => [0, 1, 2].map((opt) => {
      const sum = addCiphertexts(sealed.map((b) => b[opt]));
      const partials = idxs.map((i) => ({ index: i, point: partialDecrypt(dkg.shares[i - 1], sum) }));
      return thresholdDecrypt(partials, sum);
    });

    expect(tally([1, 2, 3])).toEqual([3, 2, 1]);
    expect(tally([2, 4, 5])).toEqual([3, 2, 1]); // a different t-subset also works
    let belowFails = false;
    try { belowFails = JSON.stringify(tally([1, 2])) !== JSON.stringify([3, 2, 1]); } catch { belowFails = true; }
    expect(belowFails).toBe(true);
  }, 30_000); // the t-1 case scans the whole 1e6 discrete-log range before failing (~5 s on CI)

  it("DLEQ correctness proofs: honest tally verifies; tampered total/partial is rejected", () => {
    const dkg = pedersenDkg(5, 3);
    const choices = [0, 0, 0, 1, 2, 1]; // yes=3 no=2 abstain=1
    const sealed = choices.map((c) => encryptOneHot(dkg.pubkey, c, 3));
    const idxs = [1, 2, 3];

    for (const [opt, total] of [[0, 3], [1, 2], [2, 1]] as const) {
      const sum = addCiphertexts(sealed.map((b) => b[opt]));
      const partials = idxs.map((i) => partialDecryptWithProof(dkg.shares[i - 1], sum));

      // honest transcript verifies
      expect(verifyTallyCorrectness(dkg.pubkey, sum, partials, total)).toBe(true);
      // wrong announced total is rejected
      expect(verifyTallyCorrectness(dkg.pubkey, sum, partials, total + 1)).toBe(false);
      // a tampered partial point is rejected (DLEQ fails)
      const bad = partials.map((p, i) => i === 0 ? { ...p, point: partials[1].point } : p);
      expect(verifyTallyCorrectness(dkg.pubkey, sum, bad, total)).toBe(false);
      // a forged verification key is rejected (fails the Σλ·Y == pubkey binding)
      const forged = partials.map((p, i) => i === 0 ? { ...p, vkey: dkg.pubkey } : p);
      expect(verifyTallyCorrectness(dkg.pubkey, sum, forged, total)).toBe(false);
    }
  });
});

describe("ECIES auditor disclosure", () => {
  it("only the targeted auditor can decrypt", async () => {
    const auditor = auditorKeypair();
    const other = auditorKeypair();
    const pkg = await eciesEncrypt(auditor.pubkey, "treasury: 1,250,000 USDC in cold storage");
    expect(await eciesDecrypt(auditor.secret, pkg)).toBe("treasury: 1,250,000 USDC in cold storage");
    await expect(eciesDecrypt(other.secret, pkg)).rejects.toBeTruthy();
  });
});

describe("Poseidon / Merkle (matches circom)", () => {
  it("poseidon-lite is deterministic and matches re-exported helpers", () => {
    expect(hashLeaf(7n)).toBe(poseidon1([7n]));
    expect(hashNode(3n, 9n)).toBe(poseidon2([3n, 9n]));
  });

  it("merkle path verifies against the built root", () => {
    const leaves = [1n, 2n, 3n, 4n, 5n].map(hashLeaf);
    const { levels, root, zeros } = buildTree(leaves);
    const k = 3;
    const { pathElements, pathIndices } = merklePath(levels, zeros, k);
    // recompute root from the leaf + path
    let h = leaves[k];
    for (let d = 0; d < pathElements.length; d++) {
      const sib = BigInt(pathElements[d]);
      h = pathIndices[d] === 0 ? hashNode(h, sib) : hashNode(sib, h);
    }
    expect(h).toBe(root);
  });
});
