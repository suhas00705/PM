-- Products tab, round 4 (25-Nov-2026). Safe to re-run.
-- Run PART 1, PART 2, PART 3, PART 4 one by one.

-- ============ PART 1 of 4 : prd_pipe + created date ============
-- Same as before; each deal in the list also carries its created
-- date, for the New / Carried over column.
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
  --  value L (this family), estimated?, series list,
  --  created date (IST)]
  'list', case when p_fam is null then '[]'::jsonb else (
     select coalesce(jsonb_agg(jsonb_build_array(
       d.id, d.name, d.account, d.project, d.owner, d.rg,
       d.sgrp, d.stage, d.prob, d.closing,
       round(fam.a / 1e5, 2), fam.est, fam.sr,
       to_char(d.created at time zone 'Asia/Kolkata', 'YYYY-MM-DD'))
       order by fam.a desc), '[]')
     from fam join d on d.id = fam.id
     where fam.f = p_fam) end);
$$;
grant execute on function public.prd_pipe(int, text)
  to anon, authenticated;


-- ============ PART 2 of 4 : lead product lines (table) ============
-- Filled by /api/sync-potentials?mode=leadlines from the Zoho
-- "Products Information" table of each lead
-- (basket = Product Basket, series = Product Series).
create table if not exists public.lead_lines (
  id text primary key,
  lead_id text,
  basket text,
  series text,
  model text,
  qty numeric,
  amount numeric,
  modified timestamptz,
  seen_at timestamptz default now());
create index if not exists lead_lines_lead
  on public.lead_lines (lead_id);
alter table public.lead_lines enable row level security;
revoke all on public.lead_lines from anon, authenticated;

create table if not exists public.lead_lines_state (
  id int primary key default 1,
  cursor_id text,
  sweep_start timestamptz,
  last_done timestamptz,
  last_run timestamptz,
  note text);
insert into public.lead_lines_state (id) values (1)
  on conflict do nothing;
alter table public.lead_lines_state enable row level security;
revoke all on public.lead_lines_state from anon, authenticated;


-- ============ PART 3 of 4 : prd_leads_l (leads of a family) ============
-- Leads created this FY naming the family. Value = the lead's own
-- product lines of this family (Zoho Products Information);
-- leads without lines: Order Value split equally between the
-- families named in Product / Solution type (est = true).
-- rows: [lead id, day, region, owner, name, company,
--        value L, est, [[series, qty, value L], ...]]
create or replace function public.prd_leads_l(
  p_cy int, p_fam text)
returns jsonb language sql stable security definer
set search_path = public as $$
with b as materialized (
  select * from ptt_leads_base()
  where created >= make_date(p_cy, 4, 1)),
ln as materialized (
  select l.lead_id,
    prd_fam(l.basket, b.rg = 'Govt Projects', true) as f,
    coalesce(nullif(trim(l.series), ''),
             nullif(trim(l.basket), ''), '(no series)') as sr,
    sum(coalesce(l.qty, 0)) q, sum(coalesce(l.amount, 0)) a
  from lead_lines l join b on b.id = l.lead_id
  group by 1, 2, 3),
pt as (
  select b.id, trim(t) t
  from b, unnest(string_to_array(
    regexp_replace(coalesce(b.ptype, ''), '^\[|\]$|"', '', 'g'),
    ',')) t
  where not exists (select 1 from ln where ln.lead_id = b.id)
    and trim(t) <> ''),
pf as (
  select pt.id, case when prd_pfam(pt.t) = 'Prepaid/Smart'
      and b.rg = 'Govt Projects'
      then 'Prepaid/Smart – Govt' else prd_pfam(pt.t) end f, pt.t
  from pt join b on b.id = pt.id),
pfn as (select id, f, string_agg(distinct t, ', ') ts
        from pf group by 1, 2),
pfc as (select id, count(*) n from pfn group by 1),
x as (
  select ln.lead_id id, ln.f, ln.sr, ln.q, ln.a, false est
  from ln
  union all
  select pfn.id, pfn.f, pfn.ts, null, b.value / pfc.n, true
  from pfn join pfc on pfc.id = pfn.id join b on b.id = pfn.id),
fam as (
  select id, sum(coalesce(a, 0)) a, bool_or(est) est,
    jsonb_agg(jsonb_build_array(sr, q, round(coalesce(a, 0) / 1e5, 2))
              order by a desc nulls last) sr
  from x where f = p_fam group by 1)
select jsonb_build_object(
  'asof', now(),
  'lines_synced', (select last_done from lead_lines_state
                   where id = 1),
  'rows', (select coalesce(jsonb_agg(jsonb_build_array(
      b.id, to_char(b.created at time zone 'Asia/Kolkata',
                    'YYYY-MM-DD'),
      b.rg, coalesce(b.owner, '(no owner)'), b.name, b.company,
      round(fam.a / 1e5, 2), fam.est, fam.sr)), '[]')
    from fam join b on b.id = fam.id));
$$;
grant execute on function public.prd_leads_l(int, text)
  to anon, authenticated;


-- ============ PART 4 of 4 : pot_lines_for (Potentials tab) ============
-- Product lines of the given potentials, for the Potentials tab
-- (value by basket + the breakdown pop-up).
-- rows: [deal id, basket, series, qty, amount Rs]
create or replace function public.pot_lines_for(p_ids text[])
returns jsonb language sql stable security definer
set search_path = public as $$
select jsonb_build_object(
  'lines_synced', (select last_done from pot_lines_state
                   where id = 1),
  'rows', (select coalesce(jsonb_agg(jsonb_build_array(
             deal_id, bk, sr, q, a)), '[]')
           from (select deal_id,
                   coalesce(nullif(trim(basket), ''), '(no basket)') bk,
                   coalesce(nullif(trim(series), ''), '(no series)') sr,
                   sum(coalesce(qty, 0)) q,
                   round(sum(coalesce(amount, 0)), 0) a
                 from pot_lines
                 where deal_id = any(p_ids)
                 group by 1, 2, 3) z));
$$;
grant execute on function public.pot_lines_for(text[])
  to anon, authenticated;

notify pgrst, 'reload schema';
