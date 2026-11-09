-- PM Cumulative Tracking: click Order booked / Billed → breakdown pop-up
-- (09-Nov-2026). Read-only. Safe to re-run.
-- Same rules as pm_tracking: OEM override / EXCL accounts, Govt rule,
-- invoices take the customer's main OB region (as pm_growth).
-- MTS and MCS series are shown as one series "MTS/MCS".
-- p_items = [{"b":["Panel Meters","Nano VIP"],"xg":false}, ...]
--   b  = product baskets of the clicked row, xg = leave out Govt lines

-- PART 1 : common base (one row per sales line, already filtered)
create or replace function public.pm_drill_base(
  p_fy int, p_doc text, p_months int[], p_items jsonb)
returns table(doc_num text, dt date, card text, rg text,
              sr text, cat text, model text, q numeric, v numeric)
language sql stable as $$
with ov as materialized (
  select
    array(select ov_key from pm_card_override
          where ov_mode = 'OEM') as oem,
    array(select ov_key from pm_card_override
          where ov_mode = 'OEM_B') as oemb,
    array(select ov_key from pm_card_override
          where ov_mode = 'EXCL') as excl),
ob_cust as materialized (
  select card_name, region,
         sum(abs(coalesce(doc_total_fc, 0))) as tv
  from sales_lines
  where doc_type = 'OB' and region is not null
    and card_name is not null
  group by 1, 2),
cust_region as materialized (
  select distinct on (card_name) card_name, region
  from ob_cust order by card_name, tv desc),
s as materialized (
  select x.*,
    case
      when x.card_name = any(ov.oem) then 'OEM'
      when x.card_name || '|' || coalesce(x.product_basket, '')
           = any(ov.oemb) then 'OEM'
      when coalesce(x.product_basket, '') = 'OEM'
           and x.card_name = any(ov.excl) then null
      else coalesce(x.product_basket, '(blank)')
    end as eb,
    (coalesce(x.account_type, '') = 'Govt Projects'
     or upper(trim(coalesce(x.region, ''))) = 'GOVT PROJECTS'
     or upper(trim(coalesce(x.se_reg, ''))) = 'GOVT PROJECTS')
      as gov
  from sales_lines x cross join ov
  where x.fy_start = p_fy and x.doc_type = p_doc
    and x.fy_month = any(p_months))
select s.doc_num::text,
       s.posting_date,
       coalesce(s.card_name, '(blank)'),
       coalesce(nullif(trim(case when s.doc_type = 'OB'
         then s.region else coalesce(c.region, s.region) end),
         ''), '(blank)'),
       case when upper(trim(coalesce(s.product_series, '')))
                 in ('MTS', 'MCS') then 'MTS/MCS'
            else coalesce(nullif(trim(s.product_series), ''),
                          '(no series)') end,
       coalesce(s.cat_code, '(no cat code)'),
       coalesce(nullif(trim(s.model_id), ''),
                nullif(trim(s.description), ''), s.cat_code),
       coalesce(s.quantity, 0),
       coalesce(s.doc_total_fc, 0) / 1e5
from s
left join cust_region c
  on s.doc_type <> 'OB' and c.card_name = s.card_name
where s.eb is not null
  and exists (
    select 1 from jsonb_array_elements(p_items) e
    where s.eb in (select jsonb_array_elements_text(e -> 'b'))
      and not (coalesce((e ->> 'xg')::boolean, false)
               and s.gov));
$$;

-- PART 2 : the pop-up (totals, by region, by series, OA list)
create or replace function public.pm_drill(
  p_fy int, p_doc text, p_months int[], p_items jsonb,
  p_rg text default null, p_sr text default null)
returns jsonb language sql stable as $$
with b as materialized (
  select * from pm_drill_base(p_fy, p_doc, p_months, p_items)),
f as materialized (
  select * from b
  where (p_rg is null or rg = p_rg)
    and (p_sr is null or sr = p_sr)),
d as (
  select doc_num, min(dt) dt, min(card) card,
         mode() within group (order by rg) rg,
         count(distinct sr) ns,
         (array_agg(sr order by v desc))[1] top_sr,
         sum(q) q, sum(v) v
  from f group by doc_num)
select jsonb_build_object(
  'tot', (select jsonb_build_object(
      'v', round(coalesce(sum(v), 0), 2),
      'q', round(coalesce(sum(q), 0), 0),
      'docs', count(distinct doc_num),
      'cust', count(distinct card),
      'regions', count(distinct rg),
      'series', count(distinct sr)) from b),
  'reg', (select coalesce(jsonb_agg(jsonb_build_array(
            rg, n, round(q, 0), round(v, 2)) order by v desc), '[]')
          from (select rg, count(distinct doc_num) n,
                       sum(q) q, sum(v) v from b group by rg) x),
  'ser', (select coalesce(jsonb_agg(jsonb_build_array(
            sr, round(q, 0), round(v, 2)) order by v desc), '[]')
          from (select sr, sum(q) q, sum(v) v
                from b group by sr) x),
  'docs_n', (select count(*) from d),
  'docs_v', (select round(coalesce(sum(v), 0), 2) from d),
  'docs', (select coalesce(jsonb_agg(jsonb_build_array(
            doc_num, dt, card, rg, top_sr, ns,
            round(q, 0), round(v, 2)) order by v desc), '[]')
           from (select * from d order by v desc limit 400) x));
$$;

-- PART 3 : items of one OA / invoice (when it is expanded)
create or replace function public.pm_drill_doc(
  p_fy int, p_doc text, p_months int[], p_items jsonb,
  p_doc_num text)
returns jsonb language sql stable as $$
select coalesce(jsonb_agg(jsonb_build_array(
         cat, model, sr, round(q, 0), round(v, 2))
         order by v desc), '[]')
from (select cat, min(model) model, min(sr) sr,
             sum(q) q, sum(v) v
      from pm_drill_base(p_fy, p_doc, p_months, p_items)
      where doc_num = p_doc_num
      group by cat) x;
$$;

grant execute on function
  public.pm_drill_base(int, text, int[], jsonb)
  to anon, authenticated;
grant execute on function
  public.pm_drill(int, text, int[], jsonb, text, text)
  to anon, authenticated;
grant execute on function
  public.pm_drill_doc(int, text, int[], jsonb, text)
  to anon, authenticated;
notify pgrst, 'reload schema';
-- check: select public.pm_drill(2026, 'OB', array[11],
--   '[{"b":["Panel Meters","High End MFM","Nano VIP",
--   "Power Quality"],"xg":false}]');
