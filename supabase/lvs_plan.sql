-- LVS tab data (Switchgear item code x month, OB & INV, this FY + last FY).
-- Excludes B&E / TEST DUMMY accounts and WBT/TM busbar temperature items and EM1P-EM4P MCBs. Safe to re-run.
create or replace function public.lvs_plan(p_cy int default null)
returns jsonb language sql stable security definer
set search_path = public as $$
with p as (
  select coalesce(p_cy, case when extract(month from current_date) >= 4
    then extract(year from current_date)::int
    else extract(year from current_date)::int - 1 end) as cy),
l as materialized (
  select s.item_code as code, s.cat_code, s.description,
    s.product_series, s.doc_type, s.fy_start,
    (s.fy_month + 8) % 12 as mi, s.quantity,
    s.doc_total_fc, s.posting_date
  from sales_lines s, p
  where s.product_basket = 'SWITCHGEAR'
    and s.fy_start in (p.cy, p.cy - 1)
    and s.item_code is not null
    and coalesce(s.card_name, '')
      !~* 'B\s*&\s*E\s+ELECTRIC|TEST\s+DUMMY'
    and coalesce(s.cat_code, '') !~* '^(WBT|TM|EM[1-4]P)'),
m as (
  select code, doc_type dt, fy_start fy, mi,
    sum(quantity) q, sum(doc_total_fc) v
  from l group by 1, 2, 3, 4),
info as (
  select distinct on (code) code, cat_code,
    description, product_series
  from l order by code, posting_date desc),
k as (
  select d, f from unnest(array['OB','INV']) d,
    (select cy f from p union all select cy - 1 from p) y),
g as (
  select i.code, k.d dt, k.f fy, x mi,
    coalesce(m.q, 0) q, coalesce(m.v, 0) v
  from info i cross join k cross join generate_series(0, 11) x
  left join m on m.code = i.code and m.dt = k.d
    and m.fy = k.f and m.mi = x),
a as (
  select i.code, i.cat_code, i.description, i.product_series,
    array_agg(g.q order by g.mi)
      filter (where g.dt = 'OB' and g.fy = p.cy) ob,
    array_agg(g.q order by g.mi)
      filter (where g.dt = 'INV' and g.fy = p.cy) inv,
    array_agg(g.q order by g.mi)
      filter (where g.dt = 'OB' and g.fy = p.cy - 1) ob_ly,
    array_agg(g.q order by g.mi)
      filter (where g.dt = 'INV' and g.fy = p.cy - 1) inv_ly,
    sum(g.v) filter (where g.dt = 'OB' and g.fy = p.cy) obv,
    sum(g.q) filter (where g.dt = 'OB' and g.fy = p.cy) obq,
    sum(g.v) filter (where g.dt = 'INV' and g.fy = p.cy) invv,
    sum(g.q) filter (where g.dt = 'INV' and g.fy = p.cy) invq,
    sum(g.v) filter (where g.fy = p.cy - 1) lyv,
    sum(g.q) filter (where g.fy = p.cy - 1) lyq
  from info i join g on g.code = i.code, p
  group by 1, 2, 3, 4)
select jsonb_build_object(
  'cy', (select cy from p),
  'asof', (select max(posting_date) from sales_lines),
  'items', coalesce(jsonb_agg(jsonb_build_array(
    code, cat_code, description, product_series,
    ob, inv, ob_ly, inv_ly, round(obv), obq,
    round(invv), invq, round(lyv), lyq) order by code), '[]'))
from a;
$$;
grant execute on function public.lvs_plan(int) to anon;
notify pgrst, 'reload schema';
