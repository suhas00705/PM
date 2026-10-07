-- Exclude chosen accounts from the OEM basket (OEM Tracking tab + OEM row of PM Cumulative Tracking).
-- Accounts are matched on the name with spaces/punctuation removed, upper-case.
-- To exclude another account later:  insert into pm_oem_excluded values (upper(regexp_replace('Name Here','[^A-Za-z0-9]','','g')), 'Name Here');
create table if not exists public.pm_oem_excluded (card_key text primary key, card_name text);
insert into public.pm_oem_excluded values
  ('ELMEASUREINDIAPRIVATELIMITED', 'Elmeasure India Private Limited'),
  ('UNIPOWERUKLTD', 'Unipower UK Ltd')
on conflict do nothing;
grant select on public.pm_oem_excluded to anon, authenticated;

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
                      coalesce(product_basket, '(blank)') as b,
                      (coalesce(account_type, '') = 'Govt Projects') as gov,
                      fy_month as m,
                      round(sum(coalesce(doc_total_fc, 0)), 2) as v
               from sales_lines
               where fy_start = p_fy
                 and not (product_basket = 'OEM' and upper(regexp_replace(coalesce(card_name,''), '[^A-Za-z0-9]', '', 'g')) in (select card_key from public.pm_oem_excluded))
               group by 1, 2, 3, 4) x)
  );
$$;
grant execute on function public.pm_tracking(int) to anon, authenticated;

-- OEM tracking: OEM product basket lines, chosen FY vs the FY before, by month, product series, model (cat code) and customer.
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
      from sales_lines where product_basket = 'OEM' and fy_start in (p_cy, p_cy - 1)
        and not (product_basket = 'OEM' and upper(regexp_replace(coalesce(card_name,''), '[^A-Za-z0-9]', '', 'g')) in (select card_key from public.pm_oem_excluded)) group by 1) i),
    'rows', (select coalesce(jsonb_agg(x), '[]') from (
      select doc_type as d, fy_start as fy, fy_month as m,
             coalesce(product_series, '(blank)') as s,
             coalesce(cat_code, '(no cat code)') as k,
             coalesce(card_name, '(blank)') as c,
             coalesce(account_type, '(blank)') as a,
             round(sum(coalesce(doc_total_fc, 0)), 2) as v,
             round(sum(coalesce(quantity, 0)), 2) as q
      from sales_lines
      where product_basket = 'OEM' and fy_start in (p_cy, p_cy - 1)
        and not (product_basket = 'OEM' and upper(regexp_replace(coalesce(card_name,''), '[^A-Za-z0-9]', '', 'g')) in (select card_key from public.pm_oem_excluded))
        and not (fy_start = p_cy - 1 and v_max is not null
                 and fy_month = extract(month from v_max) and posting_date > v_cut)
      group by 1, 2, 3, 4, 5, 6, 7) x)
  ) into v_res;
  return v_res;
end;
$$;
grant execute on function public.pm_oem(int) to anon, authenticated;
notify pgrst, 'reload schema';
