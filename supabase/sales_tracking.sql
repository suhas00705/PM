-- Sales Tracking dashboard (Menu → Sales Tracking)
-- OB or Invoice value (DocTotalFC) for the chosen FY and the FY before, by month, product basket,
-- product series, region and sales engineer. Same OEM account rules as PM Cumulative Tracking.
-- Safe to re-run.

-- Focus products: edit this table to change what counts as a focus product (series name patterns, ILIKE).
create table if not exists public.st_focus_products (
  focus   text not null,
  pattern text not null,
  sort    int  not null default 0,
  primary key (focus, pattern)
);
insert into public.st_focus_products (focus, pattern, sort) values
  ('GMD',               'GMD',              1),
  ('Load Disconnector', 'LD DIN%',          2),
  ('PQ Series',         'PQ %',             3),
  ('MTS',               'MTS',              4),
  ('Solenoid',          'ATeS Solenoid%',   5)
on conflict do nothing;
-- ATeS motorised / controller are not focus products (only the Solenoid variant is)
delete from public.st_focus_products where focus = 'ATeS';
grant select on public.st_focus_products to anon, authenticated;

create or replace function public.cp_rkey(t text) returns text
language sql immutable as $$ select upper(regexp_replace(trim(coalesce(t,'(blank)')), '\s+', ' ', 'g')) $$;

-- Lines of one document type for FY p_cy and p_cy-1, with the OEM basket rules applied.
-- lfl = true when the line counts in a like-for-like comparison (all of p_cy; p_cy-1 only up to the same date last year).
create or replace function public.st_base(p_doc text, p_cy int)
returns table(fy int, m int, basket text, series text, rkey text, region text, eng text, card text, docnum bigint,
              v numeric, q numeric, lfl boolean)
language sql stable as $$
  with mx as (select max(posting_date) as d from sales_lines where doc_type = p_doc and fy_start = p_cy),
  src as (
    select s.*,
      (case when s.card_name = any(array(select ov_key from public.pm_card_override where ov_mode = 'OEM'))
              or s.card_name || '|' || coalesce(s.product_basket,'') = any(array(select ov_key from public.pm_card_override where ov_mode = 'OEM_B')) then 'OEM'
            when coalesce(s.product_basket,'') = 'OEM'
              and s.card_name = any(array(select ov_key from public.pm_card_override where ov_mode = 'EXCL')) then null
            else coalesce(s.product_basket, '(blank)') end) as eb
    from sales_lines s
    where s.doc_type = p_doc and s.fy_start in (p_cy, p_cy - 1))
  select fy_start, fy_month,
         case when eb in ('Panel Meters','High End MFM','Power Quality') then 'Panel Meters'
              when eb in ('Prepaid','Smart Meters','Prepaid & Smart Meters') then 'Prepaid & Smart Meters'
              else eb end,
         coalesce(nullif(trim(product_series),''), '(blank)'),
         public.cp_rkey(region), coalesce(nullif(trim(region),''), '(blank)'),
         coalesce(nullif(trim(slp_name),''), '(blank)'),
         coalesce(card_name, '(blank)'), doc_num,
         coalesce(doc_total_fc, 0), coalesce(quantity, 0),
         (fy_start = p_cy or posting_date <= (select (d - interval '1 year')::date from mx))
  from src where eb is not null
$$;

-- Everything the page needs in one call, compact: dictionaries + rows [fy, m, basket#, series#, region#, eng#, valueL, lflValueL, qty]
create or replace function public.st_cube(p_doc text, p_cy int)
returns jsonb language plpgsql stable as $$
declare v_res jsonb; v_max date;
begin
  select max(posting_date) into v_max from sales_lines where doc_type = p_doc and fy_start = p_cy;
  with
  _st as materialized (select * from public.st_base(p_doc, p_cy)),
  b as (select basket, row_number() over (order by basket) - 1 as i from (select distinct basket from _st) x),
  sr as (select basket, series, row_number() over (order by basket, series) - 1 as i from (select distinct basket, series from _st) x),
  rd as (select distinct on (rkey) rkey, region as disp from (select rkey, region, count(*) c from _st group by 1, 2) z order by rkey, c desc),
  rg as (select rkey, disp, row_number() over (order by rkey) - 1 as i from rd),
  en as (select eng, row_number() over (order by eng) - 1 as i from (select distinct eng from _st) x),
  agg as (
    select t.fy, t.m, b.i bi, sr.i si, rg.i ri, en.i ei,
           round(sum(t.v) / 1e5, 3) as v, round(sum(t.v) filter (where t.lfl) / 1e5, 3) as vl, sum(t.q) as q, sum(t.q) filter (where t.lfl) as ql
    from _st t join b using (basket) join sr on sr.basket = t.basket and sr.series = t.series
         join rg using (rkey) join en using (eng)
    group by 1,2,3,4,5,6)
  select jsonb_build_object(
    'meta', jsonb_build_object('doc', p_doc, 'cy', p_cy, 'base', p_cy - 1, 'max_date', v_max,
                               'base_cut', (v_max - interval '1 year')::date),
    'baskets', (select coalesce(jsonb_agg(basket order by i), '[]') from b),
    'series',  (select coalesce(jsonb_agg(jsonb_build_array(series, (select b.i from b where b.basket = sr.basket),
                  (select f.focus from public.st_focus_products f where sr.series ilike f.pattern order by f.sort limit 1)) order by i), '[]') from sr),
    'regions', (select coalesce(jsonb_agg(disp order by i), '[]') from rg),
    'engineers', (select coalesce(jsonb_agg(eng order by i), '[]') from en),
    'focus', (select coalesce(jsonb_agg(focus order by s), '[]') from (select focus, min(sort) s from public.st_focus_products group by 1) f),
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(fy, m, bi, si, ri, ei, v, coalesce(vl, 0), q, coalesce(ql, 0))), '[]') from agg)
  ) into v_res;
  return v_res;
end $$;

-- Distinct customers and documents per engineer and per region for the current filters (not additive, so counted here).
create or replace function public.st_people(p_doc text, p_cy int,
  p_basket text[] default '{}', p_series text[] default '{}', p_region text[] default '{}',
  p_eng text[] default '{}', p_months int[] default '{}')
returns jsonb language sql stable as $$
  with t as materialized (
    select * from public.st_base(p_doc, p_cy) x
    where lfl
      and (cardinality(p_basket) = 0 or basket = any(p_basket))
      and (cardinality(p_series) = 0 or series = any(p_series))
      and (cardinality(p_region) = 0 or rkey = any(array(select public.cp_rkey(r) from unnest(p_region) r)))
      and (cardinality(p_eng)    = 0 or eng = any(p_eng))
      and (cardinality(p_months) = 0 or m = any(p_months)))
  select jsonb_build_object(
    'eng', (select coalesce(jsonb_agg(jsonb_build_array(eng, fy, cust, docs)), '[]') from
             (select eng, fy, count(distinct card) cust, count(distinct docnum) docs from t group by 1, 2) a),
    'reg', (select coalesce(jsonb_agg(jsonb_build_array(rkey, fy, cust, docs)), '[]') from
             (select rkey, fy, count(distinct card) cust, count(distinct docnum) docs from t group by 1, 2) a),
    'all', (select coalesce(jsonb_agg(jsonb_build_array(fy, cust, docs)), '[]') from
             (select fy, count(distinct card) cust, count(distinct docnum) docs from t group by 1) a))
$$;

grant execute on function public.st_base(text,int) to anon, authenticated;
grant execute on function public.st_cube(text,int) to anon, authenticated;
grant execute on function public.st_people(text,int,text[],text[],text[],text[],int[]) to anon, authenticated;
notify pgrst, 'reload schema';
