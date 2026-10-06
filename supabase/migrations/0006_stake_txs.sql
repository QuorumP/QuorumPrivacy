-- On-chain QRM stake settlement (devnet).
-- Records every confirmed on-chain transfer signature so stake credits are idempotent
-- (a signature can only ever be credited once) and gives unstake/faucet an audit trail.
-- Additive: creates one new table, touches nothing existing.
create table if not exists stake_txs (
  id          uuid primary key default gen_random_uuid(),
  signature   text unique not null,          -- devnet tx signature (idempotency key)
  wallet      text not null,
  amount      numeric not null,              -- UI units of QRM moved
  kind        text not null default 'stake', -- stake | unstake | faucet
  created_at  timestamptz not null default now()
);
create index if not exists stake_txs_wallet_idx on stake_txs(wallet);
