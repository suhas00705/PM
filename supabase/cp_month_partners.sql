-- 12-Oct-2026: (1) Partners Performance month chart gets quantity (cp_performance monthly.q)
--              (2) new cp_month_partners() for the month pop-ups. Safe to re-run.

create or replace function public.cp_performance(
  p_doc text, p_cy int, p_base int,
  p_acct text[] default '{}', p_basket text[] default '{}', p_series text[] default '{}',
  p_region text[] default '{}', p_months int[] default '{}')
returns jsonb language plpgsql stable as $$
declare
  v_max date;
  v_cut date;
  v_res jsonb;
begin
  select max(posting_date) into v_max from sales_lines where doc_type = p_doc and fy_start = p_cy;
  v_cut := case when v_max is null then null
                else (v_max - make_interval(years => p_cy - p_base))::date end;

  with rdisp as (   -- one display spelling per region key: the most used one
    select distinct on (k) k, region from (
      select public.cp_rkey(region) as k, coalesce(trim(region),'(blank)') as region, count(*) as c
      from sales_lines where doc_type = p_doc group by 1, 2) z
    order by k, c desc),
  base as (
    select coalesce(account_type,'(blank)')  as acct,
           coalesce(basket_group,'(blank)')  as basket,
           coalesce(rd.region,'(blank)')     as region,
           coalesce(card_name,'(blank)')     as card,
           fy_start as fy, fy_month as m,
           coalesce(doc_total_fc,0) as v,
           coalesce(quantity,0) as q,
           -- discount maths leaves out baskets whose list prices are placeholders (same rule as the CP view)
           case when gross_value > 0 and coalesce(basket_group,'(blank)') not in ('Software','Others','OEM','Service Item','(blank)')
                then line_total end as lt,
           case when coalesce(basket_group,'(blank)') not in ('Software','Others','OEM','Service Item','(blank)')
                then gross_value end as g
    from sales_lines s
    left join rdisp rd on rd.k = public.cp_rkey(s.region)
    where doc_type = p_doc
      and fy_start in (p_cy, p_base)
      and (cardinality(p_acct)   = 0 or coalesce(account_type,'(blank)')   = any(p_acct))
      and (cardinality(p_basket) = 0 or coalesce(basket_group,'(blank)')   = any(p_basket))
      and (cardinality(p_series) = 0 or coalesce(product_series,'(blank)') = any(p_series))
      and (cardinality(p_region) = 0 or public.cp_rkey(s.region) = any(array(select public.cp_rkey(x) from unnest(p_region) x)))
      and (cardinality(p_months) = 0 or fy_month = any(p_months))
      and (cardinality(p_months) > 0 or fy_start = p_cy or posting_date <= v_cut)
  )
  select jsonb_build_object(
    'meta', jsonb_build_object('cy', p_cy, 'base', p_base, 'max_date', v_max,
                               'base_cut', case when cardinality(p_months) = 0 then v_cut end),
    'totals', (select coalesce(jsonb_agg(x), '[]') from (
                 select fy, sum(v) as v, sum(lt) as lt, sum(g) as g, count(distinct card) as cust
                 from base group by fy) x),
    'monthly', (select coalesce(jsonb_agg(x), '[]') from (
                 select fy, m, sum(v) as v, sum(q) as q, count(distinct card) as cust
                 from base group by fy, m) x),
    'accts', (select coalesce(jsonb_agg(x), '[]') from (
                 select acct, fy, sum(v) as v, sum(lt) as lt, sum(g) as g, count(distinct card) as cust
                 from base group by acct, fy) x),
    'baskets', (select coalesce(jsonb_agg(x), '[]') from (
                 select basket, fy, sum(v) as v, sum(lt) as lt, sum(g) as g, count(distinct card) as cust
                 from base group by basket, fy) x),
    'regions', (select coalesce(jsonb_agg(x), '[]') from (
                 select region, fy, sum(v) as v, sum(lt) as lt, sum(g) as g, count(distinct card) as cust
                 from base group by region, fy) x),
    'partners', (select coalesce(jsonb_agg(x), '[]') from (
                 select card,
                        max(acct)   as acct,
                        (array_agg(region order by v desc))[1] as region,
                        round(coalesce(sum(v) filter (where fy = p_cy), 0), 2)   as v_cy,
                        round(coalesce(sum(v) filter (where fy = p_base), 0), 2) as v_base,
                        round(sum(lt) filter (where fy = p_cy), 2) as lt,
                        round(sum(g)  filter (where fy = p_cy), 2) as g,
                        count(distinct basket) filter (where fy = p_cy and v > 0) as nb
                 from base
                 group by card
                 having abs(coalesce(sum(v),0)) > 0) x)
  ) into v_res;

  return v_res;
end;
$$;

-- Month pop-up: which partners bought in a month and which did not, region-wise.
-- Universe = accounts of the chosen account types (default: Channel Partners) and regions that bought ANYTHING
-- (any basket) in this FY or last FY. "Contributed" = bought the chosen basket(s)/series in the clicked month.
create or replace function public.cp_month_partners(
  p_doc text, p_cy int, p_base int, p_month int,
  p_acct text[] default '{}', p_basket text[] default '{}', p_series text[] default '{}',
  p_region text[] default '{}')
returns jsonb language sql stable as $$
  with rdisp as (
    select distinct on (k) k, region from (
      select public.cp_rkey(region) as k, coalesce(trim(region),'(blank)') as region, count(*) as c
      from sales_lines where doc_type = p_doc group by 1, 2) z
    order by k, c desc),
  b as (
    select coalesce(s.card_name,'(blank)') as card,
           coalesce(s.account_type,'(blank)') as acct,
           coalesce(rd.region,'(blank)') as region,
           s.fy_start as fy, s.fy_month as m,
           coalesce(s.doc_total_fc,0) as v, coalesce(s.quantity,0) as q,
           ((cardinality(p_basket) = 0 or coalesce(s.basket_group,'(blank)') = any(p_basket))
             and (cardinality(p_series) = 0 or coalesce(s.product_series,'(blank)') = any(p_series))) as sel
    from sales_lines s
    left join rdisp rd on rd.k = public.cp_rkey(s.region)
    where s.doc_type = p_doc and s.fy_start in (p_cy, p_base)
      and (case when cardinality(p_acct) = 0 then s.acct_group = 'Channel Partners'
                else coalesce(s.account_type,'(blank)') = any(p_acct) end)
      and (cardinality(p_region) = 0 or public.cp_rkey(s.region) = any(array(select public.cp_rkey(x) from unnest(p_region) x)))
  ),
  p as (
    select card, max(acct) as acct,
           (array_agg(region order by v desc))[1] as region,
           round(coalesce(sum(v) filter (where sel and fy = p_cy and m = p_month), 0), 2)  as m_v,
           round(coalesce(sum(q) filter (where sel and fy = p_cy and m = p_month), 0), 2)  as m_q,
           round(coalesce(sum(v) filter (where fy = p_cy and m = p_month), 0), 2)          as m_all,
           round(coalesce(sum(v) filter (where sel and fy = p_base and m = p_month), 0), 2) as ly_v,
           round(coalesce(sum(v) filter (where sel and fy = p_cy), 0), 2)                  as ytd_v,
           round(coalesce(sum(v) filter (where sel and fy = p_base), 0), 2)                as ly_ytd_v,
           max(case when sel and fy = p_cy and v > 0 then (m + 8) % 12 end)                as last_i
    from b group by card
    having abs(coalesce(sum(v),0)) > 0)
  select jsonb_build_object('rows', coalesce(jsonb_agg(p), '[]'),
                            'max_date', (select max(posting_date) from sales_lines where doc_type = p_doc and fy_start = p_cy))
  from p;
$$;
grant execute on function public.cp_month_partners(text,int,int,int,text[],text[],text[],text[]) to anon, authenticated;

notify pgrst, 'reload schema';
