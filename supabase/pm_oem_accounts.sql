-- OEM accounts: every OB & Invoice line of these accounts is counted under the OEM product basket
-- (OEM Tracking tab, OEM row of PM Cumulative Tracking, and taken out of their original basket in the
-- PM Cumulative Tracking table, Growth and Product-series charts). Channel Partner tab is not changed.
-- Accounts in pm_oem_excluded (8-Oct) stay excluded from OEM.
-- To add an account later:
--   insert into pm_oem_accounts values (public.pm_key('Account Name'), 'Account Name');
create table if not exists public.pm_oem_excluded (card_key text primary key, card_name text);
create table if not exists public.pm_oem_accounts (card_key text primary key, card_name text);
grant select on public.pm_oem_accounts to anon, authenticated;

create or replace function public.pm_key(t text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(t,''), '[^A-Za-z0-9]', '', 'g')) $$;

insert into public.pm_oem_accounts values
  (public.pm_key('SAI ADVANCED POWER SOLUTIONS, INC'), 'SAI ADVANCED POWER SOLUTIONS, INC'),
  (public.pm_key('GREATWHITE GLOBAL PVT LTD'),         'GREATWHITE GLOBAL PVT LTD')
on conflict do nothing;

-- Accounts with an OEM override (small list, looked up by exact card_name spelling in the data).
-- ov_mode 'OEM' = count all their lines as OEM; 'EXCL' = leave their OEM-basket lines out.
create or replace view public.pm_card_override as
  select x.card_name as ov_card,
         case when public.pm_key(x.card_name) in (select card_key from public.pm_oem_accounts) then 'OEM' else 'EXCL' end as ov_mode
  from (select distinct card_name from public.sales_lines where card_name is not null) x
  where public.pm_key(x.card_name) in (select card_key from public.pm_oem_accounts
                                       union select card_key from public.pm_oem_excluded);
grant select on public.pm_card_override to anon, authenticated;

grant execute on function public.pm_key(text) to anon, authenticated;

-- PM Cumulative Tracking: OB + Invoice value (DocTotalFC) by product basket and month for one FY.
-- Mapping basket -> product family (Panel Meters, ACCL, ATES …) is done in pm-tracking.html,
-- so it can be changed without touching SQL. Govt Projects are flagged so Prepaid/Smart can exclude them.
create or replace function public.pm_tracking(p_fy int)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'fys', (select coalesce(jsonb_agg(f order by f desc), '[]') from (select distinct fy_start as f from sales_lines) x),
    'max_date', (select max(posting_date) from sales_lines where fy_start = p_fy),
    'max_date_ob',  (select max(posting_date) from sales_lines where fy_start = p_fy and doc_type = 'OB'),
    'max_date_inv', (select max(posting_date) from sales_lines where fy_start = p_fy and doc_type = 'INV'),
    'last_sync', (select jsonb_build_object('at', finished_at, 'status', status)
                    from sales_sync_log order by id desc limit 1),
    'rows', (select coalesce(jsonb_agg(x), '[]') from (
               select doc_type as d,
                      eb as b,
                      (coalesce(account_type, '') = 'Govt Projects') as gov,
                      fy_month as m,
                      round(sum(coalesce(doc_total_fc, 0)), 2) as v
               from (select s.*, (case when s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'OEM')) then 'OEM' when coalesce(s.product_basket,'') = 'OEM' and s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'EXCL')) then null else coalesce(s.product_basket, '(blank)') end) as eb
                     from sales_lines s
                     where s.fy_start = p_fy) s
               where eb is not null
               group by 1, 2, 3, 4) x)
  );
$$;
grant execute on function public.pm_tracking(int) to anon, authenticated;


-- OEM tracking: OEM product basket lines (plus accounts in pm_oem_accounts, minus pm_oem_excluded), chosen FY vs the FY before, by month, product series, model (cat code) and customer.
-- Value = DocTotalFC, Qty = quantity. Last year's copy of the latest (still running) month is cut at the same day.
-- 'items' gives each cat code its model and description (most common spelling).
create or replace function public.pm_oem(p_cy int)
returns jsonb language plpgsql stable as $$
declare v_max date; v_cut date; v_res jsonb;
begin
  select max(posting_date) into v_max from sales_lines where fy_start = p_cy;
  v_cut := case when v_max is null then null else (v_max - interval '1 year')::date end;
  select jsonb_build_object(
    'cy', p_cy, 'base', p_cy - 1, 'max_date', v_max, 'base_cut', v_cut,
    'fys', (select coalesce(jsonb_agg(f order by f desc), '[]') from (select distinct fy_start as f from sales_lines) x),
    'last_sync', (select jsonb_build_object('at', finished_at, 'status', status) from sales_sync_log order by id desc limit 1),
    'items', (select coalesce(jsonb_object_agg(k, jsonb_build_object('m', m, 'n', n)), '{}') from (
      select coalesce(cat_code, '(no cat code)') as k,
             mode() within group (order by nullif(trim(model_id), '')) as m,
             mode() within group (order by nullif(trim(description), '')) as n
      from sales_lines s
      where s.fy_start in (p_cy, p_cy - 1) and (case when s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'OEM')) then 'OEM' when coalesce(s.product_basket,'') = 'OEM' and s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'EXCL')) then null else coalesce(s.product_basket, '(blank)') end) = 'OEM' group by 1) i),
    'rows', (select coalesce(jsonb_agg(x), '[]') from (
      select doc_type as d, fy_start as fy, fy_month as m,
             coalesce(product_series, '(blank)') as s,
             coalesce(cat_code, '(no cat code)') as k,
             coalesce(card_name, '(blank)') as c,
             coalesce(account_type, '(blank)') as a,
             round(sum(coalesce(doc_total_fc, 0)), 2) as v,
             round(sum(coalesce(quantity, 0)), 2) as q
      from sales_lines s
      where fy_start in (p_cy, p_cy - 1)
        and (case when s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'OEM')) then 'OEM' when coalesce(s.product_basket,'') = 'OEM' and s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'EXCL')) then null else coalesce(s.product_basket, '(blank)') end) = 'OEM'
        and not (fy_start = p_cy - 1 and v_max is not null
                 and fy_month = extract(month from v_max) and posting_date > v_cut)
      group by 1, 2, 3, 4, 5, 6, 7) x)
  ) into v_res;
  return v_res;
end;
$$;
grant execute on function public.pm_oem(int) to anon, authenticated;

-- PM Cumulative Tracking — growth chart: this FY vs last FY by product basket, U-Region and month (DocTotalFC).
-- Region = U_region (the OB column). Invoices have no U_region, so an invoice takes its customer's U_region from
-- their orders; if the customer has no order, its SE region is matched to the U_region spelling.
-- Last year's copy of the latest (still running) month is cut at the same day, so the comparison is like-for-like.
create or replace function public.pm_growth(p_cy int)
returns jsonb language plpgsql stable as $$
declare v_max date; v_cut date; v_res jsonb;
begin
  select max(posting_date) into v_max from sales_lines where fy_start = p_cy;
  v_cut := case when v_max is null then null else (v_max - interval '1 year')::date end;
  with ob_cust as (
         select card_name, region, sum(abs(coalesce(doc_total_fc, 0))) as v
         from sales_lines where doc_type = 'OB' and region is not null and card_name is not null
         group by 1, 2),
       cust_region as (
         select distinct on (card_name) card_name, region from ob_cust order by card_name, v desc),
       spelling as (
         select distinct on (upper(trim(region))) upper(trim(region)) as k, region
         from sales_lines where doc_type = 'OB' and region is not null
         group by region order by upper(trim(region)), count(*) desc),
       src as (
         select s.doc_type, s.fy_start, s.fy_month, (case when s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'OEM')) then 'OEM' when coalesce(s.product_basket,'') = 'OEM' and s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'EXCL')) then null else coalesce(s.product_basket, '(blank)') end) as product_basket, s.account_type, s.doc_total_fc,
                case when s.doc_type = 'OB' then s.region
                     else coalesce(c.region, sp.region, s.region) end as u_region
         from sales_lines s
         left join cust_region c on s.doc_type <> 'OB' and c.card_name = s.card_name
         left join spelling sp   on s.doc_type <> 'OB' and sp.k = upper(trim(s.region))
        
         where s.fy_start in (p_cy, p_cy - 1)
           and not (s.fy_start = p_cy - 1 and v_max is not null
                    and s.fy_month = extract(month from v_max) and s.posting_date > v_cut))
  select jsonb_build_object(
    'cy', p_cy, 'base', p_cy - 1, 'max_date', v_max, 'base_cut', v_cut,
    'rows', (select coalesce(jsonb_agg(x), '[]') from (
      select doc_type as d, fy_start as fy, fy_month as m,
             coalesce(u_region, '(blank)') as r,
             coalesce(product_basket, '(blank)') as b,
             (coalesce(account_type, '') = 'Govt Projects') as gov,
             round(sum(coalesce(doc_total_fc, 0)), 2) as v
      from src where product_basket is not null group by 1, 2, 3, 4, 5, 6) x)
  ) into v_res;
  return v_res;
end;
$$;
grant execute on function public.pm_growth(int) to anon, authenticated;

-- PM Cumulative Tracking — product series growth: this FY vs last FY, value (DocTotalFC) and quantity,
-- by month, U-Region, product basket and product series. Same rules as pm_growth:
-- invoices take the customer's U_region; last year's latest month is cut at the same day.
create or replace function public.pm_series_growth(p_cy int)
returns jsonb language plpgsql stable as $$
declare v_max date; v_cut date; v_res jsonb;
begin
  select max(posting_date) into v_max from sales_lines where fy_start = p_cy;
  v_cut := case when v_max is null then null else (v_max - interval '1 year')::date end;
  with ob_cust as (
         select card_name, region, sum(abs(coalesce(doc_total_fc, 0))) as v
         from sales_lines where doc_type = 'OB' and region is not null and card_name is not null
         group by 1, 2),
       cust_region as (
         select distinct on (card_name) card_name, region from ob_cust order by card_name, v desc),
       spelling as (
         select distinct on (upper(trim(region))) upper(trim(region)) as k, region
         from sales_lines where doc_type = 'OB' and region is not null
         group by region order by upper(trim(region)), count(*) desc),
       src as (
         select s.doc_type, s.fy_start, s.fy_month, (case when s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'OEM')) then 'OEM' when coalesce(s.product_basket,'') = 'OEM' and s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'EXCL')) then null else coalesce(s.product_basket, '(blank)') end) as product_basket, s.product_series, s.account_type,
                s.doc_total_fc, s.quantity,
                case when s.doc_type = 'OB' then s.region
                     else coalesce(c.region, sp.region, s.region) end as u_region
         from sales_lines s
         left join cust_region c on s.doc_type <> 'OB' and c.card_name = s.card_name
         left join spelling sp   on s.doc_type <> 'OB' and sp.k = upper(trim(s.region))
        
         where s.fy_start in (p_cy, p_cy - 1)
           and (case when s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'OEM')) then 'OEM' when coalesce(s.product_basket,'') = 'OEM' and s.card_name = any(array(select ov_card from public.pm_card_override where ov_mode = 'EXCL')) then null else coalesce(s.product_basket, '(blank)') end) in ('Panel Meters','High End MFM','Nano VIP','Power Quality','ACCL','Transfer Switch',
                                    'Prepaid & Smart Meters','Prepaid','Smart Meters','SWITCHGEAR')
           and not (s.fy_start = p_cy - 1 and v_max is not null
                    and s.fy_month = extract(month from v_max) and s.posting_date > v_cut))
  select jsonb_build_object(
    'cy', p_cy, 'base', p_cy - 1, 'max_date', v_max, 'base_cut', v_cut,
    'rows', (select coalesce(jsonb_agg(x), '[]') from (
      select doc_type as d, fy_start as fy, fy_month as m,
             coalesce(u_region, '(blank)') as r,
             product_basket as b,
             coalesce(product_series, '(blank)') as s,
             (coalesce(account_type, '') = 'Govt Projects') as gov,
             round(sum(coalesce(doc_total_fc, 0)), 2) as v,
             round(sum(coalesce(quantity, 0)), 2) as q
      from src group by 1, 2, 3, 4, 5, 6, 7) x)
  ) into v_res;
  return v_res;
end;
$$;
grant execute on function public.pm_series_growth(int) to anon, authenticated;
notify pgrst, 'reload schema';

notify pgrst, 'reload schema';
