// Exercise the deployed quorum_anchor program end-to-end on devnet:
// register_vote -> commit_ballots -> submit_tally -> read the PDA back -> close_vote, plus the
// negatives the native tests can't reach (register_vote's QUORUM_AUTHORITY gate needs the real
// system program). Exits non-zero on any unexpected result.
// Run AFTER deploy: node scripts/onchain/anchor-vote.mjs
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const { AnchorProvider, Program, Wallet } = anchor;
const root = process.cwd();
const idl = JSON.parse(readFileSync(join(root, "onchain", "idl", "quorum_anchor.json"), "utf8"));
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(join(root, ".devnet", "qrm-authority.json"), "utf8"))),
);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
const program = new Program(idl, provider);
const PROGRAM_ID = new PublicKey(idl.address);

const voteId = "qrm-onchain-" + randomBytes(2).toString("hex");
const [votePda] = PublicKey.findProgramAddressSync([Buffer.from("vote"), Buffer.from(voteId)], PROGRAM_ID);
const root32 = (s) => [...createHash("sha256").update(s).digest()];

console.log("voteId:", voteId, "| pda:", votePda.toBase58());

// A funded non-authority signer, so its failures are the program's gate and not missing rent.
const mallory = Keypair.generate();
await sendAndConfirmTransaction(connection, new Transaction().add(
  SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: mallory.publicKey, lamports: 10_000_000 }),
), [payer]);
async function mustFail(label, p, code) {
  try { await p; } catch (e) {
    const logs = String(e?.logs ?? "") + String(e?.message ?? e);
    if (logs.includes(code)) { console.log(`${label} ✓ rejected (${code})`); return; }
    console.error(`${label} ✗ failed for the wrong reason:`, logs.slice(0, 400)); process.exit(1);
  }
  console.error(`${label} ✗ was ACCEPTED`); process.exit(1);
}
const [squatPda] = PublicKey.findProgramAddressSync([Buffer.from("vote"), Buffer.from(voteId + "-sq")], PROGRAM_ID);
await mustFail("register_vote by non-authority", program.methods.registerVote(voteId + "-sq", root32("x"))
  .accounts({ vote: squatPda, authority: mallory.publicKey, systemProgram: SystemProgram.programId }).signers([mallory]).rpc(), "Unauthorized");

await program.methods.registerVote(voteId, root32("eligibility:" + voteId))
  .accounts({ vote: votePda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
console.log("register_vote  ✓ (eligibility_root anchored)");

await mustFail("commit_ballots by non-authority", program.methods.commitBallots(root32("evil"))
  .accounts({ vote: votePda, authority: mallory.publicKey }).signers([mallory]).rpc(), "Unauthorized");
await mustFail("submit_tally before commit", program.methods.submitTally(root32("early"))
  .accounts({ vote: votePda, authority: payer.publicKey }).rpc(), "BadState");

await program.methods.commitBallots(root32("ballots:" + voteId))
  .accounts({ vote: votePda, authority: payer.publicKey }).rpc();
console.log("commit_ballots ✓ (ballot_root anchored, status -> tallying)");

await program.methods.submitTally(root32("tally:" + voteId))
  .accounts({ vote: votePda, authority: payer.publicKey }).rpc();
console.log("submit_tally   ✓ (result_hash anchored, status -> verified)");

const acc = await program.account.voteAnchor.fetch(votePda);
console.log("\non-chain state:", {
  voteId: acc.voteId,
  status: acc.status, // 2 = verified
  eligibility: Buffer.from(acc.eligibilityRoot).toString("hex").slice(0, 12) + "…",
  ballot: Buffer.from(acc.ballotRoot).toString("hex").slice(0, 12) + "…",
  result: Buffer.from(acc.resultHash).toString("hex").slice(0, 12) + "…",
});
console.log("explorer:", `https://explorer.solana.com/address/${votePda.toBase58()}?cluster=devnet`);
if (acc.status !== 2) { console.error("✗ expected status 2 (verified)"); process.exit(1); }

await mustFail("re-commit after verified", program.methods.commitBallots(root32("rewrite"))
  .accounts({ vote: votePda, authority: payer.publicKey }).rpc(), "BadState");
await mustFail("close_vote by non-authority", program.methods.closeVote()
  .accounts({ vote: votePda, authority: mallory.publicKey }).signers([mallory]).rpc(), "Unauthorized");
await program.methods.closeVote().accounts({ vote: votePda, authority: payer.publicKey }).rpc();
if (await connection.getAccountInfo(votePda)) { console.error("✗ vote PDA still open after close_vote"); process.exit(1); }
console.log("close_vote     ✓ (rent reclaimed)");
process.exit(0); // the RPC client keeps sockets open
