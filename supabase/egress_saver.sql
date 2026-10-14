-- 14-Oct-2026 egress saver. Adds 3 small read-only functions; changes no data and no existing function. Safe to re-run.

-- 1) Tiny "has the data changed?" check (a few bytes) — dashboards call this before re-downloading everything.
create or replace function public.pm_data_version()
returns text language sql stable as $$
  select concat_ws('|',
    (select max(id) from public.sales_sync_log),
    (select count(*) from public.sales_lines),
    (select max(synced_at) from public.sales_lines),
    (select round(sum(doc_total_fc)) from public.sales_lines))
$$;
grant execute on function public.pm_data_version() to anon, authenticated;

-- 2) Compact copies of the two growth feeds: same rows and numbers, repeated text replaced by short codes.
create or replace function public.pm_growth_c(p_cy int)
returns jsonb language sql stable as $$
  with g as (select public.pm_growth(p_cy) as j),
       e as (select x from g, jsonb_array_elements(g.j->'rows') x),
       dd as (select coalesce(array_agg(v order by v), '{}') a from (select distinct x->>'d' v from e) z),
       dr as (select coalesce(array_agg(v order by v), '{}') a from (select distinct x->>'r' v from e) z),
       db as (select coalesce(array_agg(v order by v), '{}') a from (select distinct x->>'b' v from e) z)
  select (g.j - 'rows') || jsonb_build_object(
           'fmt', 'c1',
           'cols', jsonb_build_array('d','fy','m','r','b','gov','v'),
           'dict', jsonb_build_object('d', to_jsonb(dd.a), 'r', to_jsonb(dr.a), 'b', to_jsonb(db.a)),
           'rows', (select coalesce(jsonb_agg(jsonb_build_array(
                      array_position(dd.a, x->>'d') - 1, x->'fy', x->'m',
                      array_position(dr.a, x->>'r') - 1, array_position(db.a, x->>'b') - 1,
                      case when (x->>'gov')::boolean then 1 else 0 end, x->'v')), '[]'::jsonb) from e))
  from g, dd, dr, db
$$;
grant execute on function public.pm_growth_c(int) to anon, authenticated;

create or replace function public.pm_series_growth_c(p_cy int)
returns jsonb language sql stable as $$
  with g as (select public.pm_series_growth(p_cy) as j),
       e as (select x from g, jsonb_array_elements(g.j->'rows') x),
       dd as (select coalesce(array_agg(v order by v), '{}') a from (select distinct x->>'d' v from e) z),
       dr as (select coalesce(array_agg(v order by v), '{}') a from (select distinct x->>'r' v from e) z),
       db as (select coalesce(array_agg(v order by v), '{}') a from (select distinct x->>'b' v from e) z),
       ds as (select coalesce(array_agg(v order by v), '{}') a from (select distinct x->>'s' v from e) z)
  select (g.j - 'rows') || jsonb_build_object(
           'fmt', 'c1',
           'cols', jsonb_build_array('d','fy','m','r','b','s','gov','v','q'),
           'dict', jsonb_build_object('d', to_jsonb(dd.a), 'r', to_jsonb(dr.a), 'b', to_jsonb(db.a), 's', to_jsonb(ds.a)),
           'rows', (select coalesce(jsonb_agg(jsonb_build_array(
                      array_position(dd.a, x->>'d') - 1, x->'fy', x->'m',
                      array_position(dr.a, x->>'r') - 1, array_position(db.a, x->>'b') - 1, array_position(ds.a, x->>'s') - 1,
                      case when (x->>'gov')::boolean then 1 else 0 end, x->'v', x->'q')), '[]'::jsonb) from e))
  from g, dd, dr, db, ds
$$;
grant execute on function public.pm_series_growth_c(int) to anon, authenticated;

notify pgrst, 'reload schema';

-- check: old vs new size of the growth feeds (new should be much smaller), and the version string
select pg_size_pretty(length(public.pm_series_growth(2026)::text)::bigint) as series_old,
       pg_size_pretty(length(public.pm_series_growth_c(2026)::text)::bigint) as series_new,
       pg_size_pretty(length(public.pm_growth(2026)::text)::bigint) as growth_old,
       pg_size_pretty(length(public.pm_growth_c(2026)::text)::bigint) as growth_new,
       public.pm_data_version() as data_version;
