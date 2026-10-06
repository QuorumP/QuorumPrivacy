// Validates the (t,n) threshold tally: DKG -> encrypt -> homomorphic sum -> t partial
// decryptions -> Lagrange combine. Confirms t shares recover the total and t-1 do not.
// Run with: bun scripts/crypto/threshold-test.ts
import { pedersenDkg, partialDecrypt, thresholdDecrypt } from "../../src/lib/crypto/threshold";
import { encryptOneHot, addCiphertexts } from "../../src/lib/crypto/elgamal";

const n = 5, t = 3;
const dkg = pedersenDkg(n, t);
console.log(`DKG: ${n} nodes, threshold ${t}, group pubkey ${dkg.pubkey.slice(0, 12)}…`);

// 6 ballots over {yes,no,abstain}, encrypted to the GROUP key
const choices = [0, 0, 0, 1, 2, 1];
const sealed = choices.map((c) => encryptOneHot(dkg.pubkey, c, 3));

function tallyWith(shareIdxs: number[]) {
  return [0, 1, 2].map((opt) => {
    const sum = addCiphertexts(sealed.map((b) => b[opt]));
    const partials = shareIdxs.map((i) => ({ index: i, point: partialDecrypt(dkg.shares[i - 1], sum) }));
    return thresholdDecrypt(partials, sum);
  });
}

const counts = tallyWith([1, 2, 3]); // t=3 distinct nodes
console.log("tally with 3 shares [yes,no,abstain]:", counts);
const ok = JSON.stringify(counts) === JSON.stringify([3, 2, 1]);
console.log("t-of-n threshold decrypt correct:", ok ? "YES ✓" : "NO ✗");

let belowThresholdFails = false;
try {
  const bad = tallyWith([1, 2]); // only t-1 = 2 shares
  belowThresholdFails = JSON.stringify(bad) !== JSON.stringify([3, 2, 1]);
} catch {
  belowThresholdFails = true; // DLOG out of range -> correct rejection
}
console.log("t-1 shares cannot decrypt:", belowThresholdFails ? "YES ✓" : "NO ✗");

process.exit(ok && belowThresholdFails ? 0 : 1);
