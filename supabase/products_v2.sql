-- Products tab, round 2 (24-Nov-2026). Two new read-only functions.
-- No table or existing function is changed. Safe to re-run.
-- Run PART 1 and PART 2 one by one.

-- ============ PART 1 of 2 : prd_drill ============
-- Pop-up of the Product series table: Region > Sales engineer with
-- qty and value, plus the OA / invoice list. Same family / region /
-- series rules as prd_cube.
-- p_rgs / p_series empty = all.
create or replace function public.prd_drill(
  p_cy int, p_doc text, p_fam text, p_months int[],
  p_rgs text[] default '{}', p_series text[] default '{}')
returns jsonb language sql stable as $$
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
  select s.doc_num::text as doc, s.posting_date as dt,
    coalesce(s.card_name, '(blank)') as card,
    coalesce(nullif(trim(s.slp_name), ''), '(no SE)') as se,
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
    coalesce(s.doc_total_fc, 0) / 1e5 as v,
    coalesce(s.quantity, 0) as q
  from sales_lines s cross join ov
  left join cust_region c
    on s.doc_type <> 'OB' and c.card_name = s.card_name
  where s.fy_start = p_cy and s.doc_type = p_doc
    and s.fy_month = any(p_months)),
t as (
  select doc, dt, card, se, v, q,
    prd_rg(ur, slp_name, eb = 'OEM') as rg,
    case when prd_fam(eb, gov) = 'Other'
         then regexp_replace(eb, '\s+', ' ', 'g') || ' · ' || sr
         else sr end as sr
  from src
  where eb is not null and prd_fam(eb, gov) = p_fam),
f as materialized (
  select * from t
  where (cardinality(p_rgs) = 0 or rg = any(p_rgs))
    and (cardinality(p_series) = 0 or sr = any(p_series))),
d as (
  select doc, min(dt) dt, min(card) card,
         mode() within group (order by rg) rg,
         mode() within group (order by se) se,
         (array_agg(sr order by v desc))[1] top_sr,
         count(distinct sr) ns, sum(q) q, sum(v) v
  from f group by doc)
select jsonb_build_object(
  'tot', (select jsonb_build_object(
      'v', round(coalesce(sum(v), 0), 2),
      'q', round(coalesce(sum(q), 0), 0),
      'docs', count(distinct doc),
      'cust', count(distinct card),
      'regions', count(distinct rg),
      'se', count(distinct se)) from f),
  'reg', (select coalesce(jsonb_agg(jsonb_build_array(
            rg, round(q, 0), round(v, 2), n) order by v desc), '[]')
          from (select rg, sum(q) q, sum(v) v,
                  count(distinct doc) n
                from f group by rg) x),
  'se', (select coalesce(jsonb_agg(jsonb_build_array(
           rg, se, round(q, 0), round(v, 2), n) order by v desc), '[]')
         from (select rg, se, sum(q) q, sum(v) v,
                 count(distinct doc) n
               from f group by rg, se) x),
  'docs_n', (select count(*) from d),
  'docs', (select coalesce(jsonb_agg(jsonb_build_array(
             doc, dt, card, rg, se, top_sr, ns,
             round(q, 0), round(v, 2)) order by v desc), '[]')
           from (select * from d order by v desc limit 400) x));
$$;
grant execute on function
  public.prd_drill(int, text, text, int[], text[], text[])
  to anon, authenticated;


-- ============ PART 2 of 2 : prd_leads_d ============
-- Leads created this FY and last FY, by day, with owner (sales
-- engineer), for the Leads block: Week 1-5 of a month and the
-- Region > Sales engineer pop-up.
-- rows: [day, Product/Solution type text, region, owner,
--        leads, order value L]
create or replace function public.prd_leads_d(p_cy int)
returns jsonb language sql stable security definer
set search_path = public as $$
select jsonb_build_object(
  'asof', now(),
  'rows', (select coalesce(jsonb_agg(jsonb_build_array(
             dy, pt, rg, ow, n, v)), '[]')
           from (select to_char(created at time zone 'Asia/Kolkata',
                    'YYYY-MM-DD') dy,
                  coalesce(ptype, '') pt, rg,
                  coalesce(owner, '(no owner)') ow, count(*) n,
                  round(coalesce(sum(value), 0) / 1e5, 2) v
                 from ptt_leads_base()
                 where created >= make_date(p_cy - 1, 4, 1)
                 group by 1, 2, 3, 4) z));
$$;
grant execute on function public.prd_leads_d(int)
  to anon, authenticated;

notify pgrst, 'reload schema';
