// Validates the ElGamal ballot pipeline: encrypt one-hot -> server re-randomize ->
// homomorphic sum per option -> decrypt totals. Run with: bun scripts/crypto/roundtrip.ts
import {
  encryptOneHot, rerandomizeAll, addCiphertexts, decrypt, publicKeyFromSecret,
} from "../../src/lib/crypto/elgamal";
import { ed25519 } from "@noble/curves/ed25519";

const ORDER = ed25519.CURVE.n;
function randScalar(): bigint {
  const b = new Uint8Array(64); crypto.getRandomValues(b);
  let x = 0n; for (const v of b) x = (x << 8n) | BigInt(v);
  return (x % (ORDER - 1n)) + 1n;
}

const secret = randScalar();
const pub = publicKeyFromSecret(secret);

// 5 ballots over {yes, no, abstain}
const choices = [0, 0, 1, 2, 0];
const N = 3;
const sealed = choices.map((c) => rerandomizeAll(pub, encryptOneHot(pub, c, N))); // client enc + server rerandomize

const counts: number[] = [];
for (let i = 0; i < N; i++) {
  const sum = addCiphertexts(sealed.map((b) => b[i]));
  counts.push(decrypt(secret, sum));
}
console.log("tally [yes,no,abstain]:", counts);
const expected = [3, 1, 1];
const ok = JSON.stringify(counts) === JSON.stringify(expected);
console.log("homomorphic tally correct:", ok ? "YES ✓" : "NO ✗");

// receipt-freeness sanity: a re-randomized ciphertext differs byte-wise from the original
const one = encryptOneHot(pub, 0, N);
const rr = rerandomizeAll(pub, one);
console.log("re-randomized differs from original:", one[0].c1 !== rr[0].c1 ? "YES ✓" : "NO ✗");

process.exit(ok && one[0].c1 !== rr[0].c1 ? 0 : 1);
