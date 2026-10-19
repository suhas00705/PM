-- LVS (Switchgear, white-labelled from L&K) planning data for the LVS tab.  19-Oct-2026
-- One row per item code: qty per month (Apr..Mar) for OB and Invoicing, this FY and last FY,
-- plus value this FY. B&E / TEST DUMMY accounts and WBT / TM (busbar temperature) items excluded. Read-only. Safe to re-run.
create or replace function public.lvs_plan(p_cy int default null)
returns jsonb language sql stable security definer
set search_path = public as $$
  with p as (
    select coalesce(p_cy, case when extract(month from current_date) >= 4
             then extract(year from current_date)::int
             else extract(year from current_date)::int - 1 end) as cy),
  l as materialized (
    select s.item_code as code, s.cat_code, s.description, s.product_series,
           s.doc_type, s.fy_start, (s.fy_month + 8) % 12 as mi,
           s.quantity, s.doc_total_fc, s.posting_date
    from sales_lines s, p
    where s.product_basket = 'SWITCHGEAR'
      and s.fy_start in (p.cy, p.cy - 1)
      and s.item_code is not null
      and coalesce(s.card_name, '') !~* 'B\s*&\s*E\s+ELECTRIC|TEST\s+DUMMY'
      -- wireless busbar temperature sensors / controllers are not L&K items (19-Oct-2026)
      and coalesce(s.cat_code, '') !~* '^(WBT|TM)'),
  m as (
    select code, doc_type, fy_start, mi,
           sum(quantity) q, sum(doc_total_fc) v
    from l group by 1, 2, 3, 4),
  info as (
    select distinct on (code) code, cat_code, description, product_series
    from l order by code, posting_date desc),
  grid as (
    select i.code, k.doc_type, k.fy_start, g as mi,
           coalesce(m.q, 0) q, coalesce(m.v, 0) v
    from info i
    cross join (select d, f from unnest(array['OB','INV']) d,
                (select cy from p union all select cy - 1 from p) y(f)) k(doc_type, fy_start)
    cross join generate_series(0, 11) g
    left join m on m.code = i.code and m.doc_type = k.doc_type
               and m.fy_start = k.fy_start and m.mi = g),
  arr as (
    select i.code, i.cat_code, i.description, i.product_series,
      array_agg(g.q order by g.mi) filter (where g.doc_type = 'OB' and g.fy_start = p.cy) ob,
      array_agg(g.q order by g.mi) filter (where g.doc_type = 'INV' and g.fy_start = p.cy) inv,
      array_agg(g.q order by g.mi) filter (where g.doc_type = 'OB' and g.fy_start = p.cy - 1) ob_ly,
      array_agg(g.q order by g.mi) filter (where g.doc_type = 'INV' and g.fy_start = p.cy - 1) inv_ly,
      sum(g.v) filter (where g.doc_type = 'OB' and g.fy_start = p.cy) obv,
      sum(g.q) filter (where g.doc_type = 'OB' and g.fy_start = p.cy) obq,
      sum(g.v) filter (where g.doc_type = 'INV' and g.fy_start = p.cy) invv,
      sum(g.q) filter (where g.doc_type = 'INV' and g.fy_start = p.cy) invq,
      sum(g.v) filter (where g.fy_start = p.cy - 1) lyv,
      sum(g.q) filter (where g.fy_start = p.cy - 1) lyq
    from info i join grid g on g.code = i.code, p
    group by i.code, i.cat_code, i.description, i.product_series, p.cy)
  select jsonb_build_object(
    'cy', (select cy from p),
    'asof', (select max(posting_date) from sales_lines),
    'items', coalesce(jsonb_agg(jsonb_build_array(
       code, cat_code, description, product_series, ob, inv, ob_ly, inv_ly,
       round(obv), obq, round(invv), invq, round(lyv), lyq)
       order by code), '[]'::jsonb))
  from arr;
$$;
grant execute on function public.lvs_plan(int) to anon;
