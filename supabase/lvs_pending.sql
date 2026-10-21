-- LVS OB / Stock view: pending OA lines (OB qty - invoiced qty per OA + item), monthly OB/INV totals.
-- Zoho Sales Order id from oa_deal_link. Excludes B&E / TEST DUMMY and WBT/TM items. Safe to re-run.
create or replace function public.lvs_pending(p_cy int default null)
returns jsonb language sql stable security definer
set search_path = public as $$
with p as (
  select coalesce(p_cy, case when extract(month from current_date) >= 4
    then extract(year from current_date)::int
    else extract(year from current_date)::int - 1 end) as cy),
b as materialized (
  select s.* from sales_lines s, p
  where s.product_basket = 'SWITCHGEAR'
    and s.fy_start >= p.cy - 1
    and coalesce(s.card_name, '')
      !~* 'B\s*&\s*E\s+ELECTRIC|TEST\s+DUMMY'
    and coalesce(s.cat_code, '') !~* '^(WBT|TM)'),
ob as (
  select doc_num::text oa, item_code code,
    min(posting_date) d, max(card_name) cust,
    max(account_type) atype, max(region) rg,
    max(slp_name) eng,
    sum(quantity) q, sum(doc_total_fc) v
  from b where doc_type = 'OB' and doc_num is not null
  group by 1, 2),
inv as (
  select oa_no oa, item_code code, sum(quantity) q
  from b where doc_type = 'INV' and oa_no is not null
  group by 1, 2),
so as (
  select distinct on (sap_oa_no) sap_oa_no oa, so_id zid
  from oa_deal_link where sap_oa_no is not null
  order by sap_oa_no, oa_date desc nulls last),
pend as (
  select ob.*, so.zid, coalesce(inv.q, 0) iq,
    ob.q - coalesce(inv.q, 0) pq
  from ob left join inv using (oa, code)
    left join so on so.oa = ob.oa
  where ob.q - coalesce(inv.q, 0) > 0),
mon as (
  select (fy_month + 8) % 12 mi,
    sum(quantity) filter (where doc_type = 'OB') obq,
    sum(doc_total_fc) filter (where doc_type = 'OB') obv,
    sum(quantity) filter (where doc_type = 'INV') invq,
    sum(doc_total_fc) filter (where doc_type = 'INV') invv
  from b, p where fy_start = p.cy group by 1)
select jsonb_build_object(
  'cy', (select cy from p),
  'asof', (select max(posting_date) from b),
  'months', (select coalesce(jsonb_agg(jsonb_build_array(mi,
      coalesce(obq, 0), round(coalesce(obv, 0)),
      coalesce(invq, 0), round(coalesce(invv, 0)))
      order by mi), '[]') from mon),
  'lines', (select coalesce(jsonb_agg(jsonb_build_array(
      oa, d, cust, atype, rg, eng, zid, code, q, iq, pq,
      round(v * pq / nullif(q, 0)))
      order by d, oa, code), '[]') from pend));
$$;
grant execute on function public.lvs_pending(int) to anon;
notify pgrst, 'reload schema';
