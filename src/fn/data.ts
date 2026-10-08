// Read server functions backing the dashboard tabs. All run on the server (pg pool);
// the client calls them via the createServerFn RPC bridge / React Query.
import { createServerFn } from "@tanstack/react-start";
import { query, queryOne } from "../lib/db/pool.server";
import { getWallet } from "../lib/auth/session.server";
import { qrmConfigured, stakeContext } from "../lib/solana/qrm.server";
import { MIN_STAKE_QRM } from "../lib/zk/tree.server";

export type VoteDTO = {
  id: string;
  title: string;
  status: string;
  ballots: number;
  closesAt: string | null;
  quorumPct: number;
  resultHash: string | null;
  anchorTx: string | null;
  tallyTx: string | null;
};

export const listVotes = createServerFn({ method: "GET" }).handler(async (): Promise<VoteDTO[]> => {
  const rows = await query<{
    vote_id: string; title: string; status: string; ballot_count: number;
    closes_at: string | null; quorum_pct: number; result_hash: string | null;
    anchor_tx: string | null; tally_tx: string | null;
  }>(
    `select vote_id, title, status, ballot_count, closes_at, quorum_pct, result_hash, anchor_tx, tally_tx
     from votes order by case status when 'open' then 0 else 1 end, closes_at asc nulls last`,
  );
  return rows.map((r) => ({
    id: r.vote_id, title: r.title, status: r.status, ballots: r.ballot_count,
    closesAt: r.closes_at, quorumPct: Number(r.quorum_pct), resultHash: r.result_hash,
    anchorTx: r.anchor_tx, tallyTx: r.tally_tx,
  }));
});

export const listProposals = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await query<{
    proposal_id: string; status: string; reveal: string; reveal_at: string | null;
    quorum_rule: string | null; rules_commit: string | null; title: string | null; author_wallet: string | null;
    reveal_salt: string | null;
  }>(`select proposal_id, status, reveal, reveal_at, quorum_rule, rules_commit, title, author_wallet, reveal_salt
      from proposals order by created_at desc`);
  return rows.map((r) => ({
    id: r.proposal_id, status: r.status, reveal: r.reveal, revealAt: r.reveal_at, quorumRule: r.quorum_rule,
    commit: r.rules_commit, title: r.title, author: r.author_wallet,
    salt: r.reveal_salt, // published at reveal: sha256(salt || title) must equal commit
  }));
});

export const listTallyNodes = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await query<{
    node_id: string; stake_amount: number; attestation: string; slash_events: number; status: string;
  }>(`select node_id, stake_amount, attestation, slash_events, status from tally_nodes order by stake_amount desc`);
  return rows.map((r) => ({
    id: r.node_id, stake: Number(r.stake_amount), attestation: r.attestation,
    slash: r.slash_events, status: r.status,
  }));
});

export const listProofs = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await query<{
    kind: string; ref_id: string; detail: string | null; proof_label: string | null; verified: boolean;
  }>(`select kind, ref_id, detail, proof_label, verified from proofs order by created_at desc`);
  return rows.map((r) => ({
    type: r.kind, id: r.ref_id, detail: r.detail, proof: r.proof_label, verified: r.verified,
  }));
});

export const getTreasury = createServerFn({ method: "GET" }).handler(async () => {
  const records = await query<{
    record_id: string; kind: string; disclosed: boolean; solvency_proof_ref: string | null;
    created_at: string;
  }>(`select record_id, kind, disclosed, solvency_proof_ref, created_at from treasury_records order by created_at desc`);
  const disclosed = records.filter((r) => r.disclosed).length;
  return {
    records,
    disclosedCount: disclosed,
    totalRecords: records.length,
    solvencyCount: records.filter((r) => r.kind === "solvency").length,
    disclosureCount: records.filter((r) => r.kind === "disclosure").length,
    lastRecordAt: records[0]?.created_at ?? null,
  };
});

export const listAuditors = createServerFn({ method: "GET" }).handler(async () => {
  return query<{ label: string; pubkey: string; scope: string | null; revoked: boolean }>(
    `select label, pubkey, scope, revoked from auditor_keys order by created_at asc`,
  );
});

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  return queryOne<{
    quorum_pct: number; approval_pct: number; voting_window_days: number; realms_enabled: boolean;
    faucet_paused: boolean; tally_paused: boolean;
  }>(`select quorum_pct, approval_pct, voting_window_days, realms_enabled, faucet_paused, tally_paused from settings where dao='quorum'`);
});

// Public on-chain context the browser needs to build a Token-2022 stake transfer to the vault.
export const getStakeContext = createServerFn({ method: "GET" }).handler(async () => {
  if (!qrmConfigured()) return null;
  return stakeContext();
});

export const getProtocolStatus = createServerFn({ method: "GET" }).handler(async () => {
  const nodes = await queryOne<{ n: number; slashes: number }>(
    `select count(*)::int n, coalesce(sum(slash_events),0)::int slashes from tally_nodes where status='active'`,
  );
  return {
    nodes: nodes?.n ?? 0,
    slashEvents: nodes?.slashes ?? 0,
  };
});

export const getMembersSummary = createServerFn({ method: "GET" }).handler(async () => {
  const r = await queryOne<{
    eligible_wallets: number; delegations_out: number; active_delegates: number;
    sealed_ballots: number; open_votes: number;
  }>(`select
       (select count(*) from members m where m.eligible and m.id_commitment is not null
          and (select coalesce(sum(s.amount),0) from stakes s where s.wallet=m.wallet and s.status='active') >= $1)::int as eligible_wallets,
       (select count(*) from members where delegation_to is not null)::int as delegations_out,
       (select count(distinct delegation_to) from members where delegation_to is not null)::int as active_delegates,
       (select coalesce(sum(ballot_count),0) from votes)::int as sealed_ballots,
       (select count(*) from votes where status='open')::int as open_votes`, [MIN_STAKE_QRM]);
  return {
    eligibleWallets: r?.eligible_wallets ?? 0,
    delegationsOut: r?.delegations_out ?? 0,
    activeDelegates: r?.active_delegates ?? 0,
    sealedBallots: r?.sealed_ballots ?? 0,
    openVotes: r?.open_votes ?? 0,
  };
});

// Per-wallet participation (requires an authenticated session; null otherwise).
// NOTE: a per-wallet "ballots cast" count is intentionally NOT exposed — ballots are stored
// against unlinkable nullifiers, never the wallet, so counting them per wallet would break
// receipt-freeness. We surface eligibility, ZK registration, delegation and stake instead.
export const getParticipation = createServerFn({ method: "GET" }).handler(async () => {
  const wallet = getWallet();
  if (!wallet) return null;
  const m = await queryOne<{ eligible: boolean; id_commitment: string | null; delegation_to: string | null }>(
    `select eligible, id_commitment, delegation_to from members where wallet=$1`,
    [wallet],
  );
  const stake = await queryOne<{ total: number }>(
    `select coalesce(sum(amount),0)::numeric total from stakes where wallet=$1 and status='active'`,
    [wallet],
  );
  const open = await queryOne<{ n: number }>(`select count(*)::int n from votes where status='open'`);
  return {
    wallet,
    eligible: !!m?.eligible && !!m?.id_commitment && Number(stake?.total ?? 0) >= MIN_STAKE_QRM,
    registered: !!m?.id_commitment,
    delegationTo: m?.delegation_to ?? null,
    openVotes: open?.n ?? 0,
    qrmStaked: Number(stake?.total ?? 0),
  };
});
