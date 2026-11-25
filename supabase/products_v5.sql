-- Leads tab: product lines pop-up (25-Nov-2026). Safe to re-run.
-- rows: [lead id, basket, series, qty, amount Rs]
create or replace function public.lead_lines_for(p_ids text[])
returns jsonb language sql stable security definer
set search_path = public as $$
select jsonb_build_object(
  'lines_synced', (select last_done from lead_lines_state
                   where id = 1),
  'rows', (select coalesce(jsonb_agg(jsonb_build_array(
             lead_id, bk, sr, q, a)), '[]')
           from (select lead_id,
                   coalesce(nullif(trim(basket), ''),
                            '(no basket)') bk,
                   coalesce(nullif(trim(series), ''),
                            '(no series)') sr,
                   sum(coalesce(qty, 0)) q,
                   round(sum(coalesce(amount, 0)), 0) a
                 from lead_lines
                 where lead_id = any(p_ids)
                 group by 1, 2, 3) z));
$$;
grant execute on function public.lead_lines_for(text[])
  to anon, authenticated;

notify pgrst, 'reload schema';
