-- Portal Google sign-in (26-Oct-2026). Safe to re-run.
-- PART 1 : new columns for the Control tab
alter table public.user_permissions
  add column if not exists name text,
  add column if not exists picture text,
  add column if not exists status text
    default 'approved',
  add column if not exists requested_at
    timestamptz,
  add column if not exists last_login
    timestamptz,
  add column if not exists login_count
    int default 0;
update public.user_permissions
  set status = 'approved'
  where status is null;

-- PART 2 : only the server may read / change
-- the user list (stops anyone approving
-- themselves with the public key)
alter table public.user_permissions
  enable row level security;
revoke all on public.user_permissions
  from anon, authenticated;

-- check: lists the users
select email, status, is_active
from public.user_permissions;
