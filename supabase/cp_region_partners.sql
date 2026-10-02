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
      select *, (coalesce(product_basket,'(blank)') = any(p_focus)
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
