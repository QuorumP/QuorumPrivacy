// Runnable demo of @quorum/sdk — exercises every primitive end-to-end.
//   npx tsx sdk/example.ts
//
// The SDK is the CLIENT/VERIFIER surface. To make the demo self-contained it also plays the
// "tally authority" using QUORUM's server-side threshold helpers (pedersenDkg / partial decrypt)
// — in production those run on the tally nodes, and you'd only call the SDK's verifyTally.
import {
  sealBallot, verifyTally, sealProposal, verifyProposalReveal,
  generateAuditorKey, encryptToAuditor, decryptAsAuditor,
  type TallyTranscript, type Ciphertext,
} from "./index";
import { addCiphertexts } from "../src/lib/crypto/elgamal";
import { pedersenDkg, partialDecryptWithProof, thresholdDecrypt } from "../src/lib/crypto/threshold";

const OPTIONS = ["yes", "no", "abstain"];

async function main() {
  console.log("── 1. Sealed ballots + trustless tally (DLEQ) ──");
  // A 3-of-5 threshold tally key (no single party holds the secret).
  const dkg = pedersenDkg(5, 3);

  // Voters seal ballots CLIENT-SIDE with only the public group key.
  const votes = ["yes", "yes", "no", "yes", "abstain"];
  const sealed = await Promise.all(votes.map((v) => sealBallot(dkg.pubkey, v, OPTIONS)));
  console.log(`   sealed ${sealed.length} ballots; sample commit ${sealed[0].commitHash.slice(0, 14)}…`);

  // Tally authority (t nodes) builds the correctness transcript. (Server-side in production.)
  const shares = dkg.shares.slice(0, dkg.t);
  const transcript: TallyTranscript = {
    pubkey: dkg.pubkey,
    options: OPTIONS.map((option, i) => {
      const perBallot: Ciphertext[] = sealed.map((b) => JSON.parse(b.encChoice)[i]);
      const sum = addCiphertexts(perBallot);
      const partials = shares.map((s) => partialDecryptWithProof(s, sum));
      const total = thresholdDecrypt(partials.map((p) => ({ index: p.index, point: p.point })), sum);
      return { option, ct: sum, total, partials };
    }),
  };

  // Anyone verifies the published transcript — no keys, no server, no trust.
  const result = verifyTally(transcript);
  console.log(`   verifyTally → verified=${result.verified}, totals=${JSON.stringify(result.totals)}`);
  console.log(`   (expected yes 3, no 1, abstain 1)`);

  // Tamper check: bump a total and confirm verification fails.
  const tampered = { ...transcript, options: transcript.options.map((o, i) => i === 0 ? { ...o, total: o.total + 1 } : o) };
  console.log(`   tampered transcript → verified=${verifyTally(tampered).verified} (expected false)`);

  console.log("\n── 2. Hidden-until-execution proposal (commit-reveal) ──");
  const text = "Transfer 50,000 USDC to the grants multisig for Q3 bounties.";
  const proposal = await sealProposal(text);
  console.log(`   sealed; commit ${proposal.commitHash.slice(0, 14)}…`);
  console.log(`   reveal (correct plaintext) → ${await verifyProposalReveal(proposal.commitHash, text, proposal.salt)} (expected true)`);
  console.log(`   reveal (tampered plaintext) → ${await verifyProposalReveal(proposal.commitHash, text + " ", proposal.salt)} (expected false)`);

  console.log("\n── 3. Auditor selective disclosure (ECIES) ──");
  const auditor = generateAuditorKey();
  const record = "Payment #1042: 250,000 USDC → Acme Corp, 2026-07-06";
  const disclosure = await encryptToAuditor(auditor.pubkey, record);
  const recovered = await decryptAsAuditor(auditor.secret, disclosure);
  console.log(`   auditor decrypts → "${recovered}"`);
  console.log(`   matches original → ${recovered === record} (expected true)`);
  const wrong = generateAuditorKey();
  try {
    await decryptAsAuditor(wrong.secret, disclosure);
    console.log("   wrong auditor decrypts → UNEXPECTED SUCCESS ❌");
  } catch {
    console.log("   wrong auditor decrypts → rejected ✔ (only the intended auditor can read it)");
  }

  console.log("\n✅ SDK demo complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
