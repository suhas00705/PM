-- 25-Oct-2026: region rule change (user):
--   OEM region = OEM basket exactly as in PM Cumulative Tracking
--   (OEM basket + OEM override accounts, any geography).
--   HO / HO - ISTATIC (non-OEM) now falls in 'Other regions'.
--   Potentials from region HO also go to 'Other regions'.
-- Run all of this once in Supabase. Safe to re-run.

-- PART A : ptt_base (Path to Target + Region Tracking)
create or replace function public.ptt_base(p_cy int)
returns table(d text, fy int, m int, pdate date, card text, rg text,
              ch text, prod text, bk text, v numeric, lfl boolean)
language sql stable as $$
with ov as materialized (
  select array(select ov_key from public.pm_card_override
               where ov_mode = 'OEM') as oem,
         array(select ov_key from public.pm_card_override
               where ov_mode = 'OEM_B') as oemb,
         array(select ov_key from public.pm_card_override
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
src as (
  select s.doc_type, s.fy_start, s.fy_month, s.posting_date,
         s.card_name, s.account_type, s.slp_name, s.doc_total_fc,
         upper(trim(coalesce(case when s.doc_type = 'OB' then s.region
              else coalesce(c.region, s.region) end, ''))) as ur,
         (coalesce(s.account_type, '') = 'Govt Projects'
          or upper(trim(coalesce(s.region, ''))) = 'GOVT PROJECTS'
          or upper(trim(coalesce(s.se_reg, ''))) = 'GOVT PROJECTS') as gov,
         case
           when s.card_name = any(ov.oem) then 'OEM'
           when s.card_name || '|' || coalesce(s.product_basket, '')
                = any(ov.oemb) then 'OEM'
           when coalesce(s.product_basket, '') = 'OEM'
                and s.card_name = any(ov.excl) then null
           else coalesce(nullif(trim(s.product_basket), ''), '(blank)')
         end as eb
  from sales_lines s cross join ov
  left join cust_region c
    on s.doc_type <> 'OB' and c.card_name = s.card_name
  where s.fy_start in (p_cy, p_cy - 1))
select s.doc_type, s.fy_start, s.fy_month::int, s.posting_date, s.card_name,
  case
    when s.eb = 'OEM' then 'OEM'
    when coalesce(s.slp_name, '') ilike 'dileep%' then 'Data Centre'
    when s.ur like 'EXPORT%' or s.ur like 'IBU%' then 'Export'
    when s.ur = 'GOVT PROJECTS' then 'Govt Projects'
    when s.ur = 'HYDERABAD' then 'Hyderabad'
    when s.ur = 'VIJAYAWADA' then 'Vijayawada'
    when s.ur = 'KARNATAKA' then 'Karnataka'
    when s.ur = 'DELHI NCR' then 'Delhi NCR'
    when s.ur = 'MUMBAI' then 'Mumbai'
    when s.ur = 'GUJARAT' then 'Gujarat'
    when s.ur = 'CHENNAI' then 'Chennai'
    when s.ur = 'PUNE' then 'Pune'
    when s.ur = 'MADURAI AND SALEM' then 'Madurai & Salem'
    when s.ur = 'COIMBATORE' then 'Coimbatore'
    when s.ur = 'PUNJAB' then 'Punjab'
    when s.ur in ('EAST INDIA', 'EAST') then 'East India'
    when s.ur = 'EASTERN UP' then 'Eastern UP'
    when s.ur in ('NAGPUR AND CG', 'NAGPUR & CG') then 'Nagpur & CG'
    when s.ur = 'NORTH KERALA' then 'North Kerala'
    when s.ur = 'SOUTH KERALA' then 'South Kerala'
    when s.ur = 'MP' then 'MP'
    when s.ur = 'RAJASTHAN' then 'Rajasthan'
    when s.ur = 'GOA' then 'Goa'
    else 'Other regions' end,
  case
    when s.account_type in ('Channel Partners', 'Channel Partner')
      then 'Channel Partners'
    when s.account_type in ('Dealer', 'Distributor', 'Retailer',
      'Value Added Reseller', 'Agent', 'SCP (Service Channel Partner)')
      then 'Dealers & Distributors'
    when s.account_type in ('Panel Builder', 'PB-Direct')
      then 'Panel Builders'
    when s.account_type in ('OEM', 'OEM/End Customer')
      then 'OEM accounts'
    when s.account_type in ('Contractor', 'System Integrators',
      'Builders', 'Consultants') then 'Contractors, SI & Consultants'
    when s.account_type in ('Customer', 'End Customer')
      then 'End Customers'
    when s.account_type = 'Govt Projects' then 'Govt'
    else 'Others / blank' end,
  case
    when s.eb in ('Panel Meters', 'High End MFM', 'Nano VIP',
                  'Power Quality') then 'Panel Meters'
    when s.eb = 'ACCL' then 'ACCL'
    when s.eb = 'Transfer Switch' then 'ATES'
    when s.eb in ('Prepaid & Smart Meters', 'Prepaid', 'Smart Meters')
      then case when s.gov then 'Prepaid/Smart – Govt'
                else 'Prepaid/Smart' end
    when s.eb = 'SWITCHGEAR' then 'LVS'
    when s.eb = 'FDP' then 'FDP'
    when s.eb = 'OEM' then 'OEM'
    when s.eb = 'Software' then 'Software'
    else 'Others' end,
  regexp_replace(s.eb, '\s+', ' ', 'g'),
  round(coalesce(s.doc_total_fc, 0) / 100000.0, 4),
  (s.fy_start = p_cy or mx.mxd is null
   or s.posting_date <= (mx.mxd - interval '1 year')::date)
from src s cross join mx
where s.eb is not null;
$$;

grant execute on function public.ptt_base(int) to anon, authenticated;

-- PART B : ptt_region (potentials / leads)
create or replace function public.ptt_region(p_raw text, p_owner text)
returns text language sql immutable as $$
  select case
    when coalesce(p_owner, '') ilike 'dileep%' then 'Data Centre'
    when u like 'EXPORT%' or u like 'IBU%' then 'Export'
    when u = 'GOVT PROJECTS' then 'Govt Projects'
    when u = 'HYDERABAD' then 'Hyderabad'
    when u = 'VIJAYAWADA' then 'Vijayawada'
    when u = 'KARNATAKA' then 'Karnataka'
    when u = 'DELHI NCR' then 'Delhi NCR'
    when u = 'MUMBAI' then 'Mumbai'
    when u = 'GUJARAT' then 'Gujarat'
    when u = 'CHENNAI' then 'Chennai'
    when u = 'PUNE' then 'Pune'
    when u = 'MADURAI AND SALEM' then 'Madurai & Salem'
    when u = 'COIMBATORE' then 'Coimbatore'
    when u = 'PUNJAB' then 'Punjab'
    when u in ('EAST INDIA', 'EAST', 'JHARKHAND/BIHAR') then 'East India'
    when u = 'EASTERN UP' then 'Eastern UP'
    when u in ('NAGPUR AND CG', 'NAGPUR & CG') then 'Nagpur & CG'
    when u = 'NORTH KERALA' then 'North Kerala'
    when u = 'SOUTH KERALA' then 'South Kerala'
    when u = 'MP' then 'MP'
    when u = 'RAJASTHAN' then 'Rajasthan'
    when u = 'GOA' then 'Goa'
    else 'Other regions' end
  from (select upper(trim(coalesce(p_raw, ''))) as u) x;
$$;

-- PART C : rt_series (Region Tracking drill-down)
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
