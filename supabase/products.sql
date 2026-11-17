-- Products tab (17-Nov-2026). Read-only functions + one new table
-- (pot_lines = product lines of Zoho potentials). Safe to re-run.
-- Run PART 1, PART 2, PART 3, PART 4 one by one.

-- ============ PART 1 of 4 : family helpers ============
-- Product family of a Zoho product basket. Same groups as the
-- PM Cumulative tab. p_gov = Govt Projects (Prepaid/Smart only).
-- p_ext = also map basket spellings used in deal lines.
create or replace function public.prd_fam(
  p_bk text, p_gov boolean default false,
  p_ext boolean default false)
returns text language sql immutable as $$
  select case
    when b in ('Panel Meters', 'High End MFM', 'Nano VIP',
               'Power Quality') then 'Panel Meters'
    when p_ext and b in ('Hi End MFM Series', 'Mid Range MFM',
               'iELR', 'Din Meters', 'APFC', 'GMD')
      then 'Panel Meters'
    when b = 'ACCL' or (p_ext and b like 'ACCL%') then 'ACCL'
    when b = 'Transfer Switch' then 'ATES'
    when b in ('Prepaid & Smart Meters', 'Prepaid',
               'Smart Meters') then
      case when p_gov then 'Prepaid/Smart – Govt'
           else 'Prepaid/Smart' end
    when b = 'SWITCHGEAR' then 'LVS'
    when b = 'FDP' then 'FDP'
    when b = 'OEM' then 'OEM'
    else 'Other' end
  from (select regexp_replace(trim(coalesce(p_bk, '')),
                 '\s+', ' ', 'g') as b) x;
$$;

-- Family of one Zoho "Product / Solution type" value
-- (same groups as the Potentials and Leads tabs).
create or replace function public.prd_pfam(p_t text)
returns text language sql immutable as $$
  select case
    when t in ('Basic Meters', 'Multi-Function Meters',
      'Dual Source Meter', 'PQ Analyzer', 'Power Analyzer',
      'Transducers', 'Transducers / Isolators', 'CT''s',
      'Demand Controller', 'Demand Monitors and Controllers',
      'Load Manager', 'iPFC', 'EL-Tag', 'GMD', 'GD', 'EDC',
      'iELR', 'iPFC / iELR', 'BM/PDU', 'NanoVIP', 'Nano VIP')
      then 'Panel Meters'
    when t in ('ATeS', 'ATeS - Solenoid', 'MTS') then 'ATES'
    when t = 'ACCL' then 'ACCL'
    when t in ('LV SwitchGear',
      'Breaker Status Management System', 'EL-Guard')
      then 'LVS'
    when t in ('Prepaid Meter', 'Prepaid Meters',
      'Postpaid Meter', 'Prepaid Metering Solution',
      'Smart Meter') then 'Prepaid/Smart'
    else 'Other' end
  from (select trim(coalesce(p_t, '')) as t) x;
$$;

-- Target region of a raw region text (same as Path to Target)
create or replace function public.prd_rg(
  p_ur text, p_slp text, p_oem boolean)
returns text language sql immutable as $$
  select case
    when p_oem then 'OEM'
    when coalesce(p_slp, '') ilike 'dileep%' then 'Data Centre'
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
    when u in ('EAST INDIA', 'EAST', 'JHARKHAND/BIHAR')
      then 'East India'
    when u = 'EASTERN UP' then 'Eastern UP'
    when u in ('NAGPUR AND CG', 'NAGPUR & CG')
      then 'Nagpur & CG'
    when u = 'NORTH KERALA' then 'North Kerala'
    when u = 'SOUTH KERALA' then 'South Kerala'
    when u = 'MP' then 'MP'
    when u = 'RAJASTHAN' then 'Rajasthan'
    when u = 'GOA' then 'Goa'
    else 'Other regions' end
  from (select upper(trim(coalesce(p_ur, ''))) as u) x;
$$;

grant execute on function public.prd_fam(text, boolean, boolean)
  to anon, authenticated;
grant execute on function public.prd_pfam(text)
  to anon, authenticated;
grant execute on function public.prd_rg(text, text, boolean)
  to anon, authenticated;


-- ============ PART 2 of 4 : prd_cube (OB + invoice) ============
-- This FY and last FY by doc, month, family, region and series.
-- Rows (compact): [doc, year (0 = this FY, 1 = last FY), month,
--   family #, region #, series #, value L, qty, like-for-like L]
-- like-for-like = last FY cut at the same day as this FY's
-- latest data (for growth). Same OEM-account rules as PM tabs.
create or replace function public.prd_cube(p_cy int)
returns jsonb language plpgsql stable as $$
declare v_max date; v_res jsonb;
begin
  select max(posting_date) into v_max
    from sales_lines where fy_start = p_cy;
  with ov as materialized (
    select array(select ov_key from pm_card_override
                 where ov_mode = 'OEM') as oem,
           array(select ov_key from pm_card_override
                 where ov_mode = 'OEM_B') as oemb,
           array(select ov_key from pm_card_override
                 where ov_mode = 'EXCL') as excl),
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
    select s.doc_type as d,
      case when s.fy_start = p_cy then 0 else 1 end as y,
      s.fy_month::int as m, s.posting_date as pd,
      s.slp_name,
      upper(trim(coalesce(case when s.doc_type = 'OB'
        then s.region else coalesce(c.region, s.region)
        end, ''))) as ur,
      (coalesce(s.account_type, '') = 'Govt Projects'
       or upper(trim(coalesce(s.region, '')))
          = 'GOVT PROJECTS'
       or upper(trim(coalesce(s.se_reg, '')))
          = 'GOVT PROJECTS') as gov,
      case
        when s.card_name = any(ov.oem) then 'OEM'
        when s.card_name || '|' || coalesce(s.product_basket, '')
             = any(ov.oemb) then 'OEM'
        when coalesce(s.product_basket, '') = 'OEM'
             and s.card_name = any(ov.excl) then null
        else coalesce(nullif(trim(s.product_basket), ''),
                      '(blank)')
      end as eb,
      coalesce(nullif(trim(s.product_series), ''),
               '(no series)') as sr,
      coalesce(s.doc_total_fc, 0) as v,
      coalesce(s.quantity, 0) as q
    from sales_lines s cross join ov
    left join cust_region c
      on s.doc_type <> 'OB' and c.card_name = s.card_name
    where s.fy_start in (p_cy, p_cy - 1)),
  t as (
    select d, y, m, pd,
      prd_fam(eb, gov) as f,
      prd_rg(ur, slp_name, eb = 'OEM') as r,
      case when prd_fam(eb, gov) = 'Other'
           then regexp_replace(eb, '\s+', ' ', 'g') || ' · ' || sr
           else sr end as s,
      v, q
    from src where eb is not null),
  g as (
    select d, y, m, f, r, s,
      round(sum(v) / 1e5, 3) as v, round(sum(q), 0) as q,
      round(coalesce(sum(v) filter (where y = 0
        or v_max is null
        or pd <= (v_max - interval '1 year')::date), 0)
        / 1e5, 3) as lv
    from t group by 1, 2, 3, 4, 5, 6),
  df as (select array_agg(x order by x) a
         from (select distinct f x from g) z),
  dr as (select array_agg(x order by x) a
         from (select distinct r x from g) z),
  ds as (select array_agg(x order by x) a
         from (select distinct s x from g) z)
  select jsonb_build_object(
    'cy', p_cy, 'max_date', v_max,
    'max_date_ob', (select max(posting_date) from sales_lines
       where fy_start = p_cy and doc_type = 'OB'),
    'max_date_inv', (select max(posting_date) from sales_lines
       where fy_start = p_cy and doc_type = 'INV'),
    'fys', (select coalesce(jsonb_agg(f order by f desc), '[]')
       from (select distinct fy_start f from sales_lines) x),
    'last_sync', (select jsonb_build_object('at', finished_at,
       'status', status) from sales_sync_log
       order by id desc limit 1),
    'dict', jsonb_build_object('f', to_jsonb(df.a),
       'r', to_jsonb(dr.a), 's', to_jsonb(ds.a)),
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(
       case when g.d = 'OB' then 0 else 1 end, g.y, g.m,
       array_position(df.a, g.f) - 1,
       array_position(dr.a, g.r) - 1,
       array_position(ds.a, g.s) - 1,
       g.v, g.q, g.lv)), '[]') from g))
  into v_res from df, dr, ds;
  return v_res;
end;
$$;
grant execute on function public.prd_cube(int)
  to anon, authenticated;


-- ============ PART 3 of 4 : potential product lines ============
-- Filled by /api/sync-potentials?mode=lines (Zoho
-- "Products - Information" sub-table of each potential).
create table if not exists public.pot_lines (
  id text primary key,
  deal_id text,
  basket text,
  series text,
  model text,
  qty numeric,
  amount numeric,
  modified timestamptz,
  seen_at timestamptz default now());
create index if not exists pot_lines_deal
  on public.pot_lines (deal_id);
alter table public.pot_lines enable row level security;
revoke all on public.pot_lines from anon, authenticated;

-- sweep progress of the line sync (one row)
create table if not exists public.pot_lines_state (
  id int primary key default 1,
  cursor_id text,
  sweep_start timestamptz,
  last_done timestamptz,
  last_run timestamptz,
  note text);
insert into public.pot_lines_state (id) values (1)
  on conflict do nothing;
alter table public.pot_lines_state enable row level security;
revoke all on public.pot_lines_state from anon, authenticated;


-- ============ PART 4 of 4 : pipeline + leads for Products ============
-- prd_pipe: potentials with a closing date in the FY (any stage)
-- plus open ones with no closing date. Value per family from the
-- deal's product lines; deals without lines use Product/Solution
-- type, value split equally (est = true).
-- p_fam = null -> summary only; a family -> also its deal list.
create or replace function public.prd_pipe(
  p_cy int, p_fam text default null)
returns jsonb language sql stable security definer
set search_path = public as $$
with fy as (select make_date(p_cy, 4, 1) s,
                   make_date(p_cy + 1, 3, 31) e),
d as materialized (
  select b.*, upper(trim(coalesce(
           ptt_txt(to_jsonb(p.region)), ''))) = 'GOVT PROJECTS'
           as gov,
         ptt_txt(to_jsonb(p.project_name)) as project,
         coalesce(b.closing, current_date) as cdate
  from ptt_deals_base() b
  join potentials_cache p on p.id::text = b.id, fy
  where (b.closing between fy.s and fy.e)
     or (b.sgrp = 'Open' and b.closing is null)),
ln as materialized (
  select l.deal_id,
    prd_fam(l.basket, d.gov, true) as f,
    coalesce(nullif(trim(l.series), ''), '(no series)') as sr,
    sum(coalesce(l.qty, 0)) as q,
    sum(coalesce(l.amount, 0)) as a
  from pot_lines l join d on d.id = l.deal_id
  group by 1, 2, 3),
pt as (
  select d.id, trim(t) as t
  from d, unnest(string_to_array(
    regexp_replace(coalesce(d.ptype, ''), '^\[|\]$|"', '', 'g'),
    ',')) t
  where not exists (select 1 from ln where ln.deal_id = d.id)
    and trim(t) <> ''),
pf as (
  select id, case when prd_pfam(t) = 'Prepaid/Smart'
      and (select gov from d where d.id = pt.id)
      then 'Prepaid/Smart – Govt' else prd_pfam(t) end as f,
    t from pt),
pfn as (select id, f, string_agg(distinct t, ', ') ts
        from pf group by 1, 2),
pfc as (select id, count(*) n from pfn group by 1),
x as (
  select d.id, ln.f, ln.sr, ln.q, ln.a, false as est
  from d join ln on ln.deal_id = d.id
  union all
  select d.id, pfn.f, pfn.ts, null, d.amount / pfc.n, true
  from d join pfn on pfn.id = d.id
         join pfc on pfc.id = d.id),
fam as (
  select x.id, x.f, sum(x.a) a, bool_or(x.est) est,
    jsonb_agg(jsonb_build_array(x.sr, x.q,
      round(x.a / 1e5, 2)) order by x.a desc) sr
  from x group by 1, 2)
select jsonb_build_object(
  'asof', now(),
  'lines_synced', (select last_done from pot_lines_state
                   where id = 1),
  -- [family, stage group, closing yyyy-mm, region, deals,
  --  value L, weighted L]
  'sum', (select coalesce(jsonb_agg(jsonb_build_array(
            f, sgrp, ym, rg, n, a, w)), '[]')
          from (select fam.f, d.sgrp,
                  to_char(d.cdate, 'YYYY-MM') ym, d.rg,
                  count(*) n, round(sum(fam.a) / 1e5, 2) a,
                  round(sum(fam.a * d.prob / 100) / 1e5, 2) w
                from fam join d on d.id = fam.id
                group by 1, 2, 3, 4) z),
  -- deal list of one family: [id, deal, account, project, owner,
  --  region, stage group, stage, probability, closing,
  --  value L (this family), estimated?, series list]
  'list', case when p_fam is null then '[]'::jsonb else (
     select coalesce(jsonb_agg(jsonb_build_array(
       d.id, d.name, d.account, d.project, d.owner, d.rg,
       d.sgrp, d.stage, d.prob, d.closing,
       round(fam.a / 1e5, 2), fam.est, fam.sr)
       order by fam.a desc), '[]')
     from fam join d on d.id = fam.id
     where fam.f = p_fam) end);
$$;
grant execute on function public.prd_pipe(int, text)
  to anon, authenticated;

-- prd_leads: leads created this FY and last FY by week.
-- [week start (Monday), Product/Solution type text, region,
--  leads, order value L]  (split by product on the page)
create or replace function public.prd_leads(p_cy int)
returns jsonb language sql stable security definer
set search_path = public as $$
select jsonb_build_object(
  'asof', now(),
  'rows', (select coalesce(jsonb_agg(jsonb_build_array(
             wk, pt, rg, n, v)), '[]')
           from (select to_char(date_trunc('week',
                    created at time zone 'Asia/Kolkata'),
                    'YYYY-MM-DD') wk,
                  coalesce(ptype, '') pt, rg, count(*) n,
                  round(coalesce(sum(value), 0) / 1e5, 2) v
                 from ptt_leads_base()
                 where created >= make_date(p_cy - 1, 4, 1)
                 group by 1, 2, 3) z));
$$;
grant execute on function public.prd_leads(int)
  to anon, authenticated;

notify pgrst, 'reload schema';
