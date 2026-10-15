-- PART 5 : lead & pipeline analytics for Path to Target (16-Oct-2026)
-- Adds 3 columns to leads_cache / potentials_cache (filled by the sync)
-- and read-only functions. Safe to re-run.
alter table public.leads_cache
  add column if not exists modified_time timestamptz,
  add column if not exists last_activity_time timestamptz,
  add column if not exists lead_source text;
alter table public.potentials_cache
  add column if not exists modified_time timestamptz,
  add column if not exists last_activity_time timestamptz,
  add column if not exists lead_source text;

create or replace function public.ptt_ts(j jsonb)
returns timestamptz language sql immutable as $$
  select case when public.ptt_txt(j) ~ '^\d{4}-\d{2}-\d{2}'
              then public.ptt_txt(j)::timestamptz end;
$$;

-- Zoho region name (+ owner) -> target region used on the page
create or replace function public.ptt_region(p_raw text, p_owner text)
returns text language sql immutable as $$
  select case
    when coalesce(p_owner, '') ilike 'dileep%' then 'Data Centre'
    when u like 'HO%' then 'HO / OEM'
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

-- lead status -> group
create or replace function public.ptt_lead_grp(p_status text)
returns text language sql immutable as $$
  select case
    when p_status is null or p_status in ('Not Contacted', 'No Response',
         'Whatsapp Enquiry') then 'Untouched'
    when p_status in ('Contacted', 'Contact in Future', 'On Hold')
      then 'Working'
    when p_status in ('Qualified', 'Handover to Sales',
         'Govt Projects (Qualified)') then 'Qualified'
    when p_status ilike 'closed won%' or p_status = 'Assigned to Dealers'
      then 'To dealers'
    else 'Dropped' end;
$$;

create or replace function public.ptt_leads_base()
returns table(id text, name text, company text, owner text, rg text,
              status text, grp text, source text, ptype text,
              created timestamptz, last_act timestamptz, value numeric)
language sql stable security definer set search_path = public as $$
  select x.id, x.name, x.company, x.owner,
         ptt_region(x.region, x.owner), x.status,
         ptt_lead_grp(x.status), x.source, x.ptype, x.created,
         coalesce(x.la, x.mt, x.created),
         case when x.val ~ '^-?[0-9.]+$' then x.val::numeric end
  from (
    select l.id::text as id,
           ptt_txt(to_jsonb(l.full_name)) as name,
           ptt_txt(to_jsonb(l.company)) as company,
           nullif(trim(ptt_txt(to_jsonb(l.owner_name))), '') as owner,
           ptt_txt(to_jsonb(l.region)) as region,
           nullif(trim(ptt_txt(to_jsonb(l.lead_status))), '') as status,
           nullif(trim(l.lead_source), '') as source,
           nullif(trim(ptt_txt(to_jsonb(l.product_solution_type))), '')
             as ptype,
           ptt_ts(to_jsonb(l.created_time)) as created,
           l.last_activity_time as la, l.modified_time as mt,
           ptt_txt(to_jsonb(l.order_value)) as val
    from leads_cache l
    -- rows the new sync has not touched = converted / deleted in Zoho
    where coalesce(l.last_activity_time, l.modified_time) is not null) x;
$$;

create or replace function public.ptt_deals_base()
returns table(id text, name text, account text, owner text, rg text,
              stage text, sgrp text, ptype text, amount numeric,
              prob numeric, closing date, created timestamptz,
              last_act timestamptz, source text)
language sql stable security definer set search_path = public as $$
  select x.id, x.name, x.account, x.owner, ptt_region(x.region, x.owner),
         x.stage,
         case when x.stage ~* 'won' then 'Won'
              when x.stage ~* '(lost|closed|drop|cancel)' then 'Lost'
              else 'Open' end,
         x.ptype,
         case when x.amt ~ '^-?[0-9.]+$' then x.amt::numeric else 0 end,
         case when x.prob ~ '^-?[0-9.]+$' then x.prob::numeric else 0 end,
         case when x.cd ~ '^\d{4}-\d{2}-\d{2}' then left(x.cd, 10)::date end,
         x.created, coalesce(x.la, x.mt, x.created), x.source
  from (
    select p.id::text as id,
           ptt_txt(to_jsonb(p.deal_name)) as name,
           ptt_txt(to_jsonb(p.account_name)) as account,
           nullif(trim(ptt_txt(to_jsonb(p.owner_name))), '') as owner,
           ptt_txt(to_jsonb(p.region)) as region,
           coalesce(nullif(trim(ptt_txt(to_jsonb(p.stage))), ''), '(blank)')
             as stage,
           nullif(trim(ptt_txt(to_jsonb(p.product_solution_type))), '')
             as ptype,
           nullif(trim(ptt_txt(to_jsonb(p.amount))), '') as amt,
           nullif(trim(ptt_txt(to_jsonb(p.probability))), '') as prob,
           nullif(trim(ptt_txt(to_jsonb(p.closing_date))), '') as cd,
           ptt_ts(to_jsonb(p.created_time)) as created,
           p.last_activity_time as la, p.modified_time as mt,
           nullif(trim(p.lead_source), '') as source
    from potentials_cache p
    where coalesce(p.last_activity_time, p.modified_time) is not null) x;
$$;
-- PART 6 : lead & pipeline summary + action lists (16-Oct-2026). Read-only.
create or replace function public.ptt_demand(p_cy int)
returns jsonb language sql stable security definer
set search_path = public as $$
with fy as (select make_date(p_cy, 4, 1)::timestamptz as s,
                   make_date(p_cy - 1, 4, 1)::timestamptz as ls,
                   make_date(p_cy + 1, 3, 31) as e),
l as materialized (
  select b.*, (b.grp in ('Untouched', 'Working', 'Qualified')) as op,
         extract(day from now() - b.last_act)::int as idle
  from ptt_leads_base() b, fy
  where b.created >= fy.ls),
lf as (select * from l, fy where l.created >= fy.s),
d as materialized (
  select b.*, extract(day from now() - b.last_act)::int as idle
  from ptt_deals_base() b, fy
  where b.sgrp = 'Open' or b.created >= fy.s),
dw as (
  select d.*, (d.sgrp = 'Open' and d.closing is not null
               and d.closing between current_date - 31 and fy.e) as inwin,
         (d.sgrp = 'Open' and d.closing < current_date) as stale
  from d, fy)
select jsonb_build_object(
  'asof', now(),
  'has_activity', (select count(*) > 0 from leads_cache
                   where last_activity_time is not null),
  -- [region, owner, status, group, leads, no action 7d, 15d, 30d]
  'lf', (select coalesce(jsonb_agg(jsonb_build_array(rg, owner, status, grp,
           n, n7, n15, n30)), '[]')
         from (select rg, owner, status, grp, count(*) n,
                 count(*) filter (where op and idle > 7) n7,
                 count(*) filter (where op and idle > 15) n15,
                 count(*) filter (where op and idle > 30) n30
               from lf group by 1, 2, 3, 4) t),
  -- [region, year-month created, leads]
  'lt', (select coalesce(jsonb_agg(jsonb_build_array(rg, ym, n)), '[]')
         from (select rg, to_char(created at time zone 'Asia/Kolkata',
                 'YYYY-MM') ym, count(*) n
               from l group by 1, 2) t),
  -- [region, lead source, group, leads]
  'ls', (select coalesce(jsonb_agg(jsonb_build_array(rg, src, grp, n)), '[]')
         from (select rg, coalesce(source, '(not synced yet)') src, grp,
                 count(*) n from lf group by 1, 2, 3) t),
  -- [product type, region, group, leads]
  'lp', (select coalesce(jsonb_agg(jsonb_build_array(pt, rg, grp, n)), '[]')
         from (select coalesce(ptype, '(blank)') pt, rg, grp, count(*) n
               from lf group by 1, 2, 3) t),
  -- [region, owner, stage group, stage, deals, amount L, weighted L,
  --  in-window deals, in-window L, in-window weighted L,
  --  stale deals, stale L, open deals no action 15d]
  'df', (select coalesce(jsonb_agg(jsonb_build_array(rg, owner, sgrp, stage,
           n, a, w, nw, aw, ww, ns, as2, nn)), '[]')
         from (select rg, owner, sgrp, stage, count(*) n,
                 round(sum(amount) / 1e5, 2) a,
                 round(sum(amount * prob / 100) / 1e5, 2) w,
                 count(*) filter (where inwin) nw,
                 round(coalesce(sum(amount) filter (where inwin), 0) / 1e5, 2)
                   aw,
                 round(coalesce(sum(amount * prob / 100)
                   filter (where inwin), 0) / 1e5, 2) ww,
                 count(*) filter (where stale) ns,
                 round(coalesce(sum(amount) filter (where stale), 0) / 1e5, 2)
                   as2,
                 count(*) filter (where sgrp = 'Open' and idle > 15) nn
               from dw group by 1, 2, 3, 4) t),
  -- [lead source, stage group, deals, amount L]
  'ds', (select coalesce(jsonb_agg(jsonb_build_array(src, sgrp, n, a)), '[]')
         from (select coalesce(source, '(not synced yet)') src, sgrp,
                 count(*) n, round(sum(amount) / 1e5, 2) a
               from dw, fy where dw.created >= fy.s group by 1, 2) t),
  -- [product type, region, stage group, deals, amount L, in-window weighted L]
  'dp', (select coalesce(jsonb_agg(jsonb_build_array(pt, rg, sgrp, n, a, ww)),
           '[]')
         from (select coalesce(ptype, '(blank)') pt, rg, sgrp, count(*) n,
                 round(sum(amount) / 1e5, 2) a,
                 round(coalesce(sum(amount * prob / 100)
                   filter (where inwin), 0) / 1e5, 2) ww
               from dw group by 1, 2, 3) t));
$$;

-- Action lists. p_kind: untouched | noaction | qualified | stale | bigdeals
--                       | idledeals
create or replace function public.ptt_demand_list(p_cy int, p_kind text,
  p_rg text[], p_owner text[], p_days int)
returns jsonb language sql stable security definer
set search_path = public as $$
with fy as (select make_date(p_cy, 4, 1)::timestamptz as s,
                   make_date(p_cy + 1, 3, 31) as e),
q as (select ((date_trunc('quarter', current_date)
               + interval '3 months')::date - 1) as qe),
lb as (
  select b.*, extract(day from now() - b.last_act)::int as idle,
         extract(day from now() - b.created)::int as age
  from ptt_leads_base() b
  where (coalesce(cardinality(p_rg), 0) = 0 or b.rg = any(p_rg))
    and (coalesce(cardinality(p_owner), 0) = 0 or b.owner = any(p_owner))),
db as (
  select b.*, extract(day from now() - b.last_act)::int as idle
  from ptt_deals_base() b
  where b.sgrp = 'Open'
    and (coalesce(cardinality(p_rg), 0) = 0 or b.rg = any(p_rg))
    and (coalesce(cardinality(p_owner), 0) = 0 or b.owner = any(p_owner))),
ll as (
  select lb.* from lb, fy
  where lb.created >= fy.s - interval '6 months'
    and case p_kind
      when 'untouched' then lb.grp = 'Untouched'
                            and lb.age > coalesce(p_days, 0)
      when 'noaction' then lb.grp in ('Untouched', 'Working', 'Qualified')
                           and lb.idle > coalesce(p_days, 15)
      when 'qualified' then lb.grp = 'Qualified'
      else false end
  order by lb.idle desc nulls last limit 1000),
dl as (
  select db.* from db, fy, q
  where case p_kind
      when 'stale' then db.closing < current_date
      when 'bigdeals' then db.amount >= 2500000 and db.closing <= q.qe
      when 'idledeals' then db.idle > coalesce(p_days, 15)
      else false end
  order by db.amount desc limit 1000)
select jsonb_build_object(
  'kind', p_kind,
  -- leads: [name, company, owner, region, status, source, product type,
  --         created, last action, days idle]
  'leads', (select coalesce(jsonb_agg(jsonb_build_array(name, company, owner,
              rg, status, source, ptype, created::date, last_act::date,
              idle) order by idle desc nulls last), '[]') from ll),
  -- deals: [deal, account, owner, region, stage, product type, amount L,
  --         probability, closing date, last action, days idle, source]
  'deals', (select coalesce(jsonb_agg(jsonb_build_array(name, account, owner,
              rg, stage, ptype, round(amount / 1e5, 2), prob, closing,
              last_act::date, idle, source) order by amount desc), '[]')
            from dl));
$$;

grant execute on function public.ptt_ts(jsonb) to anon, authenticated;
grant execute on function public.ptt_region(text, text) to anon, authenticated;
grant execute on function public.ptt_lead_grp(text) to anon, authenticated;
grant execute on function public.ptt_demand(int) to anon, authenticated;
grant execute on function
  public.ptt_demand_list(int, text, text[], text[], int)
  to anon, authenticated;
notify pgrst, 'reload schema';
