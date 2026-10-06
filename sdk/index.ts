// @quorum/sdk — client-side confidential-governance crypto primitives for Solana DAOs.
//
// These are the exact primitives QUORUM uses in production (re-exported from the app's
// `src/lib/crypto`, so anything you seal here is byte-compatible with the live tally). Everything
// here runs fully client-side — no QUORUM server, no secret keys, no trust required. You need only
// public inputs (the tally group public key, an auditor public key) to seal; verification needs
// only the published transcript.
//
// Surface:
//   • sealBallot            — encrypt a one-hot vote to the tally key (additively homomorphic)
//   • verifyTally           — trustlessly check announced totals via Chaum-Pedersen DLEQ proofs
//   • sealProposal          — AES-GCM commit a hidden-until-execution proposal
//   • verifyProposalReveal  — check a revealed proposal matches its commitment
//   • generateAuditorKey / encryptToAuditor / decryptAsAuditor — ECIES selective disclosure
import { encryptOneHotProved, type BallotProof, type Ciphertext } from "../src/lib/crypto/elgamal";
import { verifyTallyCorrectness, type PartialProof } from "../src/lib/crypto/threshold";
import { sealProposal as _sealProposal } from "../src/lib/crypto/proposal";
import { eciesEncrypt, eciesDecrypt, auditorKeypair } from "../src/lib/crypto/ecies";

export type { Ciphertext } from "../src/lib/crypto/elgamal";
export type { PartialProof } from "../src/lib/crypto/threshold";

const sha256Hex = async (data: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return "0x" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/* ───────────────────────── Sealed ballots ───────────────────────── */

export interface SealedBallot {
  /** JSON array of ElGamal ciphertexts (one per option) — submit this as the sealed ballot. */
  encChoice: string;
  /** 0x-prefixed sha256 of `encChoice` — the ballot commitment. */
  commitHash: string;
  /** Proof that every entry encrypts 0/1 and the row sums to 1 (required by castBallot). */
  ballotProof: BallotProof;
}

/**
 * Seal a vote for `choice` over `options` to the tally group public key. The choice is one-hot
 * encoded and encrypted with exponential ElGamal (Ristretto255); ballots are additively
 * homomorphic so the tally can sum them without decrypting any individual vote.
 *
 * @param tallyPubkey hex group public key (QUORUM's `VITE_TALLY_PUBKEY`)
 * @param choice      the selected option, must be one of `options`
 * @param options     the full option set, e.g. ["yes","no","abstain"] (order must match the vote)
 * @param context     `${voteId}|${nullifierHash}` — binds the validity proof to this ballot
 */
export async function sealBallot(
  tallyPubkey: string,
  choice: string,
  options: string[],
  context = "",
): Promise<SealedBallot> {
  const idx = options.indexOf(choice);
  if (idx < 0) throw new Error(`choice "${choice}" is not one of [${options.join(", ")}]`);
  const { cts, proof } = encryptOneHotProved(tallyPubkey, idx, options.length, context);
  const encChoice = JSON.stringify(cts);
  return { encChoice, commitHash: await sha256Hex(encChoice), ballotProof: proof };
}

/* ───────────────────────── Tally verification ───────────────────── */

/** One option's verifiable-tally record (summed ciphertext, decrypted total, DLEQ partials). */
export interface OptionProof {
  option: string;
  ct: Ciphertext;
  total: number;
  partials: PartialProof[];
}
/** The published tally-correctness transcript (QUORUM's `verifyTally` server fn returns this). */
export interface TallyTranscript {
  pubkey: string;
  options: OptionProof[];
}
export interface TallyVerification {
  /** true iff every option's DLEQ proof holds AND the totals are the honest decryption. */
  verified: boolean;
  /** option → total, extracted from the transcript. */
  totals: Record<string, number>;
}

/**
 * Trustlessly verify a tally transcript: for every option it checks (1) each partial decryption's
 * Chaum-Pedersen DLEQ proof, (2) that the partials combine to the committed group key, and (3) that
 * the decryption equals the announced total. Needs only the public transcript — no server, no keys.
 */
export function verifyTally(transcript: TallyTranscript): TallyVerification {
  const verified = transcript.options.every((o) =>
    verifyTallyCorrectness(transcript.pubkey, o.ct, o.partials, o.total),
  );
  const totals = Object.fromEntries(transcript.options.map((o) => [o.option, o.total]));
  return { verified, totals };
}

/* ───────────────────────── Sealed proposals ─────────────────────── */

export interface SealedProposal {
  /** AES-GCM ciphertext blob (`ivB64.ctB64`) — publish as the hidden payload. */
  encPayload: string;
  /** 0x-prefixed sha256(salt || plaintext) — binds the proposal without revealing it. */
  commitHash: string;
  /** Random 32-byte hex salt. Keep it with the plaintext; it is published at reveal. */
  salt: string;
}

/**
 * Seal a hidden-until-execution proposal. Only the ciphertext + a sha256 commitment leave the
 * client; keep the `plaintext` yourself to reveal later. Reveal is verified against `commitHash`
 * (see {@link verifyProposalReveal}) — no decryption key is transmitted.
 */
export async function sealProposal(plaintext: string): Promise<SealedProposal> {
  return _sealProposal(plaintext);
}

/** Compute the 0x-prefixed sha256(salt || plaintext) commitment (salt "" = legacy unsalted). */
export async function proposalCommitHash(plaintext: string, salt = ""): Promise<string> {
  return sha256Hex(salt + plaintext);
}

/** Verify a revealed proposal (plaintext + its published salt) matches its commitment. */
export async function verifyProposalReveal(commitHash: string, plaintext: string, salt = ""): Promise<boolean> {
  return (await sha256Hex(salt + plaintext)) === commitHash.toLowerCase();
}

/* ───────────────────── Auditor selective disclosure ─────────────── */

/** Generate an ECIES auditor keypair. Keep `secret`; publish `pubkey` to receive disclosures. */
export function generateAuditorKey(): { secret: string; pubkey: string } {
  return auditorKeypair();
}

/** Encrypt `content` to an auditor's public key (ECIES over Ristretto255). Only that auditor can read it. */
export async function encryptToAuditor(auditorPubkey: string, content: string): Promise<string> {
  return eciesEncrypt(auditorPubkey, content);
}

/** Decrypt a disclosure with the auditor secret. Throws if it wasn't sealed to this key. */
export async function decryptAsAuditor(auditorSecret: string, sealed: string): Promise<string> {
  return eciesDecrypt(auditorSecret, sealed);
}
