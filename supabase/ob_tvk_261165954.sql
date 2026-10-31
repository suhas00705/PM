-- OB fix (31-Oct-2026): OA 261165954 TVK Vector-VS LLC (Export) was amended in Zoho.
--   Zoho: OA_Date 23-Oct-2026, 350 x TVATS2F125AT + 60 x TVATS3F160AT, $94,175
--         = Rs 87.21 L at Zoho's rate (1 USD = 92.61 Rs).
--   Portal (SAP Excel): 11-Sep-2026, 200 + 60 pcs = Rs 59.09 L.
-- This moves the order to October and sets the Zoho quantity / value.
-- Safe to re-run. UNDO at the bottom.

-- PART 1 : backup (only the first time)
create table if not exists public.st_tvk_backup as
  select * from public.sales_lines
  where doc_type = 'OB' and doc_num = 261165954;

-- PART 2 : align to Zoho
update public.sales_lines set
  posting_date = '2026-10-23', doc_date = '2026-10-23',
  fy_start = 2026, fy_month = 10,
  quantity = case when cat_code = 'TVATS2F125AT'
                  then 350 else quantity end,
  line_total = case when cat_code = 'TVATS2F125AT'
                    then 6887849.60 else 1833672.90 end,
  doc_total_fc = case when cat_code = 'TVATS2F125AT'
                      then 6887849.60 else 1833672.90 end,
  doc_total = 8721522.50
where doc_type = 'OB' and doc_num = 261165954;

-- check: Rs 87.21 L in Oct
select fy_month, count(*), sum(doc_total_fc) / 1e5 as lakhs
from public.sales_lines
where doc_type = 'OB' and doc_num = 261165954
group by 1;

-- UNDO (only if needed):
-- delete from public.sales_lines
--   where doc_type = 'OB' and doc_num = 261165954;
-- insert into public.sales_lines
--   select * from public.st_tvk_backup;
