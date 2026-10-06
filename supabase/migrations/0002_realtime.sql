-- Enable Supabase Realtime for live ballot_count updates on votes (and proposal status).
-- The default `supabase_realtime` publication streams row changes to subscribed clients;
-- RLS still applies (anon gets the public_read policy from 0001), so only public columns
-- of public rows are delivered.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'votes'
  ) then
    execute 'alter publication supabase_realtime add table votes';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'proposals'
  ) then
    execute 'alter publication supabase_realtime add table proposals';
  end if;
end $$;
