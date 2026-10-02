-- Run in Supabase SQL Editor (safe to re-run)

-- ---------------------------------------------------------------------
-- Basket grouping (2 Oct 2026): merged baskets used by the dashboard.
--   Panel Meters  = Panel Meters + High End MFM + Power Quality
--   Prepaid & Smart Meters = Prepaid + Smart Meters + Prepaid & Smart Meters
-- product_basket keeps the original Excel/Zoho value.
-- ---------------------------------------------------------------------
alter table public.sales_lines add column if not exists basket_group text generated always as
  (case when product_basket in ('Panel Meters','High End MFM','Power Quality') then 'Panel Meters'
        when product_basket in ('Prepaid','Smart Meters','Prepaid & Smart Meters') then 'Prepaid & Smart Meters'
        else product_basket end) stored;

-- ---------------------------------------------------------------------
-- 5. Dashboard functions (called from the browser with the anon key).
-- ---------------------------------------------------------------------

-- 5a. Filter options for the dropdowns
create or replace function public.cp_filter_options(p_doc text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'fys',           (select coalesce(jsonb_agg(f order by f desc), '[]') from (select distinct fy_start f from sales_lines where doc_type = p_doc) x),
    'max_date',      (select max(posting_date) from sales_lines where doc_type = p_doc),
    'account_types', (select coalesce(jsonb_agg(a order by a), '[]') from (select distinct coalesce(account_type,'(blank)') a from sales_lines where doc_type = p_doc) x),
    'baskets',       (select coalesce(jsonb_agg(b order by b), '[]') from (select distinct coalesce(basket_group,'(blank)') b from sales_lines where doc_type = p_doc) x),
    'series',        (select coalesce(jsonb_agg(jsonb_build_object('b', b, 's', s) order by b, s), '[]')
                        from (select distinct coalesce(basket_group,'(blank)') b, coalesce(product_series,'(blank)') s from sales_lines where doc_type = p_doc) x),
    'regions',       (select coalesce(jsonb_agg(r order by r), '[]') from (select distinct coalesce(region,'(blank)') r from sales_lines where doc_type = p_doc) x),
    'last_sync',     (select jsonb_build_object('at', finished_at, 'status', status, 'message', message)
                        from sales_sync_log where doc_type = p_doc order by id desc limit 1)
  );
$$;

-- 5b. Main dashboard payload
--   p_cy / p_base : the two financial years compared (fy_start, e.g. 2026 = FY 2026-27)
--   p_focus       : focus product basket(s); p_series narrows the focus to those series
--   p_months      : month numbers 1-12; empty = like-for-like (base year cut at the same day)
create or replace function public.cp_dashboard(
  p_doc text, p_cy int, p_base int,
  p_acct text[] default '{}', p_focus text[] default '{}', p_series text[] default '{}',
  p_region text[] default '{}', p_months int[] default '{}')
returns jsonb language plpgsql stable as $$
declare
  v_max  date;
  v_cut  date;
  v_res  jsonb;
begin
  select max(posting_date) into v_max from sales_lines where doc_type = p_doc and fy_start = p_cy;
  -- like-for-like cut for the base year: same day-of-FY as the latest date in the current year
  v_cut := case when v_max is null then null
                else (v_max - make_interval(years => p_cy - p_base))::date end;

  with base as (
    select acct_group,
           coalesce(account_type,'(blank)')   as acct,
           coalesce(basket_group,'(blank)') as basket,
           coalesce(region,'(blank)')         as region,
           coalesce(card_name,'(blank)')      as card,
           fy_start as fy, fy_month as m,
           coalesce(doc_total_fc,0) as v,
           case when gross_value > 0 then line_total end as lt,
           gross_value as g,
           (coalesce(basket_group,'(blank)') = any(p_focus)
             and (cardinality(p_series) = 0 or coalesce(product_series,'(blank)') = any(p_series))) as foc
    from sales_lines
    where doc_type = p_doc
      and fy_start in (p_cy, p_base)
      and (cardinality(p_acct)   = 0 or coalesce(account_type,'(blank)') = any(p_acct))
      and (cardinality(p_region) = 0 or coalesce(region,'(blank)')       = any(p_region))
      and (cardinality(p_months) = 0 or fy_month = any(p_months))
      and (cardinality(p_months) > 0 or fy_start = p_cy or posting_date <= v_cut)
  )
  select jsonb_build_object(
    'meta', jsonb_build_object('cy', p_cy, 'base', p_base, 'max_date', v_max,
                               'base_cut', case when cardinality(p_months) = 0 then v_cut end),
    'groups', (select coalesce(jsonb_agg(x), '[]') from (
                 select acct_group as grp, fy,
                        sum(v) as v, sum(v) filter (where foc) as fv,
                        sum(lt) as lt, sum(g) as g,
                        sum(lt) filter (where foc) as flt, sum(g) filter (where foc) as fg,
                        count(distinct card) as cust
                 from base group by acct_group, fy) x),
    'baskets', (select coalesce(jsonb_agg(x), '[]') from (
                 select acct_group as grp, fy, basket, sum(v) as v, sum(lt) as lt, sum(g) as g,
                        count(distinct card) as cust
                 from base group by acct_group, fy, basket) x),
    'monthly', (select coalesce(jsonb_agg(x), '[]') from (
                 select acct_group as grp, fy, m, sum(v) as v, sum(v) filter (where foc) as fv
                 from base group by acct_group, fy, m) x),
    'regions', (select coalesce(jsonb_agg(x), '[]') from (
                 select acct_group as grp, fy, region, sum(v) as v, sum(v) filter (where foc) as fv
                 from base group by acct_group, fy, region) x),
    'partners', (select coalesce(jsonb_agg(x), '[]') from (
                 select card,
                        max(region) as region,
                        max(acct)   as acct,
                        coalesce(sum(v) filter (where foc and fy = p_cy), 0)       as f_cy,
                        coalesce(sum(v) filter (where foc and fy = p_base), 0)     as f_base,
                        coalesce(sum(v) filter (where not foc and fy = p_cy), 0)   as r_cy,
                        coalesce(sum(v) filter (where not foc and fy = p_base), 0) as r_base,
                        sum(lt) filter (where foc and fy = p_cy) as f_lt, sum(g) filter (where foc and fy = p_cy) as f_g,
                        sum(lt) filter (where not foc and fy = p_cy) as r_lt, sum(g) filter (where not foc and fy = p_cy) as r_g
                 from base
                 where (cardinality(p_acct) > 0 or acct_group = 'Channel Partners')
                 group by card) x)
  ) into v_res;

  return v_res;
end;
$$;

-- 5c. One partner's basket-by-basket breakdown (drill-down panel)
create or replace function public.cp_partner_detail(
  p_doc text, p_cy int, p_base int, p_card text,
  p_region text[] default '{}', p_months int[] default '{}')
returns jsonb language plpgsql stable as $$
declare v_max date; v_cut date; v_res jsonb;
begin
  select max(posting_date) into v_max from sales_lines where doc_type = p_doc and fy_start = p_cy;
  v_cut := case when v_max is null then null else (v_max - make_interval(years => p_cy - p_base))::date end;
  select coalesce(jsonb_agg(x), '[]') into v_res from (
    select coalesce(basket_group,'(blank)') as basket, fy_start as fy,
           sum(coalesce(doc_total_fc,0)) as v,
           sum(case when gross_value > 0 then line_total end) as lt, sum(gross_value) as g,
           sum(quantity) as qty
    from sales_lines
    where doc_type = p_doc and fy_start in (p_cy, p_base) and coalesce(card_name,'(blank)') = p_card
      and (cardinality(p_region) = 0 or coalesce(region,'(blank)') = any(p_region))
      and (cardinality(p_months) = 0 or fy_month = any(p_months))
      and (cardinality(p_months) > 0 or fy_start = p_cy or posting_date <= v_cut)
    group by 1, 2) x;
  return v_res;
end;
$$;

grant execute on function public.cp_filter_options(text) to anon, authenticated;
grant execute on function public.cp_dashboard(text,int,int,text[],text[],text[],text[],int[]) to anon, authenticated;
grant execute on function public.cp_partner_detail(text,int,int,text,text[],int[]) to anon, authenticated;
grant select on public.ob_data, public.invoice_data to anon, authenticated;
-- Region drill-down: every channel partner in one U-Region, split by FY and month,
-- focus basket vs the rest. Used by the pop-up on the Region view.
create or replace function public.cp_region_partners(
  p_doc text, p_cy int, p_base int, p_region text,
  p_acct text[] default '{}', p_focus text[] default '{}', p_series text[] default '{}',
  p_months int[] default '{}')
returns jsonb language plpgsql stable as $$
declare v_max date; v_cut date; v_res jsonb;
begin
  select max(posting_date) into v_max from sales_lines where doc_type = p_doc and fy_start = p_cy;
  v_cut := case when v_max is null then null else (v_max - make_interval(years => p_cy - p_base))::date end;
  select coalesce(jsonb_agg(x), '[]') into v_res from (
    select coalesce(card_name,'(blank)') as card, fy_start as fy, fy_month as m,
           sum(coalesce(doc_total_fc,0)) filter (where foc)     as fv,
           sum(coalesce(doc_total_fc,0)) filter (where not foc) as rv,
           sum(case when gross_value > 0 then line_total end) filter (where foc) as flt,
           sum(gross_value) filter (where foc) as fg
    from (
      select *, (coalesce(basket_group,'(blank)') = any(p_focus)
                 and (cardinality(p_series) = 0 or coalesce(product_series,'(blank)') = any(p_series))) as foc
      from sales_lines
      where doc_type = p_doc and fy_start in (p_cy, p_base)
        and coalesce(region,'(blank)') = p_region
        and acct_group = 'Channel Partners'
        and (cardinality(p_acct)   = 0 or coalesce(account_type,'(blank)') = any(p_acct))
        and (cardinality(p_months) = 0 or fy_month = any(p_months))
        and (cardinality(p_months) > 0 or fy_start = p_cy or posting_date <= v_cut)
    ) s
    group by 1, 2, 3) x;
  return v_res;
end;
$$;
grant execute on function public.cp_region_partners(text,int,int,text,text[],text[],text[],int[]) to anon, authenticated;

-- Product-series breakup of the focus basket for one partner: qty + value by FY and month
create or replace function public.cp_partner_series(
  p_doc text, p_cy int, p_base int, p_card text,
  p_region text[] default '{}', p_focus text[] default '{}', p_series text[] default '{}',
  p_months int[] default '{}')
returns jsonb language plpgsql stable as $$
declare v_max date; v_cut date; v_res jsonb;
begin
  select max(posting_date) into v_max from sales_lines where doc_type = p_doc and fy_start = p_cy;
  v_cut := case when v_max is null then null else (v_max - make_interval(years => p_cy - p_base))::date end;
  select coalesce(jsonb_agg(x), '[]') into v_res from (
    select coalesce(product_series,'(blank)') as series, fy_start as fy, fy_month as m,
           sum(coalesce(quantity,0)) as qty, sum(coalesce(doc_total_fc,0)) as v
    from sales_lines
    where doc_type = p_doc and fy_start in (p_cy, p_base) and coalesce(card_name,'(blank)') = p_card
      and coalesce(basket_group,'(blank)') = any(p_focus)
      and (cardinality(p_series) = 0 or coalesce(product_series,'(blank)') = any(p_series))
      and (cardinality(p_region) = 0 or coalesce(region,'(blank)') = any(p_region))
      and (cardinality(p_months) = 0 or fy_month = any(p_months))
      and (cardinality(p_months) > 0 or fy_start = p_cy or posting_date <= v_cut)
    group by 1, 2, 3) x;
  return v_res;
end;
$$;
grant execute on function public.cp_partner_series(text,int,int,text,text[],text[],text[],int[]) to anon, authenticated;
