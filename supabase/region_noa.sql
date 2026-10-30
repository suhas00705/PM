-- Region Tracking: won potentials that have NO OA yet (30-Oct-2026). Safe to re-run.
-- PART 1 : keep the potential's Project Name (filled by the potentials sync)
alter table public.potentials_cache
  add column if not exists project_name text;

-- PART 2 : list for one region and FY
create or replace function public.rt_noa(
  p_cy int, p_rg text)
returns jsonb language sql stable
security definer set search_path = public as $$
with w as (
  select d.id, d.name, d.account, d.owner,
         d.ptype, d.amount, d.closing
  from ptt_deals_base() d
  where d.sgrp = 'Won' and d.rg = p_rg
    and d.closing >= make_date(p_cy, 4, 1)
    and d.closing < make_date(p_cy + 1, 4, 1)),
o as (
  select distinct deal_id from oa_deal_link
  where deal_id is not null
    and coalesce(status, '') not ilike 'cancel%')
select jsonb_build_object('rows',
  coalesce(jsonb_agg(jsonb_build_array(
    w.id, w.name, p.project_name, w.account,
    w.owner, w.ptype, round(w.amount / 1e5, 2),
    w.closing) order by w.closing desc),
  '[]'::jsonb))
from w
left join potentials_cache p on p.id::text = w.id
where not exists
  (select 1 from o where o.deal_id = w.id);
$$;
grant execute on function public.rt_noa(int, text)
  to anon, authenticated;
notify pgrst, 'reload schema';
-- check: select public.rt_noa(2026, 'Mumbai');
