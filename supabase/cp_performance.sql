-- Partners Performance (Channel Partner Analytics → "Partners Performance" view)
-- Overall growth of every account, this FY vs last FY, for the chosen account types / regions / months.
-- Product basket and series are plain filters here (empty = all baskets); there is no focus-vs-rest split.
-- Same rules as cp_dashboard: value = DocTotalFC, like-for-like cut of the base year when no months are chosen.
-- Safe to re-run.

-- Region key: same region written with different case / spacing counts as one (e.g. "Delhi NCR" = "DELHI NCR").
create or replace function public.cp_rkey(t text) returns text
language sql immutable as $$ select upper(regexp_replace(trim(coalesce(t,'(blank)')), '\s+', ' ', 'g')) $$;
grant execute on function public.cp_rkey(text) to anon, authenticated;

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
                 select fy, m, sum(v) as v, count(distinct card) as cust
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

-- One account's month-by-month value, both years, with the same filters (drill-down panel)
create or replace function public.cp_partner_monthly(
  p_doc text, p_cy int, p_base int, p_card text,
  p_basket text[] default '{}', p_series text[] default '{}',
  p_region text[] default '{}', p_months int[] default '{}')
returns jsonb language plpgsql stable as $$
declare v_max date; v_cut date; v_res jsonb;
begin
  select max(posting_date) into v_max from sales_lines where doc_type = p_doc and fy_start = p_cy;
  v_cut := case when v_max is null then null else (v_max - make_interval(years => p_cy - p_base))::date end;
  select coalesce(jsonb_agg(x), '[]') into v_res from (
    select fy_start as fy, fy_month as m, sum(coalesce(doc_total_fc,0)) as v, sum(quantity) as qty
    from sales_lines
    where doc_type = p_doc and fy_start in (p_cy, p_base) and coalesce(card_name,'(blank)') = p_card
      and (cardinality(p_basket) = 0 or coalesce(basket_group,'(blank)')   = any(p_basket))
      and (cardinality(p_series) = 0 or coalesce(product_series,'(blank)') = any(p_series))
      and (cardinality(p_region) = 0 or public.cp_rkey(region) = any(array(select public.cp_rkey(x) from unnest(p_region) x)))
      and (cardinality(p_months) = 0 or fy_month = any(p_months))
      and (cardinality(p_months) > 0 or fy_start = p_cy or posting_date <= v_cut)
    group by 1, 2) x;
  return v_res;
end;
$$;

-- Region pop-up: every account in one region (any spelling of it), by month, plus each account's basket split.
create or replace function public.cp_perf_region(
  p_doc text, p_cy int, p_base int, p_region text,
  p_acct text[] default '{}', p_basket text[] default '{}', p_series text[] default '{}',
  p_months int[] default '{}')
returns jsonb language plpgsql stable as $$
declare v_max date; v_cut date; v_res jsonb;
begin
  select max(posting_date) into v_max from sales_lines where doc_type = p_doc and fy_start = p_cy;
  v_cut := case when v_max is null then null else (v_max - make_interval(years => p_cy - p_base))::date end;
  with base as (
    select coalesce(card_name,'(blank)') as card, coalesce(account_type,'(blank)') as acct,
           coalesce(basket_group,'(blank)') as basket, fy_start as fy, fy_month as m,
           coalesce(doc_total_fc,0) as v, quantity as q,
           case when gross_value > 0 and coalesce(basket_group,'(blank)') not in ('Software','Others','OEM','Service Item','(blank)')
                then line_total end as lt,
           case when coalesce(basket_group,'(blank)') not in ('Software','Others','OEM','Service Item','(blank)')
                then gross_value end as g
    from sales_lines
    where doc_type = p_doc and fy_start in (p_cy, p_base)
      and public.cp_rkey(region) = public.cp_rkey(p_region)
      and (cardinality(p_acct)   = 0 or coalesce(account_type,'(blank)')   = any(p_acct))
      and (cardinality(p_basket) = 0 or coalesce(basket_group,'(blank)')   = any(p_basket))
      and (cardinality(p_series) = 0 or coalesce(product_series,'(blank)') = any(p_series))
      and (cardinality(p_months) = 0 or fy_month = any(p_months))
      and (cardinality(p_months) > 0 or fy_start = p_cy or posting_date <= v_cut))
  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(x), '[]') from (
               select card, max(acct) as acct, fy, m, round(sum(v), 2) as v from base group by card, fy, m) x),
    'pb',   (select coalesce(jsonb_agg(x), '[]') from (
               select card, basket, fy, round(sum(v), 2) as v, round(sum(lt), 2) as lt, round(sum(g), 2) as g, sum(q) as qty
               from base group by card, basket, fy) x)
  ) into v_res;
  return v_res;
end;
$$;

grant execute on function public.cp_performance(text,int,int,text[],text[],text[],text[],int[]) to anon, authenticated;
grant execute on function public.cp_partner_monthly(text,int,int,text,text[],text[],text[],int[]) to anon, authenticated;
grant execute on function public.cp_perf_region(text,int,int,text,text[],text[],text[],int[]) to anon, authenticated;
notify pgrst, 'reload schema';
