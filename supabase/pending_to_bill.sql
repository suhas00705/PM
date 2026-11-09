-- Pending to bill + carried-forward order book (09-Nov-2026)
-- Run the 4 parts in order in Supabase -> SQL editor. Safe to re-run.
-- Source: Zoho module "Pending Orders" (balance qty / balance amount
-- of approved orders not yet invoiced, refreshed by Zoho every
-- evening). Copied here by /api/sync-invoice?mode=pending (cron-2h).
-- Values are with tax, the same basis as every other portal number.

-- PART 1 of 4 : tables
create table if not exists public.pending_orders (
  id            text primary key,
  snap_at       timestamptz not null,
  oa_no         text,
  oa_date       date,
  item_no       text,
  model_no      text,
  descr         text,
  bal_qty       numeric,
  bal_amt       numeric,
  region        text,
  account       text,
  account_id    text,
  sales_emp     text,
  pdn_del_date  date,
  so_id         text,
  so_name       text,
  zoho_modified timestamptz);
create index if not exists pending_orders_snap
  on public.pending_orders (snap_at);
create index if not exists pending_orders_oa
  on public.pending_orders (oa_no);

-- one row: which copy (snap_at) is the live one
create table if not exists public.pending_snap (
  id        int primary key default 1,
  snap_at   timestamptz,
  rows      int,
  total     numeric,
  synced_at timestamptz,
  note      text);

-- read only through the functions below; the sync writes with
-- the service key
alter table public.pending_orders enable row level security;
alter table public.pending_snap enable row level security;

-- PART 2 of 4 : region name (same rules as ptt_base) + base rows
create or replace function public.rt_region_name(
  ur text, eb text, slp text)
returns text language sql immutable as $$
select case
  when eb = 'OEM' then 'OEM'
  when coalesce(slp, '') ilike 'dileep%' then 'Data Centre'
  when ur like 'EXPORT%' or ur like 'IBU%' then 'Export'
  when ur = 'GOVT PROJECTS' then 'Govt Projects'
  when ur = 'HYDERABAD' then 'Hyderabad'
  when ur = 'VIJAYAWADA' then 'Vijayawada'
  when ur = 'KARNATAKA' then 'Karnataka'
  when ur = 'DELHI NCR' then 'Delhi NCR'
  when ur = 'MUMBAI' then 'Mumbai'
  when ur = 'GUJARAT' then 'Gujarat'
  when ur = 'CHENNAI' then 'Chennai'
  when ur = 'PUNE' then 'Pune'
  when ur = 'MADURAI AND SALEM' then 'Madurai & Salem'
  when ur = 'COIMBATORE' then 'Coimbatore'
  when ur = 'PUNJAB' then 'Punjab'
  when ur in ('EAST INDIA', 'EAST') then 'East India'
  when ur = 'EASTERN UP' then 'Eastern UP'
  when ur in ('NAGPUR AND CG', 'NAGPUR & CG') then 'Nagpur & CG'
  when ur = 'NORTH KERALA' then 'North Kerala'
  when ur = 'SOUTH KERALA' then 'South Kerala'
  when ur = 'MP' then 'MP'
  when ur = 'RAJASTHAN' then 'Rajasthan'
  when ur = 'GOA' then 'Goa'
  else 'Other regions' end;
$$;

-- one row per pending item of the live copy.
-- Customer / region / basket / series come from the OA line
-- (same OA no. + item code) in sales_lines; if the item is not on
-- the OA, from the item's latest line anywhere.
-- Service Item and blank baskets are shown as Others.
create or replace function public.pend_base()
returns table(id text, oa text, oa_date date, card text,
              rg text, bk text, sr text, model text, descr text,
              q numeric, v numeric, pdn date, slp text)
language sql stable security definer set search_path = public
as $$
with sn as (select snap_at from pending_snap where id = 1),
p as materialized (
  select po.* from pending_orders po
  join sn on po.snap_at = sn.snap_at),
ov as materialized (
  select array(select ov_key from pm_card_override
               where ov_mode = 'OEM') as oem,
         array(select ov_key from pm_card_override
               where ov_mode = 'OEM_B') as oemb,
         array(select ov_key from pm_card_override
               where ov_mode = 'EXCL') as excl),
oal as materialized (
  select s.doc_num::text as dn, s.item_code, s.card_name,
         s.region, s.slp_name, s.product_basket,
         s.product_series, s.model_id, s.posting_date
  from sales_lines s
  where s.doc_type = 'OB'
    and s.doc_num::text in (select oa_no from p)),
ob as materialized (
  select distinct on (dn, item_code) *
  from oal order by dn, item_code, posting_date desc),
obd as materialized (
  select distinct on (dn) *
  from oal order by dn, posting_date desc),
im as materialized (
  select distinct on (s.item_code) s.item_code,
         s.product_basket, s.product_series, s.model_id
  from sales_lines s
  where s.item_code in (select item_no from p)
    and s.product_basket is not null
  order by s.item_code, s.posting_date desc),
x as (
  select p.*,
    coalesce(o.card_name, d.card_name, p.account) as card,
    upper(trim(coalesce(o.region, d.region, p.region, '')))
      as ur,
    coalesce(o.slp_name, d.slp_name, p.sales_emp) as sl,
    coalesce(o.product_basket, i.product_basket) as pb,
    coalesce(o.product_series, i.product_series) as ps,
    coalesce(o.model_id, i.model_id, p.model_no) as md
  from p
  left join ob o on o.dn = p.oa_no and o.item_code = p.item_no
  left join obd d on d.dn = p.oa_no
  left join im i on i.item_code = p.item_no),
y as (
  select x.*,
    case
      when x.card = any(ov.oem) then 'OEM'
      when x.card || '|' || coalesce(x.pb, '')
           = any(ov.oemb) then 'OEM'
      when coalesce(x.pb, '') = 'OEM'
           and x.card = any(ov.excl) then 'Others'
      when coalesce(trim(x.pb), '') in ('', 'Service Item')
           then 'Others'
      else regexp_replace(trim(x.pb), '\s+', ' ', 'g')
    end as eb
  from x cross join ov)
select y.id, y.oa_no, y.oa_date, coalesce(y.card, '(blank)'),
       public.rt_region_name(y.ur, y.eb, y.sl),
       y.eb,
       coalesce(nullif(trim(y.ps), ''), '(no series)'),
       y.md, y.descr,
       coalesce(y.bal_qty, 0),
       coalesce(y.bal_amt, 0) / 1e5,
       y.pdn_del_date, y.sl
from y;
$$;

-- PART 3 of 4 : the pop-up
-- p_rgs = regions in view (GM filter), null = all
-- p_rg / p_bk / p_sr = clicked region / basket / series (OA list)
create or replace function public.rt_pend(
  p_rgs text[] default null, p_rg text default null,
  p_bk text default null, p_sr text default null)
returns jsonb
language sql stable security definer set search_path = public
as $$
with fys as (
  select make_date(extract(year from (now() at time zone
           'Asia/Kolkata') - interval '3 months')::int, 4, 1)
         as d0),
b as materialized (
  select pb.*, (current_date - pb.oa_date) as age
  from pend_base() pb
  where p_rgs is null or pb.rg = any(p_rgs)),
f as materialized (
  select * from b
  where (p_rg is null or rg = p_rg)
    and (p_bk is null or bk = p_bk)
    and (p_sr is null or sr = p_sr)),
d as (
  select oa, min(oa_date) dt, min(card) card,
         mode() within group (order by rg) rg,
         (array_agg(bk order by v desc))[1] tb,
         (array_agg(sr order by v desc))[1] ts,
         count(distinct sr) ns, min(pdn) pdn, count(*) n,
         sum(q) q, sum(v) v
  from f group by oa)
select jsonb_build_object(
  'snap', (select jsonb_build_object('at', snap_at,
             'rows', rows, 'synced', synced_at)
           from pending_snap where id = 1),
  'fy0', (select d0 from fys),
  'tot', (select jsonb_build_object(
      'v', round(coalesce(sum(v), 0), 2),
      'q', round(coalesce(sum(q), 0), 0),
      'n', count(*),
      'oas', count(distinct oa),
      'cust', count(distinct card),
      'regions', count(distinct rg),
      'old', round(coalesce(sum(v) filter (
               where oa_date < (select d0 from fys)), 0), 2),
      'a30', round(coalesce(sum(v) filter (
               where age <= 30), 0), 2),
      'a90', round(coalesce(sum(v) filter (
               where age > 30 and age <= 90), 0), 2),
      'a90p', round(coalesce(sum(v) filter (
               where age > 90 or age is null), 0), 2))
    from b),
  'reg', (select coalesce(jsonb_agg(jsonb_build_array(
            rg, n, round(q, 0), round(v, 2), round(o, 2))
            order by v desc), '[]')
          from (select rg, count(distinct oa) n, sum(q) q,
                  sum(v) v, coalesce(sum(v) filter (where
                  oa_date < (select d0 from fys)), 0) o
                from b group by rg) x),
  'bsk', (select coalesce(jsonb_agg(jsonb_build_array(
            bk, n, round(q, 0), round(v, 2)) order by v desc), '[]')
          from (select bk, count(distinct oa) n, sum(q) q,
                  sum(v) v from b group by bk) x),
  'ser', (select coalesce(jsonb_agg(jsonb_build_array(
            sr, tb, round(q, 0), round(v, 2)) order by v desc), '[]')
          from (select sr, (array_agg(bk order by v desc))[1] tb,
                  sum(q) q, sum(v) v from b group by sr) x),
  'f', (select jsonb_build_object('v',
          round(coalesce(sum(v), 0), 2), 'oas', count(*))
        from d),
  'docs', (select coalesce(jsonb_agg(jsonb_build_array(
             oa, dt, card, rg, tb, ts, ns, pdn, n,
             round(q, 0), round(v, 2)) order by v desc), '[]')
           from (select * from d order by v desc limit 500) x));
$$;

-- items of one OA (when it is expanded)
create or replace function public.rt_pend_doc(p_oa text)
returns jsonb
language sql stable security definer set search_path = public
as $$
select coalesce(jsonb_agg(jsonb_build_array(
         model, descr, bk, sr, pdn, round(q, 0), round(v, 2))
         order by v desc), '[]')
from pend_base() where oa = p_oa;
$$;

grant execute on function public.rt_region_name(text, text, text)
  to anon, authenticated;
grant execute on function public.rt_pend(text[], text, text, text)
  to anon, authenticated;
grant execute on function public.rt_pend_doc(text)
  to anon, authenticated;
revoke execute on function public.pend_base()
  from anon, authenticated, public;

-- PART 4 of 4 : carried-forward orders billed this year
-- Invoices of FY p_cy whose OA was booked before 1-Apr of that FY
-- (last year's open orders billed this year), by region + month.
-- Region / basket rules = Region Tracking (ptt_base).
create or replace function public.rt_backlog(p_cy int)
returns jsonb
language sql stable security definer set search_path = public
as $$
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
oad as materialized (
  select dn, min(dt) as dt from (
    select doc_num::text dn, posting_date dt from sales_lines
    where doc_type = 'OB' and fy_start >= p_cy - 3
    union all
    select doc_num::text, posting_date from sales_lines_ob_dups
  ) z group by dn),
inv as materialized (
  select s.fy_month, s.card_name, s.slp_name, s.doc_total_fc,
    upper(trim(coalesce(c.region, s.region, ''))) as ur,
    case
      when s.card_name = any(ov.oem) then 'OEM'
      when s.card_name || '|' || coalesce(s.product_basket, '')
           = any(ov.oemb) then 'OEM'
      when coalesce(s.product_basket, '') = 'OEM'
           and s.card_name = any(ov.excl) then null
      else coalesce(nullif(trim(s.product_basket), ''), '(blank)')
    end as eb
  from sales_lines s cross join ov
  join oad a on a.dn = trim(s.oa_no)
  left join cust_region c on c.card_name = s.card_name
  where s.doc_type = 'INV' and s.fy_start = p_cy
    and a.dt < make_date(p_cy, 4, 1))
select jsonb_build_object(
  'cy', p_cy,
  'rows', (select coalesce(jsonb_agg(jsonb_build_array(rg, m,
             round(v, 2))), '[]')
           from (select public.rt_region_name(ur, eb, slp_name) rg,
                   fy_month::int m,
                   sum(coalesce(doc_total_fc, 0)) / 1e5 v
                 from inv where eb is not null
                 group by 1, 2) x));
$$;

grant execute on function public.rt_backlog(int)
  to anon, authenticated;
notify pgrst, 'reload schema';

-- checks (after the first pending sync):
-- select * from public.pending_snap;
-- select public.rt_pend() -> 'tot';
-- select public.rt_backlog(2026);
