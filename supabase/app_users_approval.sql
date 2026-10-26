-- App (OTP) users need admin approval (26-Oct-2026). Safe to re-run.
alter table public.app_users
  add column if not exists status text
    default 'approved';
update public.app_users
  set status = 'approved'
  where status is null;
notify pgrst, 'reload schema';
