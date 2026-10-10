-- Panel Meters alignment with Zoho (10-Oct-2026). Safe to re-run; backups kept.
-- Fix D: Zoho OB lines that are not Approved (e.g. Payment Commitment, PI Request) and B & E / test orders are removed.
-- Fix C: FY 2026-27 SAP OAs whose Panel Meters value differs from Zoho are set to the Zoho value (47 OAs; SAI ADVANCED stays as it is, under OEM).

-- Fix D
create table if not exists public.sales_lines_ob_cancelled (like public.sales_lines);
alter table public.sales_lines_ob_cancelled add column if not exists moved_at timestamptz default now();
insert into public.sales_lines_ob_cancelled
  select s.*, now() from public.sales_lines s
  where s.doc_type = 'OB' and s.source = 'zoho'
    and (coalesce(trim(s.crm_status), '') !~* '^approved$' or s.card_name ~* 'B\s*&\s*E\s+ELECTRIC|TEST\s+DUMMY')
on conflict do nothing;
delete from public.sales_lines s
 where s.doc_type = 'OB' and s.source = 'zoho'
   and (coalesce(trim(s.crm_status), '') !~* '^approved$' or s.card_name ~* 'B\s*&\s*E\s+ELECTRIC|TEST\s+DUMMY');

-- Fix C
create table if not exists public.st_pmval_fix (oa text primary key, zoho_value numeric);
insert into public.st_pmval_fix values
('261161435',81426.24),('261161610',815521.39),('261161608',17595.85),('261161798',768387.21),('261161882',826315.06),('261161888',73415.47),
('261161892',469138.5),('261161880',38794.27),('261161994',45672.02),('261162034',43813.4),('261162016',171293.76),('261162013',98236.18),
('261161982',428705.8),('261161703',20815.2),('261161935',153956.96),('261161872',110861.0),('261162079',168147.17),('261162151',573657.0),
('261162167',958620.0),('261162223',235877.01),('261162394',171858.74),('261162376',919614.74),('261162459',234457.15),('261769182',6785.0),
('261163005',55565.85),('261163234',533887.46),('262763027',338955.0),('261163291',150391.0),('261163483',642542.57),('261163573',346161.85),
('261163745',1393776.63),('261163754',949249.86),('261163955',423166.29),('261163944',20003.7),('261164174',33276.0),('261164387',68716.43),
('261164411',2090812.5),('261164704',26995.74),('261164927',27412.48),('261165279',243100.57),('261165737',166269.08),('261165748',300925.96),
('261166017',285436.1),('261166177',267677.69),('261166357',137546.34),('261166460',53288.8),('261166487',29788.86)
on conflict do nothing;
create table if not exists public.st_pmval_backup (id bigint primary key, price numeric, line_total numeric, tax_calc numeric,
  doc_total_fc numeric, factor numeric, at timestamptz default now());
insert into public.st_pmval_backup (id, price, line_total, tax_calc, doc_total_fc, factor)
  select s.id, s.price, s.line_total, s.tax_calc, s.doc_total_fc, f.zoho_value / t.cur
  from public.sales_lines s
  join (select doc_num::text as oa, sum(doc_total_fc) as cur from public.sales_lines
         where doc_type = 'OB' and source = 'excel' and product_basket = 'Panel Meters' group by 1) t on t.oa = s.doc_num::text
  join public.st_pmval_fix f on f.oa = t.oa
  where s.doc_type = 'OB' and s.source = 'excel' and s.product_basket = 'Panel Meters' and t.cur <> 0
    and s.doc_num::text not in (select distinct sl.doc_num::text from public.sales_lines sl join public.st_pmval_backup b on b.id = sl.id)
on conflict do nothing;
update public.sales_lines s
   set price = b.price * b.factor, line_total = b.line_total * b.factor, tax_calc = b.tax_calc * b.factor,
       doc_total_fc = b.doc_total_fc * b.factor
  from public.st_pmval_backup b
 where b.id = s.id and s.doc_total_fc is not distinct from b.doc_total_fc;

-- check: Panel Meters OB by month (SAI ADVANCED shown separately because the dashboard puts it under OEM)
select to_char(posting_date, 'YYYY-MM') as month,
       round(sum(doc_total_fc) / 1e5, 2) as panel_meters_lakh,
       round(sum(doc_total_fc) filter (where card_name ilike 'SAI ADVANCED%') / 1e5, 2) as sai_in_oem
from public.sales_lines
where doc_type = 'OB' and product_basket = 'Panel Meters' and posting_date >= '2026-04-01'
group by 1 order by 1;

-- UNDO Fix C: update public.sales_lines s set price=b.price, line_total=b.line_total, tax_calc=b.tax_calc, doc_total_fc=b.doc_total_fc
--             from public.st_pmval_backup b where b.id = s.id; delete from public.st_pmval_backup;
