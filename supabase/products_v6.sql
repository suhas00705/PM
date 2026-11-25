-- Products tab, round 6 (25-Nov-2026). Safe to re-run.
-- MTS and MCS are one series "MTS/MCS" (same as PM Cumulative) and
-- always count under ATES, whatever basket the line has
-- (OEM customers stay in OEM).
-- Run PART 1, then PART 2.

-- ============ PART 1 of 2 : prd_cube ============
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
      case when upper(trim(coalesce(s.product_series, '')))
                in ('MTS', 'MCS') then 'MTS/MCS'
           else coalesce(nullif(trim(s.product_series), ''),
                         '(no series)') end as sr,
      coalesce(s.doc_total_fc, 0) as v,
      coalesce(s.quantity, 0) as q
    from sales_lines s cross join ov
    left join cust_region c
      on s.doc_type <> 'OB' and c.card_name = s.card_name
    where s.fy_start in (p_cy, p_cy - 1)),
  t as (
    select d, y, m, pd,
      case when sr = 'MTS/MCS' and eb <> 'OEM' then 'ATES'
           else prd_fam(eb, gov) end as f,
      prd_rg(ur, slp_name, eb = 'OEM') as r,
      case when prd_fam(eb, gov) = 'Other' and sr <> 'MTS/MCS'
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
        / 1e5, 3) as lv,
      round(coalesce(sum(q) filter (where y = 0
        or v_max is null
        or pd <= (v_max - interval '1 year')::date), 0), 0) as lq
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
       g.v, g.q, g.lv, g.lq)), '[]') from g))
  into v_res from df, dr, ds;
  return v_res;
end;
$$;
grant execute on function public.prd_cube(int)
  to anon, authenticated;

-- ============ PART 2 of 2 : prd_drill ============
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
    case when upper(trim(coalesce(s.product_series, '')))
              in ('MTS', 'MCS') then 'MTS/MCS'
         else coalesce(nullif(trim(s.product_series), ''),
                       '(no series)') end as sr,
    coalesce(s.doc_total_fc, 0) / 1e5 as v,
    coalesce(s.quantity, 0) as q
  from sales_lines s cross join ov
  left join cust_region c
    on s.doc_type <> 'OB' and c.card_name = s.card_name
  where s.fy_start = p_cy and s.doc_type = p_doc
    and s.fy_month = any(p_months)),
t0 as (
  select src.*, case when sr = 'MTS/MCS' and eb <> 'OEM'
                  then 'ATES' else prd_fam(eb, gov) end as fm
  from src where eb is not null),
t as (
  select doc, dt, card, se, v, q,
    prd_rg(ur, slp_name, eb = 'OEM') as rg,
    case when fm = 'Other'
         then regexp_replace(eb, '\s+', ' ', 'g') || ' · ' || sr
         else sr end as sr
  from t0
  where fm = p_fam),
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

notify pgrst, 'reload schema';
