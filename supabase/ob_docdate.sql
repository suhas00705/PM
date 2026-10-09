-- Order Booking month = SAP Document Date (DocDate), not Posting Date  (decided 9-Oct-2026)
-- Month-end SAP orders are dated the 30th/31st but posted on the 1st of the next month; the business
-- (and the Excel pivots) count them in the DocDate month. Zoho orders already have posting date = order date.
-- The original posting date is kept in orig_posting_date, so this is fully reversible. Safe to re-run.
alter table public.sales_lines add column if not exists orig_posting_date date;

update public.sales_lines
   set orig_posting_date = posting_date,
       posting_date      = doc_date
 where doc_type = 'OB' and source = 'excel'
   and doc_date is not null and posting_date <> doc_date
   and orig_posting_date is null;

-- check: lines moved and value by FY now
select fy_start, count(*) filter (where orig_posting_date is not null) as lines_moved,
       round(sum(doc_total_fc) / 1e5, 1) as ob_lakh
from public.sales_lines where doc_type = 'OB' group by 1 order by 1;

-- UNDO (only if ever needed):
-- update public.sales_lines set posting_date = orig_posting_date, orig_posting_date = null
--  where doc_type = 'OB' and orig_posting_date is not null;
