-- Region Tracking, round 2 (25-Nov-2026). Read-only. Safe to re-run.
-- Drill-down of one region: every customer (channel partners,
-- VARs, others) by product basket, product series and month,
-- this FY and last FY. Same region / basket rules as rt_series.
-- rows: [customer, account type, basket, series, y (0 = this FY,
--        1 = last FY), month, value L, qty,
--        value L like-for-like (last FY cut at the same day)]
create or replace function public.rt_partners(
  p_cy int, p_doc text, p_rg text)
returns jsonb language sql stable as $$
with ov as materialized (
  select array(select ov_key from pm_card_override
               where ov_mode = 'OEM') as oem,
         array(select ov_key from pm_card_override
               where ov_mode = 'OEM_B') as oemb,
         array(select ov_key from pm_card_override
               where ov_mode = 'EXCL') as excl),
mx as materialized (
  select max(posting_date) as mxd
  from sales_lines where fy_start = p_cy),
ob_cust as materialized (
  select card_name, region,
         sum(abs(coalesce(doc_total_fc, 0))) as v
  from sales_lines
  where doc_type = 'OB' and region is not null
    and card_name is not null
  group by 1, 2),
cust_region as materialized (
  select distinct on (card_name) card_name, region
  from ob_cust order by card_name, v desc),
src as materialized (
  select s.fy_start, s.fy_month, s.posting_date,
    s.slp_name, s.doc_total_fc, s.product_series,
    s.quantity, s.card_name, s.account_type,
    upper(trim(coalesce(case when s.doc_type = 'OB'
      then s.region else coalesce(c.region, s.region)
      end, ''))) as ur,
    case
      when s.card_name = any(ov.oem) then 'OEM'
      when s.card_name || '|' || coalesce(s.product_basket, '')
           = any(ov.oemb) then 'OEM'
      when coalesce(s.product_basket, '') = 'OEM'
           and s.card_name = any(ov.excl) then null
      else coalesce(nullif(trim(s.product_basket), ''),
                    '(blank)')
    end as eb
  from sales_lines s cross join ov
  left join cust_region c
    on s.doc_type <> 'OB' and c.card_name = s.card_name
  where s.fy_start in (p_cy, p_cy - 1)
    and s.doc_type = p_doc),
t as (
  select s.*,
    case
      when s.eb = 'OEM' then 'OEM'
      when coalesce(s.slp_name, '') ilike 'dileep%'
        then 'Data Centre'
      when s.ur like 'EXPORT%' or s.ur like 'IBU%'
        then 'Export'
      when s.ur = 'GOVT PROJECTS' then 'Govt Projects'
      when s.ur = 'HYDERABAD' then 'Hyderabad'
      when s.ur = 'VIJAYAWADA' then 'Vijayawada'
      when s.ur = 'KARNATAKA' then 'Karnataka'
      when s.ur = 'DELHI NCR' then 'Delhi NCR'
      when s.ur = 'MUMBAI' then 'Mumbai'
      when s.ur = 'GUJARAT' then 'Gujarat'
      when s.ur = 'CHENNAI' then 'Chennai'
      when s.ur = 'PUNE' then 'Pune'
      when s.ur = 'MADURAI AND SALEM'
        then 'Madurai & Salem'
      when s.ur = 'COIMBATORE' then 'Coimbatore'
      when s.ur = 'PUNJAB' then 'Punjab'
      when s.ur in ('EAST INDIA', 'EAST') then 'East India'
      when s.ur = 'EASTERN UP' then 'Eastern UP'
      when s.ur in ('NAGPUR AND CG', 'NAGPUR & CG')
        then 'Nagpur & CG'
      when s.ur = 'NORTH KERALA' then 'North Kerala'
      when s.ur = 'SOUTH KERALA' then 'South Kerala'
      when s.ur = 'MP' then 'MP'
      when s.ur = 'RAJASTHAN' then 'Rajasthan'
      when s.ur = 'GOA' then 'Goa'
      else 'Other regions' end as rg,
    regexp_replace(s.eb, '\s+', ' ', 'g') as bk
  from src s where s.eb is not null),
g as (
  select coalesce(card_name, '(blank)') card,
    coalesce(account_type, '(blank)') acct,
    bk,
    coalesce(nullif(trim(product_series), ''),
             '(no series)') sr,
    case when fy_start = p_cy then 0 else 1 end y,
    fy_month::int m,
    sum(coalesce(doc_total_fc, 0)) / 100000.0 v,
    sum(coalesce(quantity, 0)) q,
    sum(coalesce(doc_total_fc, 0)) filter (
      where fy_start = p_cy or mx.mxd is null
        or posting_date <= (mx.mxd - interval '1 year')::date
    ) / 100000.0 lv
  from t cross join mx
  where rg = p_rg
  group by 1, 2, 3, 4, 5, 6)
select jsonb_build_object(
  'max_date', (select mxd from mx),
  'rows', coalesce((select jsonb_agg(jsonb_build_array(
      card, acct, bk, sr, y, m, round(v, 3), round(q, 0),
      round(coalesce(lv, 0), 3)))
    from g), '[]'::jsonb));
$$;
grant execute on function public.rt_partners(int, text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
