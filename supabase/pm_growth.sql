-- PM Cumulative Tracking — growth chart: this FY vs last FY by product basket, region and month (DocTotalFC).
-- Last year's copy of the latest (still running) month is cut at the same day, so the comparison is like-for-like.
create or replace function public.pm_growth(p_cy int)
returns jsonb language plpgsql stable as $$
declare v_max date; v_cut date; v_res jsonb;
begin
  select max(posting_date) into v_max from sales_lines where fy_start = p_cy;
  v_cut := case when v_max is null then null else (v_max - interval '1 year')::date end;
  select jsonb_build_object(
    'cy', p_cy, 'base', p_cy - 1, 'max_date', v_max, 'base_cut', v_cut,
    'rows', (select coalesce(jsonb_agg(x), '[]') from (
      select doc_type as d, fy_start as fy, fy_month as m,
             coalesce(region, '(blank)') as r,
             coalesce(product_basket, '(blank)') as b,
             (coalesce(account_type, '') = 'Govt Projects') as gov,
             round(sum(coalesce(doc_total_fc, 0)), 2) as v
      from sales_lines
      where fy_start in (p_cy, p_cy - 1)
        and not (fy_start = p_cy - 1 and v_max is not null
                 and fy_month = extract(month from v_max) and posting_date > v_cut)
      group by 1, 2, 3, 4, 5, 6) x)
  ) into v_res;
  return v_res;
end;
$$;
grant execute on function public.pm_growth(int) to anon, authenticated;
notify pgrst, 'reload schema';
