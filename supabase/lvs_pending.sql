-- LVS OB / Stock view: pending OA lines (OB qty - invoiced qty per OA + item), monthly OB/INV totals.
-- 23-Oct-2026: monthly OB / INV totals ('months') now use the same basis as PM cumulative tracking
-- (all Switchgear lines, same OEM card overrides), so the LVS month figures match that page.
-- Pending / carry / stock logic still uses the L&K item filter below.
-- Zoho Sales Order id from oa_deal_link. Excludes B&E / TEST DUMMY and WBT/TM items, MCB / isolator / RCCB / SPD / DB items (EM1P-EM4P, EI2P-EI4P, ER2P/ER4P, EASP, EDSP, EDHT, EDPI, EDVT). Safe to re-run.
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
    and coalesce(s.cat_code, '')
      !~* '^(WBT|TM|EM[1-4]P|EI[2-4]P|ER[24]P)'
    and coalesce(s.cat_code, '')
      !~* '^(EASP|EDSP|EDHT|EDPI|EDVT)'),
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
ms as (
  select g mi, make_date(p.cy + (g >= 9)::int, (g + 3) % 12 + 1, 1) d
  from p, generate_series(0, 11) g
  where make_date(p.cy + (g >= 9)::int, (g + 3) % 12 + 1, 1)
    <= current_date),
invd as (
  select oa_no oa, item_code code, posting_date d, quantity q
  from b where doc_type = 'INV' and oa_no is not null),
ib as (
  select ms.mi, i.oa, i.code, sum(i.q) q
  from ms join invd i on i.d < ms.d group by 1, 2, 3),
carry as (
  select ms.mi,
    sum(greatest(o.q - coalesce(ib.q, 0), 0)) cq,
    sum(o.v * greatest(o.q - coalesce(ib.q, 0), 0)
      / nullif(o.q, 0)) cv
  from ms join ob o on o.d < ms.d
  left join ib on ib.mi = ms.mi and ib.oa = o.oa
    and ib.code = o.code
  group by ms.mi),
ovr as (
  select array_agg(ov_key) filter
    (where ov_mode = 'OEM') o1,
  array_agg(ov_key) filter
    (where ov_mode = 'OEM_B') o2
  from pm_card_override),
mon as (
  select (s.fy_month + 8) % 12 mi,
    sum(quantity) filter (where doc_type = 'OB') obq,
    sum(doc_total_fc) filter (where doc_type = 'OB') obv,
    sum(quantity) filter (where doc_type = 'INV') invq,
    sum(doc_total_fc) filter (where doc_type = 'INV') invv
  from sales_lines s, p, ovr
  where s.fy_start = p.cy
    and s.product_basket = 'SWITCHGEAR'
    and not coalesce(s.card_name
      = any(coalesce(ovr.o1, '{}')), false)
    and not coalesce(s.card_name || '|SWITCHGEAR'
      = any(coalesce(ovr.o2, '{}')), false)
  group by 1)
select jsonb_build_object(
  'cy', (select cy from p),
  'asof', (select max(posting_date) from b),
  'months', (select coalesce(jsonb_agg(jsonb_build_array(mi,
      coalesce(obq, 0), round(coalesce(obv, 0)),
      coalesce(invq, 0), round(coalesce(invv, 0)))
      order by mi), '[]') from mon),
  'carry', (select coalesce(jsonb_agg(jsonb_build_array(mi,
      round(coalesce(cq, 0)), round(coalesce(cv, 0)))
      order by mi), '[]') from carry),
  'lines', (select coalesce(jsonb_agg(jsonb_build_array(
      oa, d, cust, atype, rg, eng, zid, code, q, iq, pq,
      round(v * pq / nullif(q, 0)))
      order by d, oa, code), '[]') from pend));
$$;
grant execute on function public.lvs_pending(int) to anon;
notify pgrst, 'reload schema';
