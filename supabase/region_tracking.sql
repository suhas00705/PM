-- Region Tracking tab (25-Oct-2026). Read-only functions. Safe to re-run.
-- Uses the same region / basket rules as Path to Target (ptt_base).
-- PART 1 : potentials won, by region and closing month
create or replace function public.rt_won(p_cy int)
returns jsonb language sql stable security definer
set search_path = public as $$
with w as (
  select rg,
    case when closing >= make_date(p_cy, 4, 1)
         then 0 else 1 end as y,
    extract(month from closing)::int as m,
    sum(amount) / 100000.0 as v,
    count(*) as n
  from ptt_deals_base()
  where sgrp = 'Won'
    and closing >= make_date(p_cy - 1, 4, 1)
    and closing < make_date(p_cy + 1, 4, 1)
  group by 1, 2, 3)
select jsonb_build_object(
  'cy', p_cy,
  'rows', coalesce((select jsonb_agg(jsonb_build_array(
      rg, y, m, round(v, 2), n)) from w), '[]'::jsonb));
$$;
grant execute on function public.rt_won(int) to anon, authenticated;

-- PART 2 : product series of one region + basket (drill-down)
create or replace function public.rt_series(
  p_cy int, p_doc text, p_rg text, p_bk text)
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
  select case when fy_start = p_cy then 0 else 1 end y,
    fy_month::int m,
    coalesce(nullif(trim(product_series), ''), '(no series)')
      as sr,
    sum(coalesce(doc_total_fc, 0)) / 100000.0 as v,
    sum(coalesce(doc_total_fc, 0)) filter (
      where fy_start = p_cy or mx.mxd is null
        or posting_date <= (mx.mxd - interval '1 year')::date
    ) / 100000.0 as lv
  from t cross join mx
  where rg = p_rg and bk = p_bk
  group by 1, 2, 3)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(jsonb_build_array(
      y, m, sr, round(v, 3), round(coalesce(lv, 0), 3)))
    from g), '[]'::jsonb));
$$;
grant execute on function
  public.rt_series(int, text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';

-- check (should return rows):
-- select public.rt_won(2026);
-- select public.rt_series(2026, 'OB', 'Hyderabad', 'Panel Meters');
