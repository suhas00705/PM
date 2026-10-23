-- 23-Oct-2026: one row per /api/cron-2h run, so missed 2-hourly slots can be seen. Safe to re-run.
create table if not exists public.cron_2h_log (
  id bigserial primary key,
  at timestamptz default now(),
  entry jsonb);
alter table public.cron_2h_log
  enable row level security;
create or replace function public.cron_2h_add(
  p_entry jsonb)
returns void language sql security definer
set search_path = public as $$
  insert into cron_2h_log(entry) values (p_entry);
  delete from cron_2h_log
  where at < now() - interval '30 days';
$$;
grant execute on function
  public.cron_2h_add(jsonb) to anon;
create or replace function public.cron_2h_recent()
returns jsonb language sql stable security definer
set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'at', at, 'h', entry->'h',
    'by_cron', entry->'by_cron',
    'ok', entry->'ok') order by id desc), '[]')
  from (select * from cron_2h_log
        order by id desc limit 40) x;
$$;
grant execute on function
  public.cron_2h_recent() to anon;
notify pgrst, 'reload schema';
