-- Privacy + hardening (audit 2026-10-06, Phase 4).
-- 1. members was public_read: anyone with the anon key could list every wallet's delegate and
--    its eligibility leaf (wallet <-> commitment). The app reads members only through server
--    functions (owner role), so the browser needs no direct access.
drop policy if exists public_read on members;

-- 2. TRUNCATE ignores RLS; the client roles never need it on any table.
revoke truncate on all tables in schema public from anon, authenticated;

-- 3. Pin the trigger function's search_path (Supabase advisor: function_search_path_mutable).
alter function public.set_updated_at() set search_path = public, pg_temp;

-- 4. Sealed proposals are now committed as sha256(salt || plaintext); the salt is published at
--    reveal so anyone can re-check the commitment. NULL = legacy unsalted commitment.
alter table proposals add column if not exists reveal_salt text;
