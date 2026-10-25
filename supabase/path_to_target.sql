-- PART 1 of 4 : ptt_base
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
-- PART 2 of 4 : ptt_cube
create or replace function public.ptt_cube(p_cy int)
returns jsonb language sql stable as $$
with b as materialized (select * from public.ptt_base(p_cy)),
g as (
  select d, fy, m, rg, ch, prod, bk, sum(v) as v,
         sum(v) filter (where lfl) as lv
  from b group by 1, 2, 3, 4, 5, 6, 7),
drg as (select array_agg(x order by x) a
        from (select distinct rg x from g) t),
dch as (select array_agg(x order by x) a
        from (select distinct ch x from g) t),
dpr as (select array_agg(x order by x) a
        from (select distinct prod x from g) t),
dbk as (select array_agg(x order by x) a
        from (select distinct bk x from g) t),
rw as (
  select jsonb_build_array(
           case when d = 'OB' then 0 else 1 end,
           case when fy = p_cy then 0 else 1 end,
           m,
           array_position((select a from drg), rg) - 1,
           array_position((select a from dch), ch) - 1,
           array_position((select a from dpr), prod) - 1,
           array_position((select a from dbk), bk) - 1,
           round(v, 2),
           round(coalesce(lv, 0), 2)) as r
  from g
  where round(v, 2) <> 0 or round(coalesce(lv, 0), 2) <> 0)
select jsonb_build_object(
  'fmt', 'ptt1',
  'cy', p_cy,
  'max_ob', (select max(posting_date) from sales_lines
             where fy_start = p_cy and doc_type = 'OB'),
  'max_inv', (select max(posting_date) from sales_lines
              where fy_start = p_cy and doc_type = 'INV'),
  'last_sync', (select jsonb_build_object('at', finished_at,
                                          'status', status)
                from sales_sync_log order by id desc limit 1),
  'fys', (select coalesce(jsonb_agg(f order by f desc), '[]')
          from (select distinct fy_start f from sales_lines) x),
  'rg', (select to_jsonb(a) from drg),
  'ch', (select to_jsonb(a) from dch),
  'pr', (select to_jsonb(a) from dpr),
  'bk', (select to_jsonb(a) from dbk),
  'rows', (select coalesce(jsonb_agg(r), '[]') from rw));
$$;

grant execute on function public.ptt_cube(int) to anon, authenticated;
-- PART 3 of 4 : ptt_accounts
create or replace function public.ptt_accounts(
  p_cy int, p_doc text, p_months int[], p_rg text[],
  p_ch text[], p_prod text[], p_bk text[])
returns jsonb language sql stable as $$
with b as materialized (
  select * from public.ptt_base(p_cy)
  where d = p_doc
    and (coalesce(cardinality(p_months), 0) = 0 or m = any(p_months))
    and (coalesce(cardinality(p_rg), 0) = 0 or rg = any(p_rg))
    and (coalesce(cardinality(p_ch), 0) = 0 or ch = any(p_ch))
    and (coalesce(cardinality(p_prod), 0) = 0 or prod = any(p_prod))
    and (coalesce(cardinality(p_bk), 0) = 0 or bk = any(p_bk))),
a as materialized (
  select coalesce(card, '(blank)') as card,
         coalesce(sum(v) filter (where fy = p_cy), 0) as cy,
         coalesce(sum(v) filter (where fy <> p_cy and lfl), 0) as ll,
         coalesce(sum(v) filter (where fy <> p_cy), 0) as ly,
         max(pdate) as last_dt,
         (array_agg(rg order by v desc))[1] as rg,
         (array_agg(ch order by v desc))[1] as ch,
         (array_agg(prod order by v desc)
            filter (where fy = p_cy))[1] as tp
  from b group by 1),
j as (
  select *,
         jsonb_build_array(card, round(cy, 2), round(ll, 2),
                           round(ly, 2), last_dt, rg, ch, tp) as r
  from a),
t_top as (select r, cy as k from j where cy > 0
          order by cy desc limit 150),
t_lap as (select r, ly as k from j where cy <= 0 and ly > 0
          order by ly desc limit 150),
t_down as (select r, ll - cy as k from j where cy > 0 and ll > cy
           order by (ll - cy) desc limit 150)
select jsonb_build_object(
  'n_cy', (select count(*) from a where cy > 0),
  'n_ly', (select count(*) from a where ll > 0),
  'n_new', (select count(*) from a where cy > 0 and ly <= 0),
  'n_lapsed', (select count(*) from a where cy <= 0 and ll > 0),
  'v_lapsed', (select round(sum(ll), 2) from a
               where cy <= 0 and ll > 0),
  'top', (select coalesce(jsonb_agg(r order by k desc), '[]')
          from t_top),
  'lapsed', (select coalesce(jsonb_agg(r order by k desc), '[]')
          from t_lap),
  'down', (select coalesce(jsonb_agg(r order by k desc), '[]')
          from t_down));
$$;

grant execute on function
  public.ptt_accounts(int, text, int[], text[], text[], text[], text[])
  to anon, authenticated;
-- PART 4 of 4 : pipeline (Zoho potentials)
create or replace function public.ptt_txt(j jsonb)
returns text language sql immutable as $$
  select case jsonb_typeof(j)
    when 'array' then (select string_agg(x, ', ')
                       from jsonb_array_elements_text(j) x)
    when 'string' then j #>> '{}'
    when 'null' then null
    else j::text end;
$$;

create or replace function public.ptt_pipeline(p_cy int)
returns jsonb language sql stable security definer
set search_path = public as $$
with raw as (
  select nullif(trim(ptt_txt(to_jsonb(region))), '') as region,
         nullif(trim(ptt_txt(to_jsonb(product_solution_type))), '') as ptype,
         nullif(trim(ptt_txt(to_jsonb(stage))), '') as stage,
         nullif(trim(ptt_txt(to_jsonb(closing_date))), '') as cdate,
         nullif(trim(ptt_txt(to_jsonb(amount))), '') as amt,
         nullif(trim(ptt_txt(to_jsonb(probability))), '') as prob
  from potentials_cache),
p as (
  select coalesce(region, '(blank)') as region,
         coalesce(ptype, '(blank)') as ptype,
         coalesce(stage, '(blank)') as stage,
         to_char(left(cdate, 10)::date, 'YYYY-MM') as mon,
         case when amt ~ '^-?[0-9.]+$' then amt::numeric else 0 end as amt,
         case when prob ~ '^-?[0-9.]+$' then prob::numeric else 0 end as prob
  from raw
  where cdate ~ '^\d{4}-\d{2}-\d{2}'
    and left(cdate, 10)::date
        between current_date - 31 and make_date(p_cy + 1, 3, 31)
    and coalesce(stage, '') !~* '(won|lost|closed|drop|cancel)'),
g as (
  select region, ptype, stage, mon, count(*) as n,
         sum(amt) as a, sum(amt * prob / 100.0) as w
  from p group by 1, 2, 3, 4)
select jsonb_build_object(
  'asof', current_date,
  'rows', (select coalesce(jsonb_agg(jsonb_build_array(
             region, ptype, stage, mon, n,
             round(a / 100000.0, 2), round(w / 100000.0, 2))), '[]')
           from g));
$$;

grant execute on function public.ptt_txt(jsonb) to anon, authenticated;
grant execute on function public.ptt_pipeline(int) to anon, authenticated;
notify pgrst, 'reload schema';
