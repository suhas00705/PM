-- Products tab, round 3 (24-Nov-2026): prd_cube also returns
-- last year's quantity cut at the same day (like-for-like), for the
-- new Qty / Value toggle. Replaces prd_cube only (same inputs, one
-- extra number at the end of each row). Safe to re-run.

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

notify pgrst, 'reload schema';
