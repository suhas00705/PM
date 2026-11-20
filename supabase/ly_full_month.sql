-- 20-Nov-2026 (user): month charts keep last year's CURRENT month cut at the same
-- day (like-for-like growth %), and also show the FULL last-year month as a dashed
-- outline labelled "full Nov LY". These 3 small read-only functions give that full
-- last-year month. No table or existing function is changed. Safe to re-run.
-- Run PART 1, PART 2, PART 3 one by one.

-- ============ PART 1 of 3 : PM Cumulative Tracking (growth by month) ============
-- Last FY, the month of this FY's latest data, NOT cut at the day.
-- Same basket / OEM-account / region rules as pm_growth.
-- rows: [doc, region (U_region), basket, govt?, value Rs]
create or replace function public.pm_growth_lyfull(p_cy int)
returns jsonb language plpgsql stable as $$
declare v_max date; v_m int; v_res jsonb;
begin
  select max(posting_date) into v_max
    from sales_lines where fy_start = p_cy;
  if v_max is null then return jsonb_build_object('m', null, 'rows', '[]'::jsonb); end if;
  v_m := extract(month from v_max)::int;
  with ov as materialized (
    select array(select ov_key from pm_card_override
                 where ov_mode = 'OEM') as oem,
           array(select ov_key from pm_card_override
                 where ov_mode = 'OEM_B') as oemb,
           array(select ov_key from pm_card_override
                 where ov_mode = 'EXCL') as excl),
  ob_cust as (
    select card_name, region,
           sum(abs(coalesce(doc_total_fc, 0))) as v
    from sales_lines
    where doc_type = 'OB' and region is not null
      and card_name is not null
    group by 1, 2),
  cust_region as (
    select distinct on (card_name) card_name, region
    from ob_cust order by card_name, v desc),
  spelling as (
    select distinct on (upper(trim(region)))
           upper(trim(region)) as k, region
    from sales_lines
    where doc_type = 'OB' and region is not null
    group by region
    order by upper(trim(region)), count(*) desc),
  src as (
    select s.doc_type,
      case
        when s.card_name = any(ov.oem) then 'OEM'
        when s.card_name || '|' || coalesce(s.product_basket, '')
             = any(ov.oemb) then 'OEM'
        when coalesce(s.product_basket, '') = 'OEM'
             and s.card_name = any(ov.excl) then null
        else coalesce(s.product_basket, '(blank)')
      end as b,
      (coalesce(s.account_type, '') = 'Govt Projects'
       or upper(trim(coalesce(s.region, '')))
          = 'GOVT PROJECTS'
       or upper(trim(coalesce(s.se_reg, '')))
          = 'GOVT PROJECTS') as gov,
      case when s.doc_type = 'OB' then s.region
           else coalesce(c.region, sp.region, s.region)
      end as r,
      s.doc_total_fc
    from sales_lines s cross join ov
    left join cust_region c
      on s.doc_type <> 'OB' and c.card_name = s.card_name
    left join spelling sp
      on s.doc_type <> 'OB' and sp.k = upper(trim(s.region))
    where s.fy_start = p_cy - 1 and s.fy_month = v_m)
  select jsonb_build_object('m', v_m,
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(
               doc_type, r, b, gov, v)), '[]')
             from (select doc_type, coalesce(r, '(blank)') r, b, gov,
                     round(sum(coalesce(doc_total_fc, 0)), 2) v
                   from src where b is not null
                   group by 1, 2, 3, 4) z))
  into v_res;
  return v_res;
end;
$$;
grant execute on function public.pm_growth_lyfull(int)
  to anon, authenticated;


-- ============ PART 2 of 3 : OEM Tracking (growth by month) ============
-- rows: [doc, product series, value Rs, qty]
create or replace function public.pm_oem_lyfull(p_cy int)
returns jsonb language plpgsql stable as $$
declare v_max date; v_m int; v_res jsonb;
begin
  select max(posting_date) into v_max
    from sales_lines where fy_start = p_cy;
  if v_max is null then return jsonb_build_object('m', null, 'rows', '[]'::jsonb); end if;
  v_m := extract(month from v_max)::int;
  with ov as materialized (
    select array(select ov_key from pm_card_override
                 where ov_mode = 'OEM') as oem,
           array(select ov_key from pm_card_override
                 where ov_mode = 'OEM_B') as oemb,
           array(select ov_key from pm_card_override
                 where ov_mode = 'EXCL') as excl),
  src as (
    select s.doc_type, coalesce(s.product_series, '(blank)') sr,
      s.doc_total_fc, s.quantity,
      case
        when s.card_name = any(ov.oem) then 'OEM'
        when s.card_name || '|' || coalesce(s.product_basket, '')
             = any(ov.oemb) then 'OEM'
        when coalesce(s.product_basket, '') = 'OEM'
             and s.card_name = any(ov.excl) then null
        else coalesce(s.product_basket, '(blank)')
      end as b
    from sales_lines s cross join ov
    where s.fy_start = p_cy - 1 and s.fy_month = v_m)
  select jsonb_build_object('m', v_m,
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(
               doc_type, sr, v, q)), '[]')
             from (select doc_type, sr,
                     round(sum(coalesce(doc_total_fc, 0)), 2) v,
                     round(sum(coalesce(quantity, 0)), 2) q
                   from src where b = 'OEM'
                   group by 1, 2) z))
  into v_res;
  return v_res;
end;
$$;
grant execute on function public.pm_oem_lyfull(int)
  to anon, authenticated;


-- ============ PART 3 of 3 : Channel Partner Analytics (performance by month) ============
-- Same filters as cp_performance. Only when no month filter is set
-- (that is when cp_performance cuts last year at the same day).
create or replace function public.cp_perf_lyfull(
  p_doc text, p_cy int, p_base int,
  p_acct text[] default '{}', p_basket text[] default '{}',
  p_series text[] default '{}', p_region text[] default '{}',
  p_months int[] default '{}')
returns jsonb language plpgsql stable as $$
declare v_max date; v_cut date; v_m int; v_res jsonb;
begin
  if cardinality(p_months) > 0 then
    return jsonb_build_object('m', null);
  end if;
  select max(posting_date) into v_max from sales_lines
   where doc_type = p_doc and fy_start = p_cy;
  if v_max is null then return jsonb_build_object('m', null); end if;
  v_cut := (v_max - make_interval(years => p_cy - p_base))::date;
  v_m := extract(month from v_cut)::int;
  select jsonb_build_object('m', v_m,
    'v', coalesce(sum(coalesce(doc_total_fc, 0)), 0),
    'q', coalesce(sum(quantity), 0),
    'v_cut', coalesce(sum(coalesce(doc_total_fc, 0))
             filter (where posting_date <= v_cut), 0))
  into v_res
  from sales_lines s
  where doc_type = p_doc and fy_start = p_base
    and fy_month = v_m
    and (cardinality(p_acct) = 0
         or coalesce(account_type, '(blank)') = any(p_acct))
    and (cardinality(p_basket) = 0
         or coalesce(basket_group, '(blank)') = any(p_basket))
    and (cardinality(p_series) = 0
         or coalesce(product_series, '(blank)') = any(p_series))
    and (cardinality(p_region) = 0
         or public.cp_rkey(s.region) = any(array(
              select public.cp_rkey(x) from unnest(p_region) x)));
  return v_res;
end;
$$;
grant execute on function public.cp_perf_lyfull(
  text, int, int, text[], text[], text[], text[], int[])
  to anon, authenticated;

notify pgrst, 'reload schema';
