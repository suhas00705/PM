-- Products tab, round 7 (25-Nov-2026). Read-only. Safe to re-run.
-- Channel partner / VAR coverage, region-wise, every product.
create or replace function public.prd_cp_cover(
  p_cy int, p_months int[], p_fam text,
  p_acct text[] default '{}')
returns jsonb language sql stable as $$
with mx as (
  select max(posting_date) d from sales_lines
  where doc_type = 'OB' and fy_start = p_cy),
rdisp as (
  select distinct on (k) k, region from (
    select public.cp_rkey(region) k,
           coalesce(trim(region), '(blank)') region,
           count(*) c
    from sales_lines where doc_type = 'OB'
    group by 1, 2) z
  order by k, c desc),
b as materialized (
  select coalesce(s.card_name, '(blank)') card,
         coalesce(s.account_type, '(blank)') acct,
         coalesce(rd.region, '(blank)') region,
         s.fy_start fy, s.fy_month m, s.posting_date pd,
         (case when upper(trim(coalesce(
                      s.product_series, '')))
                    in ('MTS', 'MCS') then 'ATES'
               else public.prd_fam(
                      coalesce(s.product_basket, ''), false)
          end) = p_fam fdp,
         coalesce(nullif(trim(s.product_series), ''),
                  '(no series)') sr,
         coalesce(s.doc_total_fc, 0) v,
         coalesce(s.quantity, 0) q
  from sales_lines s
  left join rdisp rd on rd.k = public.cp_rkey(s.region)
  where s.doc_type = 'OB'
    and s.fy_start in (p_cy, p_cy - 1)
    and (case when cardinality(p_acct) = 0 then
           s.account_type in ('Channel Partners',
                              'Channel Partner')
           or s.account_type ilike '%value added%'
         else coalesce(s.account_type, '(blank)')
              = any(p_acct)
         end)),
sel as (
  select * from b
  where fy = p_cy and m = any(p_months)),
ser as (
  select card, jsonb_agg(jsonb_build_array(
           sr, q, round(v / 1e5, 2)) order by v desc) s
  from (select card, sr, sum(q) q, sum(v) v
        from sel where fdp group by 1, 2) z
  group by card),
p as (
  select card, max(acct) acct,
         (array_agg(region order by v desc))[1] region
  from b group by card
  having abs(sum(v)) > 0),
ym as (
  select card, fy, m, sum(v) v
  from b where fdp group by 1, 2, 3),
yarr as (
  select c.card, c.fy,
         jsonb_agg(round(coalesce(x.v, 0) / 1e5, 2)
                   order by u.i) a
  from (select distinct card, fy from ym) c
  cross join unnest(array[4,5,6,7,8,9,10,11,12,1,2,3])
       with ordinality u(mm, i)
  left join ym x
    on x.card = c.card and x.fy = c.fy and x.m = u.mm
  group by 1, 2),
y as (
  select card,
    round(sum(v) filter (where fy = p_cy) / 1e5, 2) yv,
    round(sum(q) filter (where fy = p_cy), 0) yq,
    round(coalesce(sum(v) filter (where fy = p_cy - 1
      and pd <= (select d from mx) - interval '1 year'),
      0) / 1e5, 2) lyv,
    round(sum(v) filter (where fy = p_cy - 1) / 1e5, 2) lyf
  from b where fdp group by card)
select jsonb_build_object(
  'max_date', (select d from mx),
  'types', (select coalesce(jsonb_agg(t order by t), '[]')
            from (select distinct
                    coalesce(account_type, '(blank)') t
                  from sales_lines
                  where doc_type = 'OB'
                    and fy_start in (p_cy, p_cy - 1)) x),
  'rows', (select coalesce(jsonb_agg(jsonb_build_array(
             p.card, p.acct, p.region,
             round(coalesce(f.q, 0), 0),
             round(coalesce(f.v, 0) / 1e5, 2),
             l.last, round(coalesce(a.v, 0) / 1e5, 2),
             coalesce(ser.s, '[]'::jsonb),
             y.yv, y.yq, y.lyv, y.lyf,
             yc.a, yl.a)), '[]')
           from p
           left join (select card, sum(q) q, sum(v) v
                      from sel where fdp group by 1) f
             on f.card = p.card
           left join (select card, sum(v) v
                      from sel group by 1) a
             on a.card = p.card
           left join (select card, max(pd) last from b
                      where fdp and fy = p_cy
                      group by 1) l
             on l.card = p.card
           left join ser on ser.card = p.card
           left join y on y.card = p.card
           left join yarr yc
             on yc.card = p.card and yc.fy = p_cy
           left join yarr yl
             on yl.card = p.card and yl.fy = p_cy - 1));
$$;
grant execute on function
  public.prd_cp_cover(int, int[], text, text[])
  to anon, authenticated;

notify pgrst, 'reload schema';
