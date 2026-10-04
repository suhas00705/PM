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
               group by 1, 2, 3, 4) x)
  );
$$;
grant execute on function public.pm_tracking(int) to anon, authenticated;
notify pgrst, 'reload schema';
