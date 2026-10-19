-- LVS stock snapshot (19-Oct-2026). /api/lvs-stock saves the Switchgear
-- stock sheet here every 2 hours; the LVS page reads the saved copy.
create table if not exists public.lvs_stock_snap (
  id int primary key default 1,
  fetched_at timestamptz not null,
  items jsonb not null);

create or replace function public.lvs_stock_save(p_items jsonb)
returns int language sql security definer
set search_path = public as $$
  insert into lvs_stock_snap (id, fetched_at, items)
  values (1, now(), p_items)
  on conflict (id) do update
    set fetched_at = now(), items = excluded.items;
  select jsonb_array_length(p_items);
$$;

create or replace function public.lvs_stock_get()
returns jsonb language sql stable security definer
set search_path = public as $$
  select jsonb_build_object('fetchedAt', fetched_at, 'items', items)
  from lvs_stock_snap where id = 1;
$$;

grant execute on function public.lvs_stock_save(jsonb) to anon;
grant execute on function public.lvs_stock_get() to anon;
