-- Region fix: invoices use the customer's U_region (same as Order Booking), so no repeated region names
-- in Channel Partner Analytics or PM Cumulative Tracking. The original invoice SE region stays in column se_reg.

-- 1. Indexes so the lookups are quick
create index if not exists sales_lines_ob_card_idx   on public.sales_lines (card_name) where doc_type = 'OB';
create index if not exists sales_lines_ob_region_idx on public.sales_lines (upper(trim(region))) where doc_type = 'OB';

-- 2. One-time fix of existing invoice rows
with ob_cust as (
       select card_name, region, sum(abs(coalesce(doc_total_fc, 0))) as v
       from public.sales_lines where doc_type = 'OB' and region is not null and card_name is not null
       group by 1, 2),
     cust_region as (
       select distinct on (card_name) card_name, region from ob_cust order by card_name, v desc),
     spelling as (
       select distinct on (upper(trim(region))) upper(trim(region)) as k, region
       from public.sales_lines where doc_type = 'OB' and region is not null
       group by region order by upper(trim(region)), count(*) desc),
     fix as (
       select s.id, coalesce(c.region, sp.region, s.region) as new_region
       from public.sales_lines s
       left join cust_region c on c.card_name = s.card_name
       left join spelling sp   on sp.k = upper(trim(coalesce(s.se_reg, s.region)))
       where s.doc_type <> 'OB')
update public.sales_lines s set region = f.new_region
from fix f where f.id = s.id and s.region is distinct from f.new_region;

-- 3. Keep it right for every new invoice the daily Zoho sync adds
create or replace function public.sales_lines_set_u_region()
returns trigger language plpgsql as $$
begin
  if new.doc_type <> 'OB' then
    new.region := coalesce(
      (select region from public.sales_lines
        where doc_type = 'OB' and card_name = new.card_name and region is not null
        group by region order by sum(abs(coalesce(doc_total_fc, 0))) desc limit 1),
      (select region from public.sales_lines
        where doc_type = 'OB' and upper(trim(region)) = upper(trim(coalesce(new.se_reg, new.region))) limit 1),
      new.region);
  end if;
  return new;
end;
$$;
drop trigger if exists sales_lines_u_region on public.sales_lines;
create trigger sales_lines_u_region before insert or update on public.sales_lines
  for each row execute function public.sales_lines_set_u_region();

-- 4. Check: should list each region once
select cp_filter_options('INV')->'regions' as invoice_regions;
