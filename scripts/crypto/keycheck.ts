// Sanity-check a generated .devnet/tally-shares.json: encrypt one-hot ballots to the group
// pubkey, threshold-decrypt with t shares, and DLEQ-verify. Run: bun scripts/crypto/keycheck.ts
import { readFileSync } from "node:fs";
import { encryptOneHot, addCiphertexts } from "../../src/lib/crypto/elgamal";
import { partialDecryptWithProof, thresholdDecrypt, verifyTallyCorrectness } from "../../src/lib/crypto/threshold";

const dkg = JSON.parse(readFileSync("./.devnet/tally-shares.json", "utf8"));
const pub = dkg.pubkey;
const choices = [0, 0, 1, 2, 0, 1, 0]; // yes=4, no=2, abstain=1
const sealed = choices.map((c) => encryptOneHot(pub, c, 3));
const idxs = [1, 2, 3];
const expect = [4, 2, 1];
let ok = true;
for (let opt = 0; opt < 3; opt++) {
  const sum = addCiphertexts(sealed.map((s) => s[opt]));
  const partials = idxs.map((i) => partialDecryptWithProof(dkg.shares[i - 1], sum));
  const total = thresholdDecrypt(partials.map((p) => ({ index: p.index, point: p.point })), sum);
  const good = verifyTallyCorrectness(pub, sum, partials, total);
  console.log(`opt${opt}: total=${total} (expect ${expect[opt]}) dleq=${good}`);
  if (!good || total !== expect[opt]) ok = false;
}
console.log(ok ? "KEY OK ✓" : "KEY BROKEN ✗");
process.exit(ok ? 0 : 1);
