-- Update 4: product-series breakup of the focus basket for a whole region (all channel partners)
create or replace function public.cp_region_series(
  p_doc text, p_cy int, p_base int, p_region text[],
  p_acct text[] default '{}', p_focus text[] default '{}', p_series text[] default '{}',
  p_months int[] default '{}')
returns jsonb language plpgsql stable as $$
declare v_max date; v_cut date; v_res jsonb;
begin
  select max(posting_date) into v_max from sales_lines where doc_type = p_doc and fy_start = p_cy;
  v_cut := case when v_max is null then null else (v_max - make_interval(years => p_cy - p_base))::date end;
  select coalesce(jsonb_agg(x), '[]') into v_res from (
    select coalesce(product_series,'(blank)') as series, fy_start as fy, fy_month as m,
           sum(coalesce(quantity,0)) as qty, sum(coalesce(doc_total_fc,0)) as v,
           count(distinct card_name) as cust
    from sales_lines
    where doc_type = p_doc and fy_start in (p_cy, p_base)
      and acct_group = 'Channel Partners'
      and coalesce(basket_group,'(blank)') = any(p_focus)
      and (cardinality(p_series) = 0 or coalesce(product_series,'(blank)') = any(p_series))
      and (cardinality(p_region) = 0 or coalesce(region,'(blank)') = any(p_region))
      and (cardinality(p_acct)   = 0 or coalesce(account_type,'(blank)') = any(p_acct))
      and (cardinality(p_months) = 0 or fy_month = any(p_months))
      and (cardinality(p_months) > 0 or fy_start = p_cy or posting_date <= v_cut)
    group by 1, 2, 3) x;
  return v_res;
end;
$$;
grant execute on function public.cp_region_series(text,int,int,text[],text[],text[],text[],int[]) to anon, authenticated;
