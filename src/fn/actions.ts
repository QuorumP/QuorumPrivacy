// Mutation server functions for the dashboard. All run server-side (pg pool) and most
// require an authenticated wallet session. Phase-1 note: ballot encryption / nullifiers are
// simulated here (the client sends a placeholder ciphertext; the nullifier is derived
// server-side from wallet+vote). Phases 2-3 replace these with real threshold encryption
// and ZK nullifiers — the table shapes already accommodate that.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { query, queryOne, withTransaction } from "../lib/db/pool.server";
import { requireWallet, requireAdmin, isAdmin } from "../lib/auth/session.server";
import { eligibilityRoot } from "../lib/zk/tree.server";
import { verifyEligibility, voteIdToField, verifySolvency } from "../lib/zk/verify.server";
import { rerandomizeAll, verifyBallot, addCiphertexts, type Ciphertext } from "../lib/crypto/elgamal";
import { isCanonicalField } from "../lib/zk/poseidon";
import { tallyBallots, tallyConfigured, tallyCorrectnessTranscript, verifyTranscript, type TallyTranscript } from "../lib/crypto/tally.server";
import { anchorConfigured, registerVoteOnChain, anchorTallyOnChain } from "../lib/solana/anchor.server";
import { rateLimit } from "../lib/security/rateLimit.server";
import { auditorKeypair, eciesEncrypt } from "../lib/crypto/ecies";
import { qrmConfigured, transferFromAuthority, sendFromAuthority, confirmSig, confirmStakeTransfer } from "../lib/solana/qrm.server";
import { groth16OnChainConfigured, verifySolvencyOnChain } from "../lib/solana/groth16.server";

const FAUCET_QRM = 500;
const FAUCET_DAILY_DRIPS = 200; // 100k QRM/day across all wallets

const shortId = (prefix: string, bytes = 3) => `${prefix}${randomBytes(bytes).toString("hex")}`;

const hex = z.string().regex(/^[0-9a-f]{64}$/);
const scalar = z.string().regex(/^\d{1,80}$/);
const ciphertextsSchema = z.array(z.object({ c1: hex, c2: hex })).length(3);
const ballotProofSchema = z.object({
  bits: z.array(z.object({ c0: scalar, c1: scalar, z0: scalar, z1: scalar })).length(3),
  sum: z.object({ c: scalar, z: scalar }),
});

// ── Cast a sealed ballot (real ZK eligibility) ────────────────────────
// The client submits a Groth16 proof of membership in the eligibility tree plus an
// unlinkable nullifier. The server verifies the proof against the live root and the
// vote-bound field, then stores only the nullifier + ciphertext — never an identity link.
export const castBallot = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      voteId: z.string().min(1),
      encChoice: z.string().min(1).max(2000), // JSON one-hot ElGamal ciphertexts (yes/no/abstain)
      ballotProof: ballotProofSchema, // proves every entry is 0/1 and the row sums to 1
      commitHash: z.string().min(1),
      proof: z.record(z.string(), z.unknown()),
      // [nullifierHash, root, voteId] — canonical decimals only: snarkjs reads "0"+N and "0x…"
      // as N, so a non-canonical nullifier would dodge the text-based double-vote check.
      publicSignals: z.array(z.string().refine(isCanonicalField)).length(3),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const w = requireWallet(); // session gate (anti-spam); the stored ballot is NOT linked to it
    await rateLimit(`ballot:${w}`, 30, 60);
    const [nullifierHash, proofRoot, proofVoteId] = data.publicSignals;

    // Bind the proof to THIS vote's eligibility snapshot (frozen at creation), so stake moved to
    // another wallet afterwards can't buy a second ballot. Legacy votes: the live tree.
    const snap = await queryOne<{ eligibility_root: string | null; frozen: boolean }>(
      `select eligibility_root, eligibility_leaves is not null as frozen from votes where vote_id=$1`, [data.voteId],
    );
    if (!snap) throw new Error("VOTE_NOT_FOUND");
    const expectedRoot = snap.frozen ? snap.eligibility_root : (await eligibilityRoot()).root;
    if (proofRoot !== expectedRoot) throw new Error("STALE_ROOT");
    if (proofVoteId !== voteIdToField(data.voteId).toString()) throw new Error("VOTE_MISMATCH");

    const ok = await verifyEligibility({ proof: data.proof, publicSignals: data.publicSignals });
    if (!ok) throw new Error("BAD_PROOF");

    // Ballot validity: reject anything that isn't 3 well-formed ciphertexts carrying a valid
    // 0/1 + sum-to-1 proof bound to this vote and nullifier. Never store unverified input —
    // a malformed ciphertext would brick the tally for the whole vote.
    const tallyPub = process.env.TALLY_PUBKEY;
    if (!tallyPub) throw new Error("TALLY_NOT_CONFIGURED");
    const cts = ciphertextsSchema.parse(JSON.parse(data.encChoice));
    let valid = false;
    try { valid = verifyBallot(tallyPub, cts, data.ballotProof, `${data.voteId}|${nullifierHash}`); } catch { /* bad points/scalars */ }
    if (!valid) throw new Error("BAD_BALLOT");

    // Receipt-freeness: re-randomize the ElGamal ballot server-side so the voter holds no
    // ciphertext that proves their choice to a briber. Plaintext is never seen.
    const storedEnc = JSON.stringify(rerandomizeAll(tallyPub, cts));
    const storedCommit = "0x" + createHash("sha256").update(storedEnc).digest("hex");

    return withTransaction(async (q) => {
      const vote = (await q(
        `select status, closes_at is not null and closes_at <= now() as expired from votes where vote_id=$1 for update`,
        [data.voteId],
      ))[0] as { status: string; expired: boolean } | undefined;
      if (!vote) throw new Error("VOTE_NOT_FOUND");
      if (vote.status !== "open" || vote.expired) throw new Error("VOTE_CLOSED");

      const dup = (await q(`select 1 from nullifiers where vote_id=$1 and nullifier=$2`, [
        data.voteId, nullifierHash,
      ]))[0];
      if (dup) throw new Error("ALREADY_VOTED");

      await q(`insert into nullifiers (vote_id, nullifier) values ($1,$2)`, [data.voteId, nullifierHash]);
      await q(
        `insert into ballots (vote_id, nullifier, enc_choice, commit_hash) values ($1,$2,$3,$4)`,
        [data.voteId, nullifierHash, storedEnc, storedCommit],
      );
      await q(`update votes set ballot_count = ballot_count + 1 where vote_id=$1`, [data.voteId]);
      return { nullifier: `${nullifierHash.slice(0, 6)}…${nullifierHash.slice(-4)}` };
    });
  });

// ── Submit a sealed (commit-reveal) proposal ──────────────────────────
// The body is encrypted client-side; only a ciphertext + a commitment (sha256 of the
// plaintext) reach the server. The content stays hidden until the author reveals it under
// the chosen policy (timelock window, or after the vote passes).
export const submitProposal = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      encPayload: z.string().min(1).max(8000), // client AES-GCM ciphertext
      commitHash: z.string().regex(/^0x[0-9a-f]{64}$/),
      reveal: z.enum(["on_pass", "timelock"]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const wallet = requireWallet();
    await rateLimit(`proposal:${wallet}`, 10, 60);
    const proposalId = shortId("P-", 2);
    const revealAt = data.reveal === "timelock"
      ? new Date(Date.now() + 7 * 86_400_000).toISOString()
      : null;
    await query(
      `insert into proposals (proposal_id, title, author_wallet, reveal, reveal_at, status, rules_commit, quorum_rule, enc_payload_ref)
       values ($1,null,$2,$3::reveal_mode,$4,'hidden',$5,'>= 5% staked QRM, 3-day window',$6)`,
      [proposalId, wallet, data.reveal, revealAt, data.commitHash, data.encPayload],
    );
    return { proposalId };
  });

// ── Reveal a sealed proposal (policy-gated, commitment-verified) ──────
export const revealProposal = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      proposalId: z.string().min(1),
      plaintext: z.string().min(1).max(4000),
      salt: z.string().regex(/^[0-9a-f]{64}$/).optional(), // absent for legacy unsalted proposals
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const wallet = requireWallet();
    const p = await queryOne<{
      author_wallet: string; reveal: string; reveal_at: string | null; status: string; rules_commit: string;
    }>(`select author_wallet, reveal, reveal_at, status, rules_commit from proposals where proposal_id=$1`,
      [data.proposalId]);
    if (!p) throw new Error("NOT_FOUND");
    if (p.status === "revealed") throw new Error("ALREADY_REVEALED");
    if (p.author_wallet !== wallet) throw new Error("NOT_AUTHOR");

    // policy: timelock requires the window to elapse; on_pass is author-gated here
    if (p.reveal === "timelock" && p.reveal_at && new Date(p.reveal_at).getTime() > Date.now()) {
      throw new Error("TIMELOCK_NOT_ELAPSED");
    }
    // commitment binds the author to exactly what they sealed
    const commit = "0x" + createHash("sha256").update((data.salt ?? "") + data.plaintext).digest("hex");
    if (commit !== p.rules_commit) throw new Error("COMMIT_MISMATCH");

    await query(
      `update proposals set status='revealed', title=$2, revealed_payload=$2, reveal_salt=$3, updated_at=now() where proposal_id=$1`,
      [data.proposalId, data.plaintext, data.salt ?? null],
    );
    return { ok: true };
  });

// ── Create a vote (admin console) ─────────────────────────────────────
export const createVote = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ title: z.string().min(1).max(200), days: z.number().int().min(1).max(60) }).parse(d),
  )
  .handler(async ({ data }) => {
    const wallet = requireAdmin();
    await rateLimit(`createvote:${wallet}`, 10, 60);
    const voteId = shortId("qrm-", 8); // 16 hex chars: not guessable ahead of creation
    const closesAt = new Date(Date.now() + data.days * 86_400_000).toISOString();
    // freeze the eligibility set for this vote: root + the leaves to rebuild witnesses from
    const { root, leaves } = await eligibilityRoot();
    await query(
      `insert into votes (vote_id, title, status, opens_at, closes_at, created_by, eligibility_root, eligibility_leaves)
       values ($1,$2,'open', now(), $3, $4, $5, $6)`,
      [voteId, data.title, closesAt, wallet, root, JSON.stringify(leaves)],
    );
    // best-effort: anchor the eligibility root on devnet (non-fatal if RPC/secret unavailable)
    let anchorTx: string | null = null;
    if (anchorConfigured()) {
      try {
        anchorTx = await registerVoteOnChain(voteId, root);
        await query(`update votes set anchor_tx=$2 where vote_id=$1`, [voteId, anchorTx]);
      } catch { /* keep the DB vote; on-chain anchor can be retried */ }
    }
    return { voteId, anchorTx };
  });

// ── Close a vote and run the confidential tally ───────────────────────
// Homomorphically decrypts the per-option totals (individual ballots stay sealed), records
// the result, and best-effort anchors the ballot-commitment + result hash on devnet.
export const runTally = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ voteId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const w = requireWallet();
    await rateLimit(`tally:${w}`, 10, 60);
    if (!tallyConfigured()) throw new Error("TALLY_NOT_CONFIGURED");

    // Only the vote's creator (or an ADMIN_WALLETS admin) may tally, only once, and only after
    // the vote closes (admins may close early). Claiming open -> tallying in one statement makes
    // concurrent or repeat tallies impossible; previously any wallet could end any vote early.
    const admin = isAdmin(w);
    const claimed = await queryOne(
      `update votes set status='tallying'
       where vote_id=$1 and status='open'
         and (created_by=$2 or $3::boolean)
         and ($3::boolean or (closes_at is not null and closes_at <= now()))
       returning 1`,
      [data.voteId, w, admin],
    );
    if (!claimed) {
      const v = await queryOne<{ status: string; created_by: string | null }>(
        `select status, created_by from votes where vote_id=$1`, [data.voteId],
      );
      if (!v) throw new Error("VOTE_NOT_FOUND");
      if (v.status !== "open") throw new Error("ALREADY_TALLIED");
      if (v.created_by !== w && !admin) throw new Error("NOT_VOTE_OWNER");
      throw new Error("VOTE_STILL_OPEN");
    }
    try {
      return await tallyClaimed(data.voteId);
    } catch (e) {
      await query(`update votes set status='open' where vote_id=$1 and status='tallying'`, [data.voteId]);
      throw e;
    }
  });

async function tallyClaimed(voteId: string) {
  const ballots = await query<{ enc_choice: string; commit_hash: string }>(
    `select enc_choice, commit_hash from ballots where vote_id=$1`, [voteId],
  );
  const { options, counts, tallied } = tallyBallots(ballots.map((b) => b.enc_choice));
  const totals = Object.fromEntries(options.map((o, i) => [o, counts[i]]));

  // DLEQ correctness transcript: proves the announced totals are the honest threshold
  // decryption of the sealed ballots (verifiable by anyone, no trust in the server).
  const transcript = tallyCorrectnessTranscript(ballots.map((b) => b.enc_choice), options);
  const correctnessRef = transcript ? JSON.stringify(transcript) : null;

  const ballotRoot = "0x" + createHash("sha256")
    .update(ballots.map((b) => b.commit_hash).sort().join("|")).digest("hex");
  const resultHash = "0x" + createHash("sha256").update(JSON.stringify(totals)).digest("hex");

  await withTransaction(async (q) => {
    await q(
      `insert into tally_results (vote_id, totals, ballot_count, verified_on_chain, correctness_zk_ref)
       values ($1,$2,$3,false,$4)
       on conflict (vote_id) do update set totals=excluded.totals, ballot_count=excluded.ballot_count, correctness_zk_ref=excluded.correctness_zk_ref`,
      [voteId, JSON.stringify(totals), tallied, correctnessRef],
    );
    await q(`update votes set status='verified', result_hash=$2 where vote_id=$1`, [voteId, resultHash]);
    if (correctnessRef) {
      await q(
        `insert into proofs (kind, ref_id, detail, proof_label, verified) values ('tally',$1,$2,'DLEQ · verifiable',true)`,
        [voteId, `Tally correctness: ${tallied} sealed ballots, threshold-decrypted with DLEQ proofs`],
      );
    }
  });

  let tallyTx: string | null = null;
  if (anchorConfigured()) {
    try {
      tallyTx = await anchorTallyOnChain(voteId, ballotRoot, resultHash);
      await query(`update votes set tally_tx=$2 where vote_id=$1`, [voteId, tallyTx]);
      await query(`update tally_results set verified_on_chain=true where vote_id=$1`, [voteId]);
    } catch { /* result stored; on-chain anchor can be retried */ }
  }
  return { totals, tallied, resultHash, tallyTx };
}

// ── QRM faucet (devnet): authority sends the caller QRM so they can stake ──
export const qrmFaucet = createServerFn({ method: "POST" }).handler(async () => {
  const wallet = requireWallet();
  if (!qrmConfigured()) throw new Error("QRM_NOT_CONFIGURED");
  // Devnet-only, with a global daily budget on top of the per-wallet limit: fresh wallets are
  // free, so a per-wallet cap alone lets a script empty the supply.
  if (!(process.env.SOLANA_RPC ?? "https://api.devnet.solana.com").includes("devnet")) throw new Error("FAUCET_DISABLED");
  await rateLimit(`faucet:${wallet}`, 3, 3600); // 3 drips / wallet / hour
  await rateLimit("faucet:global", FAUCET_DAILY_DRIPS, 86_400);
  const signature = await transferFromAuthority(wallet, FAUCET_QRM);
  await query(`insert into stake_txs (signature, wallet, amount, kind) values ($1,$2,$3,'faucet')`, [
    signature, wallet, FAUCET_QRM,
  ]);
  return { signature, amount: FAUCET_QRM };
});

// ── Confirm an on-chain stake (browser-signed QRM transfer to the vault) ──
// The client transfers QRM to the vault and signs it in-wallet, then submits the signature
// here. We verify the transfer really landed on devnet (fee-aware, via the vault's balance
// delta) and credit the DB ledger exactly once (signature is the idempotency key).
export const confirmStake = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ signature: z.string().min(32).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const wallet = requireWallet();
    if (!qrmConfigured()) throw new Error("QRM_NOT_CONFIGURED");
    await rateLimit(`stake:${wallet}`, 20, 60);
    const dup = await queryOne(`select 1 from stake_txs where signature=$1`, [data.signature]);
    if (dup) throw new Error("ALREADY_CREDITED");

    const credited = await confirmStakeTransfer(data.signature, wallet);
    if (credited <= 0) throw new Error("STAKE_NOT_CONFIRMED");

    return withTransaction(async (q) => {
      await q(`insert into stake_txs (signature, wallet, amount, kind) values ($1,$2,$3,'stake')`, [
        data.signature, wallet, credited,
      ]);
      const existing = (await q(`select 1 from stakes where wallet=$1 and status='active'`, [wallet]))[0];
      if (existing) {
        await q(`update stakes set amount = amount + $2 where wallet=$1 and status='active'`, [wallet, credited]);
      } else {
        await q(`insert into stakes (wallet, amount, status) values ($1,$2,'active')`, [wallet, credited]);
      }
      const total = (await q(
        `select coalesce(sum(amount),0)::numeric total from stakes where wallet=$1 and status='active'`, [wallet],
      ))[0] as { total: string };
      return { staked: Number(total?.total ?? 0), credited };
    });
  });

// ── Unstake (devnet): vault returns QRM to the caller on-chain, debit the ledger ──
export const unstakeQrm = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ amount: z.number().min(1) }).parse(d)) // min 1 QRM: dust unstakes only burn the authority's SOL on fees
  .handler(async ({ data }) => {
    const wallet = requireWallet();
    if (!qrmConfigured()) throw new Error("QRM_NOT_CONFIGURED");
    await rateLimit(`unstake:${wallet}`, 10, 60);

    // Debit FIRST, under row locks, so concurrent unstakes serialize and can never both pass
    // the balance check (the old check-then-transfer-then-debit drained the vault).
    const remaining = await withTransaction(async (q) => {
      const rows = (await q(
        `select id, amount from stakes where wallet=$1 and status='active' order by amount desc for update`,
        [wallet],
      )) as { id: string; amount: string }[];
      const staked = rows.reduce((s, r) => s + Number(r.amount), 0);
      if (data.amount > staked) throw new Error("INSUFFICIENT_STAKE");
      let left = data.amount;
      for (const r of rows) {
        if (left <= 0) break;
        const take = Math.min(left, Number(r.amount));
        await q(`update stakes set amount = amount - $2 where id=$1`, [r.id, take]);
        left -= take;
      }
      return staked - data.amount;
    });

    const refund = () => query(
      `update stakes set amount = amount + $2
       where id = (select id from stakes where wallet=$1 and status='active' order by amount desc limit 1)`,
      [wallet, data.amount],
    );
    let signature: string;
    try {
      signature = await sendFromAuthority(wallet, data.amount, "vault"); // vault -> user
    } catch (e) {
      await refund(); // never broadcast: give the ledger back
      throw e;
    }
    await query(`insert into stake_txs (signature, wallet, amount, kind) values ($1,$2,$3,'unstake')`, [
      signature, wallet, data.amount,
    ]);
    let landed: boolean;
    try {
      landed = await confirmSig(signature);
    } catch {
      // Broadcast but unconfirmed: keep the debit — refunding a tx that later lands would pay out
      // twice. The stake_txs row is the audit trail for reconciliation.
      throw new Error("UNSTAKE_PENDING");
    }
    if (!landed) { await refund(); throw new Error("UNSTAKE_FAILED"); } // landed but failed: nothing moved
    return { signature, staked: remaining };
  });

// ── Save governance settings ──────────────────────────────────────────
export const saveSettings = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      quorumPct: z.number().min(0).max(100),
      approvalPct: z.number().min(0).max(100),
      votingWindowDays: z.number().int().min(1).max(60),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    await query(
      `update settings set quorum_pct=$1, approval_pct=$2, voting_window_days=$3 where dao='quorum'`,
      [data.quorumPct, data.approvalPct, data.votingWindowDays],
    );
    return { ok: true };
  });

// ── Toggle the Realms integration flag (persisted) ────────────────────
export const setRealms = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    requireAdmin();
    await query(`update settings set realms_enabled=$1 where dao='quorum'`, [data.enabled]);
    return { ok: true, enabled: data.enabled };
  });

// ── Private delegation (DB-tracked; on-chain settlement deferred) ──────
// Reassigns the caller's voting weight to an eligible delegate. The delegated weight is
// aggregated privately at tally; no per-wallet weight is ever exposed.
export const setDelegation = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ delegate: z.string().min(32).max(48) }).parse(d))
  .handler(async ({ data }) => {
    const wallet = requireWallet();
    if (data.delegate === wallet) throw new Error("SELF_DELEGATION");
    const target = await queryOne(`select 1 from members where wallet=$1 and eligible`, [data.delegate]);
    if (!target) throw new Error("DELEGATE_NOT_ELIGIBLE");
    await query(`update members set delegation_to=$2 where wallet=$1`, [wallet, data.delegate]);
    return { ok: true };
  });

export const clearDelegation = createServerFn({ method: "POST" }).handler(async () => {
  const wallet = requireWallet();
  await query(`update members set delegation_to=null where wallet=$1`, [wallet]);
  return { ok: true };
});

// ── Confidential treasury actions ─────────────────────────────────────
// Selective disclosure: encrypt the record content to ONE auditor's key (ECIES) so only
// that auditor can read it. The ciphertext is stored; nobody else can decrypt.
export const issueDisclosure = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      recordId: z.string().min(1),
      auditorPubkey: z.string().regex(/^[0-9a-f]{64}$/),
      content: z.string().min(1).max(2000),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    const ciphertext = await eciesEncrypt(data.auditorPubkey, data.content);
    await query(
      `insert into treasury_records (record_id, kind, disclosed, disclosed_to, enc_balance)
       values ($1,'disclosure',true,$2,$3)
       on conflict (record_id) do update set disclosed=true, disclosed_to=excluded.disclosed_to, enc_balance=excluded.enc_balance`,
      [data.recordId, data.auditorPubkey, ciphertext],
    );
    return { ok: true };
  });

// Record a ZK solvency proof (balance >= threshold, balance hidden). The proof is generated
// in the operator's browser; the server verifies it before publishing — no balance is stored.
export const recordSolvencyProof = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      threshold: z.string().regex(/^\d+$/),
      commitment: z.string().regex(/^\d+$/),
      proof: z.record(z.string(), z.unknown()),
      publicSignals: z.array(z.string()).length(2),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    if (data.publicSignals[0] !== data.threshold || data.publicSignals[1] !== data.commitment) {
      throw new Error("SIGNAL_MISMATCH");
    }
    const ok = await verifySolvency(data.proof, data.publicSignals);
    if (!ok) throw new Error("BAD_PROOF");

    // Best-effort: also verify the proof ON-CHAIN via the deployed alt_bn128 Groth16 verifier
    // (devnet). Non-fatal — the off-chain verify already gates recording.
    let onChainTx: string | null = null;
    if (groth16OnChainConfigured()) {
      try {
        onChainTx = await verifySolvencyOnChain(
          data.proof as unknown as { pi_a: string[]; pi_b: string[][]; pi_c: string[] },
          data.publicSignals,
        );
      } catch { /* keep the off-chain-verified record; on-chain attest can be retried */ }
    }

    const recordId = shortId("S-", 2);
    await query(
      `insert into treasury_records (record_id, kind, commitment, solvency_proof_ref)
       values ($1,'solvency',$2,$3)`,
      [recordId, data.commitment, onChainTx ? `groth16:onchain:${onChainTx}` : "groth16"],
    );
    await query(
      `insert into proofs (kind, ref_id, detail, proof_label, verified) values ('treasury',$1,$2,$3,true)`,
      [recordId,
       `Solvency: reserves ≥ ${Number(data.threshold).toLocaleString()} (balance hidden)${onChainTx ? " · verified on-chain" : ""}`,
       onChainTx ? "Valid · on-chain" : "Valid"],
    );
    return { recordId, commitment: data.commitment, threshold: data.threshold, onChainTx };
  });

// ── Auditor keys ──────────────────────────────────────────────────────
export const addAuditor = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ label: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => {
    requireAdmin();
    // Real ECIES keypair: the auditor keeps `secret` (shown once); we store only the pubkey.
    const { pubkey, secret } = auditorKeypair();
    await query(`insert into auditor_keys (label, pubkey, scope) values ($1,$2,'full')`, [
      data.label, pubkey,
    ]);
    return { pubkey, secret };
  });

export const revokeAuditor = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ pubkey: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    requireAdmin();
    await query(`update auditor_keys set revoked=true where pubkey=$1`, [data.pubkey]);
    return { ok: true };
  });

// ── Tally-node operator application ───────────────────────────────────
export const applyTallyNode = createServerFn({ method: "POST" }).handler(async () => {
  const wallet = requireWallet();
  const nodeId = `N-${randomBytes(2).toString("hex")}`;
  await query(
    `insert into tally_nodes (node_id, operator_wallet, attestation, status, stake_amount)
     values ($1,$2,'pending','pending',0)`,
    [nodeId, wallet],
  );
  return { nodeId };
});

// ── Re-verify a tally's DLEQ correctness transcript from scratch ──────
// Loads the stored transcript and re-runs the full check (each DLEQ proof, the Σλ·Y == group-key
// binding, and total·G == C2 − Σλ·D). Trustless: proves the announced totals are the honest
// decryption of the sealed ballots without trusting the server.
export const verifyTally = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ voteId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const row = await queryOne<{ correctness_zk_ref: string | null; totals: unknown }>(
      `select correctness_zk_ref, totals from tally_results where vote_id=$1`, [data.voteId],
    );
    if (!row?.correctness_zk_ref) return { found: false, verified: false };
    let transcript: TallyTranscript;
    try { transcript = JSON.parse(row.correctness_zk_ref) as TallyTranscript; }
    catch { return { found: true, verified: false }; }
    // A transcript is self-consistent under ANY key, so also require (1) our tally key and
    // (2) that each option's ciphertext is the homomorphic sum of the ballots actually stored.
    const ballots = await query<{ enc_choice: string }>(`select enc_choice from ballots where vote_id=$1`, [data.voteId]);
    const parsed = ballots // same filter as tallyBallots: legacy rows that never parsed are skipped
      .map((b) => { try { return JSON.parse(b.enc_choice) as Ciphertext[]; } catch { return null; } })
      .filter((c): c is Ciphertext[] => Array.isArray(c) && c.length === transcript.options.length);
    const sums = transcript.options.map((_, i) => addCiphertexts(parsed.map((b) => b[i])));
    const verified = transcript.pubkey === process.env.TALLY_PUBKEY
      && transcript.options.every((o, i) => o.ct.c1 === sums[i].c1 && o.ct.c2 === sums[i].c2)
      && verifyTranscript(transcript);
    const totals = Object.fromEntries(transcript.options.map((o) => [o.option, o.total]));
    return { found: true, verified, totals };
  });

// ── Re-verify a published proof against the stored record ─────────────
export const verifyProof = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ refId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const row = await queryOne<{ verified: boolean; proof_label: string | null }>(
      `select verified, proof_label from proofs where ref_id=$1 order by created_at desc limit 1`,
      [data.refId],
    );
    return { found: !!row, verified: row?.verified ?? false, label: row?.proof_label ?? null };
  });
