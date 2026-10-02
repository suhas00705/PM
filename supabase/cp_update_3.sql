-- Update 3: region discounts + region x basket data for scheme suggestions
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
                 select acct_group as grp, fy, region, sum(v) as v, sum(v) filter (where foc) as fv,
                        sum(lt) as lt, sum(g) as g,
                        sum(lt) filter (where foc) as flt, sum(g) filter (where foc) as fg
                 from base group by acct_group, fy, region) x),
    'region_baskets', (select coalesce(jsonb_agg(x), '[]') from (
                 select fy, region, basket, sum(v) as v, sum(lt) as lt, sum(g) as g
                 from base where acct_group = 'Channel Partners'
                 group by fy, region, basket) x),
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
grant execute on function public.cp_dashboard(text,int,int,text[],text[],text[],text[],int[]) to anon, authenticated;
