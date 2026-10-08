-- Admin audit trail + pause switches (audit path items 6 and 7).

-- 1. Append-only record of every admin action: who, what, old -> new. Written by the server in the
--    same transaction as the change. RLS on with no policies: anonymous clients read nothing; the
--    trigger refuses UPDATE/DELETE/TRUNCATE even for the server role, so history can't be rewritten.
create table if not exists admin_events (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text not null,
  action     text not null,
  old_value  jsonb,
  new_value  jsonb
);
alter table admin_events enable row level security;
revoke all on admin_events from anon, authenticated;

create or replace function public.admin_events_append_only() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'admin_events is append-only';
end $$;
drop trigger if exists admin_events_append_only on admin_events;
create trigger admin_events_append_only before update or delete or truncate on admin_events
  for each statement execute function public.admin_events_append_only();

-- 2. Pause switches for the faucet and the tally only. Unstaking has no switch on purpose: members
--    can always take their stake back (studio rule P1).
alter table settings add column if not exists faucet_paused boolean not null default false;
alter table settings add column if not exists tally_paused boolean not null default false;
