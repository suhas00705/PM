-- Govt Projects rule for Prepaid/Smart (9-Oct-2026): a line is Govt if the account type is 'Govt Projects'
-- OR its region is 'GOVT PROJECTS' (any engineer / SE region). Re-defines the 3 PM Cumulative Tracking functions. Safe to re-run.

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
                      (coalesce(account_type, '') = 'Govt Projects' or upper(trim(coalesce(region, ''))) = 'GOVT PROJECTS') as gov,
                      fy_month as m,
                      round(sum(coalesce(doc_total_fc, 0)), 2) as v
               from (select s.*, (case when s.card_name = any(array(select ov_key from public.pm_card_override where ov_mode = 'OEM')) or s.card_name || '|' || coalesce(s.product_basket,'') = any(array(select ov_key from public.pm_card_override where ov_mode = 'OEM_B')) then 'OEM' when coalesce(s.product_basket,'') = 'OEM' and s.card_name = any(array(select ov_key from public.pm_card_override where ov_mode = 'EXCL')) then null else coalesce(s.product_basket, '(blank)') end) as eb
                     from sales_lines s
                     where s.fy_start = p_fy) s
               where eb is not null
               group by 1, 2, 3, 4) x)
  );
$$;
grant execute on function public.pm_tracking(int) to anon, authenticated;

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
         select s.doc_type, s.fy_start, s.fy_month, (case when s.card_name = any(array(select ov_key from public.pm_card_override where ov_mode = 'OEM')) or s.card_name || '|' || coalesce(s.product_basket,'') = any(array(select ov_key from public.pm_card_override where ov_mode = 'OEM_B')) then 'OEM' when coalesce(s.product_basket,'') = 'OEM' and s.card_name = any(array(select ov_key from public.pm_card_override where ov_mode = 'EXCL')) then null else coalesce(s.product_basket, '(blank)') end) as product_basket, s.account_type, s.region as raw_region, s.doc_total_fc,
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
             (coalesce(account_type, '') = 'Govt Projects' or upper(trim(coalesce(raw_region, ''))) = 'GOVT PROJECTS') as gov,
             round(sum(coalesce(doc_total_fc, 0)), 2) as v
      from src where product_basket is not null group by 1, 2, 3, 4, 5, 6) x)
  ) into v_res;
  return v_res;
end;
$$;
grant execute on function public.pm_growth(int) to anon, authenticated;

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
         select s.doc_type, s.fy_start, s.fy_month, (case when s.card_name = any(array(select ov_key from public.pm_card_override where ov_mode = 'OEM')) or s.card_name || '|' || coalesce(s.product_basket,'') = any(array(select ov_key from public.pm_card_override where ov_mode = 'OEM_B')) then 'OEM' when coalesce(s.product_basket,'') = 'OEM' and s.card_name = any(array(select ov_key from public.pm_card_override where ov_mode = 'EXCL')) then null else coalesce(s.product_basket, '(blank)') end) as product_basket, s.product_series, s.account_type, s.region as raw_region,
                s.doc_total_fc, s.quantity,
                case when s.doc_type = 'OB' then s.region
                     else coalesce(c.region, sp.region, s.region) end as u_region
         from sales_lines s
         left join cust_region c on s.doc_type <> 'OB' and c.card_name = s.card_name
         left join spelling sp   on s.doc_type <> 'OB' and sp.k = upper(trim(s.region))
        
         where s.fy_start in (p_cy, p_cy - 1)
           and (case when s.card_name = any(array(select ov_key from public.pm_card_override where ov_mode = 'OEM')) or s.card_name || '|' || coalesce(s.product_basket,'') = any(array(select ov_key from public.pm_card_override where ov_mode = 'OEM_B')) then 'OEM' when coalesce(s.product_basket,'') = 'OEM' and s.card_name = any(array(select ov_key from public.pm_card_override where ov_mode = 'EXCL')) then null else coalesce(s.product_basket, '(blank)') end) in ('Panel Meters','High End MFM','Nano VIP','Power Quality','ACCL','Transfer Switch',
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
             (coalesce(account_type, '') = 'Govt Projects' or upper(trim(coalesce(raw_region, ''))) = 'GOVT PROJECTS') as gov,
             round(sum(coalesce(doc_total_fc, 0)), 2) as v,
             round(sum(coalesce(quantity, 0)), 2) as q
      from src group by 1, 2, 3, 4, 5, 6, 7) x)
  ) into v_res;
  return v_res;
end;
$$;
grant execute on function public.pm_series_growth(int) to anon, authenticated;

notify pgrst, 'reload schema';
