-- Target alerts (phone notifications) for the app (30-Oct-2026). Safe to re-run.
-- Only the server (service key) reads / writes these tables.
create table if not exists public.app_push (
  endpoint text primary key,
  mobile text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now());
create table if not exists public.push_sent (
  k text primary key,
  sent_at timestamptz default now(),
  info jsonb);
alter table public.app_push enable row level security;
alter table public.push_sent enable row level security;
revoke all on public.app_push from anon, authenticated;
revoke all on public.push_sent from anon, authenticated;
notify pgrst, 'reload schema';
-- check: select * from public.push_sent order by sent_at desc;
