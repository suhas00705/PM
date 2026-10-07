-- SAI ADVANCED POWER SOLUTIONS, INC: SAP order values are in USD. Convert its order lines to INR.
-- Rate = the rate on the invoice that billed each order (SAP invoices are in INR):
--   OA 252655098 -> invoice 252627922 (30-Mar-2026): 94.52
--   OA 261162009 -> invoice 261108144 (16-May-2026): 95.70
--   OA 261166288 (not billed yet): latest invoice rate 95.70
-- Original USD values are kept in sales_lines_fx_adj, so this can be undone and is safe to run twice.
create table if not exists public.sales_lines_fx_adj (
  id bigint primary key, old_value numeric, old_price numeric, rate numeric, note text, at timestamptz default now());

insert into public.sales_lines_fx_adj (id, old_value, old_price, rate, note)
select s.id, s.doc_total_fc, s.price, r.rate, 'SAI ADVANCED USD->INR'
from public.sales_lines s
join (values (252655098::bigint, 94.52), (261162009, 95.70), (261166288, 95.70)) r(doc_num, rate) on r.doc_num = s.doc_num
where s.doc_type = 'OB' and s.card_name ilike 'SAI ADVANCED POWER%'
on conflict (id) do nothing;

update public.sales_lines s
   set doc_total_fc = round(a.old_value * a.rate, 2),
       price        = round(a.old_price * a.rate, 2)
  from public.sales_lines_fx_adj a
 where a.id = s.id and a.note = 'SAI ADVANCED USD->INR';

-- Check
select doc_num, posting_date, cat_code, product_basket, quantity, price, doc_total_fc
from public.sales_lines where doc_type = 'OB' and card_name ilike 'SAI ADVANCED POWER%' order by posting_date;

-- Undo if ever needed:
-- update public.sales_lines s set doc_total_fc = a.old_value, price = a.old_price
--   from public.sales_lines_fx_adj a where a.id = s.id and a.note = 'SAI ADVANCED USD->INR';
