-- App users: approval + tab / region access (26-Oct-2026). Safe to re-run.
alter table public.app_users
  add column if not exists status text
    default 'approved',
  add column if not exists allowed_tabs jsonb,
  add column if not exists allowed_regions jsonb;
update public.app_users
  set status = 'approved'
  where status is null;
notify pgrst, 'reload schema';
