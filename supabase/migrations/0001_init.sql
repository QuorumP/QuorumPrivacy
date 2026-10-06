-- QUORUM — initial schema (Phase 0/1)
-- Confidential governance: votes, sealed ballots, nullifiers, hidden proposals,
-- confidential tally, treasury, staking, members, settings, wallet-auth nonces, proof feed.
--
-- PRIVACY RULE: no plaintext vote choice is ever stored. `ballots.enc_choice` is ciphertext,
-- `commit_hash`/`nullifier` are commitments, proofs are opaque blobs/refs. RLS is enabled on
-- every table; privileged writes go through server functions using the service-role key
-- (which bypasses RLS). Public-readable tables get explicit anon/authenticated SELECT policies.

begin;

create extension if not exists pgcrypto;

-- ───────────────────────── enums ─────────────────────────
do $$ begin
  create type vote_status as enum ('draft','open','tallying','verified','executed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type proposal_status as enum ('hidden','revealed','executed','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reveal_mode as enum ('on_pass','timelock');
exception when duplicate_object then null; end $$;

do $$ begin
  create type stake_status as enum ('active','unstaking','withdrawn','slashed');
exception when duplicate_object then null; end $$;

-- ───────────────── shared updated_at trigger ─────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────────────────── settings ─────────────────────────
create table if not exists settings (
  id              uuid primary key default gen_random_uuid(),
  dao             text unique not null default 'quorum',
  quorum_pct      numeric not null default 5,
  approval_pct    numeric not null default 60,
  voting_window_days int not null default 3,
  realms_enabled  boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ───────────────────────── members ─────────────────────────
create table if not exists members (
  id                  uuid primary key default gen_random_uuid(),
  wallet              text unique not null,
  weight_commit       text,            -- commitment to voting weight (no plaintext balance)
  delegation_to       text,            -- wallet this member privately delegates to
  reputation          int not null default 0,
  eligible            boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ───────────────────────── votes ─────────────────────────
create table if not exists votes (
  id              uuid primary key default gen_random_uuid(),
  vote_id         text unique not null,            -- on-chain / public identifier (e.g. qrm-001)
  dao             text not null default 'quorum',
  title           text not null,
  description     text,
  eligibility_root text,                           -- ZK snapshot root of eligible members
  choices         text[] not null default array['yes','no','abstain'],
  opens_at        timestamptz,
  closes_at       timestamptz,
  quorum_pct      numeric not null default 5,
  approval_pct    numeric not null default 60,
  ballot_count    int not null default 0,          -- PUBLIC count only — never the tally
  status          vote_status not null default 'open',
  result_hash     text,                            -- set only after verified tally
  anchor_tx       text,                            -- devnet tx anchoring root/result
  created_by      text,                            -- creator wallet
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists votes_status_idx on votes(status);
create index if not exists votes_closes_at_idx on votes(closes_at);

-- ───────────────────────── ballots ─────────────────────────
-- Sealed votes. NO link to voter identity. enc_choice = {choice,weight} encrypted to tally key.
create table if not exists ballots (
  id                  uuid primary key default gen_random_uuid(),
  vote_id             text not null references votes(vote_id) on delete cascade,
  nullifier           text not null,               -- from eligibility proof; one vote per member
  enc_choice          text not null,               -- ciphertext (base64)
  commit_hash         text not null,               -- onchain proof a vote was cast (choice hidden)
  eligibility_proof   text,                         -- ZK eligibility proof blob (base64), nullable in v1
  cast_at             timestamptz not null default now(),
  unique (vote_id, nullifier)
);
create index if not exists ballots_vote_idx on ballots(vote_id);

-- ───────────────────────── nullifiers ─────────────────────────
-- Explicit nullifier set for double-vote prevention / dedup checks at tally.
create table if not exists nullifiers (
  id          uuid primary key default gen_random_uuid(),
  vote_id     text not null references votes(vote_id) on delete cascade,
  nullifier   text not null,
  used_at     timestamptz not null default now(),
  unique (vote_id, nullifier)
);

-- ───────────────────────── proposals ─────────────────────────
-- Hidden-until-execution. Only existence, author eligibility, and rules are public.
create table if not exists proposals (
  id                  uuid primary key default gen_random_uuid(),
  proposal_id         text unique not null,        -- public identifier (e.g. P-014)
  title               text,                         -- public title
  author_wallet       text,
  enc_payload_ref     text,                         -- storage/IPFS ref to encrypted payload
  rules_commit        text,                         -- public: quorum, threshold, window
  quorum_rule         text,
  reveal              reveal_mode not null default 'on_pass',
  reveal_at           timestamptz,                  -- for timelock mode
  status              proposal_status not null default 'hidden',
  revealed_payload    text,                         -- populated on reveal/execution
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists proposals_status_idx on proposals(status);

-- ───────────────────────── tally_results ─────────────────────────
create table if not exists tally_results (
  id                  uuid primary key default gen_random_uuid(),
  vote_id             text unique not null references votes(vote_id) on delete cascade,
  totals              jsonb not null,              -- weighted totals per choice
  ballot_count        int not null,
  correctness_zk_ref  text,                         -- proof of honest tally (blob/ref)
  tally_attest        text,                         -- MPC/TEE attestation
  verified_on_chain   boolean not null default false,
  created_at          timestamptz not null default now()
);

-- ───────────────────────── treasury_records ─────────────────────────
create table if not exists treasury_records (
  id                  uuid primary key default gen_random_uuid(),
  record_id           text unique not null,
  kind                text not null default 'balance',  -- balance|transfer|disclosure|solvency
  enc_balance         text,                              -- encrypted amount (ElGamal/Conf. Balances)
  commitment          text,
  disclosed           boolean not null default false,
  disclosed_to        text,
  solvency_proof_ref  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ───────────────────────── tally_nodes ─────────────────────────
create table if not exists tally_nodes (
  id                    uuid primary key default gen_random_uuid(),
  node_id               text unique not null,       -- e.g. N-08
  operator_wallet       text,
  stake_amount          numeric not null default 0,
  attestation           text,                        -- SGX | SEV-SNP
  attestation_verified  boolean not null default false,
  slash_events          int not null default 0,
  status                text not null default 'active',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ───────────────────────── stakes ─────────────────────────
create table if not exists stakes (
  id                uuid primary key default gen_random_uuid(),
  wallet            text not null,
  amount            numeric not null default 0,
  rewards_accrued   numeric not null default 0,
  status            stake_status not null default 'active',
  node_id           text references tally_nodes(node_id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists stakes_wallet_idx on stakes(wallet);

-- ───────────────────────── auditor_keys ─────────────────────────
create table if not exists auditor_keys (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,                  -- "who" (Foundation auditor, etc.)
  pubkey      text not null,
  scope       text,
  revoked     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ───────────────────────── auth_nonces ─────────────────────────
-- Sign-In-With-Solana: nonce -> signMessage -> verify.
create table if not exists auth_nonces (
  id            uuid primary key default gen_random_uuid(),
  wallet        text not null,
  nonce         text unique not null,
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  consumed_at   timestamptz
);
create index if not exists auth_nonces_wallet_idx on auth_nonces(wallet);

-- ───────────────────────── proofs (explorer feed) ─────────────────────────
create table if not exists proofs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                  -- vote|tally|treasury|node
  ref_id      text not null,
  detail      text,
  proof_label text,
  proof_ref   text,
  verified    boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists proofs_kind_idx on proofs(kind);

-- ───────────────────────── updated_at triggers ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'settings','members','votes','proposals','treasury_records','tally_nodes','stakes','auditor_keys'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on %I; create trigger set_updated_at before update on %I for each row execute function set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ───────────────────────── RLS ─────────────────────────
-- Enable on every table. Public tables get SELECT policies; sensitive tables stay
-- service-role-only (no policy = denied for anon/authenticated; service-role bypasses RLS).
do $$
declare t text;
begin
  foreach t in array array[
    'settings','members','votes','ballots','nullifiers','proposals','tally_results',
    'treasury_records','tally_nodes','stakes','auditor_keys','auth_nonces','proofs'
  ] loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- Public read for the clearly-public surfaces (spec: counts/existence/proofs are public).
do $$
declare t text;
begin
  foreach t in array array[
    'settings','members','votes','proposals','tally_results','tally_nodes','proofs'
  ] loop
    execute format('drop policy if exists public_read on %I;', t);
    execute format(
      'create policy public_read on %I for select to anon, authenticated using (true);', t
    );
  end loop;
end $$;

commit;
