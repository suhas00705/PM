-- PM Hub app: users registered by mobile OTP (24-Oct-2026). Safe to re-run.
-- Only the server (Vercel, service key) reads / writes these tables.
create table if not exists public.app_users (
  mobile text primary key,
  name text not null,
  is_active boolean default true,
  token_hash text,
  device text,
  registered_at timestamptz default now(),
  last_seen timestamptz,
  open_count int default 0);
create table if not exists public.app_otp (
  mobile text primary key,
  code_hash text,
  expires_at timestamptz,
  tries int default 0,
  sends int default 0,
  window_start timestamptz default now());
alter table public.app_users
  enable row level security;
alter table public.app_otp
  enable row level security;
revoke all on public.app_users from anon;
revoke all on public.app_otp from anon;
-- check: both tables exist, no rows yet
select (select count(*) from public.app_users) users,
       (select count(*) from public.app_otp) otps;
