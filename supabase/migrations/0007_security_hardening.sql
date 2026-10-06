-- Security hardening (audit 2026-10-06).
-- 1. stake_txs and rate_limits were created without RLS, so the public anon/authenticated roles
--    could read, delete and insert rows through the Supabase REST API (delete a stake signature
--    -> credit it twice; read ballot:<wallet> buckets -> who voted when). The server talks to
--    Postgres as the owner role and is unaffected.
alter table stake_txs   enable row level security;
alter table rate_limits enable row level security;
revoke all on stake_txs, rate_limits from anon, authenticated;

-- 2. A stake ledger can never go negative. NOT VALID: enforced for every new write without
--    failing on any historical row.
alter table stakes drop constraint if exists stakes_amount_nonneg;
alter table stakes add constraint stakes_amount_nonneg check (amount >= 0) not valid;
