-- 19-Oct-2026: lets the sync remove converted / deleted rows from the cache tables.
-- The anon key cannot DELETE directly (Supabase silently removes 0 rows), so the sync calls this.
create or replace function public.cache_remove(p_table text, p_ids text[])
returns integer language plpgsql security definer
set search_path = public as $$
declare n integer;
begin
  if p_table not in ('leads_cache', 'potentials_cache') then
    raise exception 'table not allowed: %', p_table;
  end if;
  execute format('delete from %I where id::text = any($1)', p_table)
    using p_ids;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.cache_remove(text, text[]) to anon;
