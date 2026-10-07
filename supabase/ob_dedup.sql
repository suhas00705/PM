-- =====================================================================
-- OB de-duplication: HO (ELM) order re-raised as a back-to-back OA at a unit (AHM, Gujarat)
-- ---------------------------------------------------------------------
-- In the SAP Excel OB history the same customer order appears twice:
--   1) the HO OA (company = ELM)  and
--   2) the unit OA raised to execute it: company = AHM (Gujarat, series 26176…/26177…/25000…)
--      or company = Coimbatore_Live (series 262762…/262763…, Panel Meters).
-- Twin rule (one-to-one):
--   same customer (letters/digits only, upper-case), same cat_code, same quantity,
--   |DocTotalFC difference| <= 1, and the unit OA dated between HO date - 3 days and HO date + 60 days.
-- The unit (AHM / Coimbatore_Live) line is the duplicate. It is MOVED to sales_lines_ob_dups (fully reversible)
-- and removed from sales_lines, so every dashboard (Channel Partners, PM Cumulative Tracking,
-- Growth, Product series, OEM) stops double counting without any change to the RPCs.
-- Only source = 'excel' OB rows are touched. Zoho OB (from 29-Sep-2026) holds only the HO order.
-- Safe to run again (e.g. after re-importing Excel history): it only moves new twins.
-- =====================================================================

create table if not exists public.sales_lines_ob_dups (like public.sales_lines);
-- (generated columns become plain columns in the backup copy)
alter table public.sales_lines_ob_dups add column if not exists dup_of_id     bigint;   -- sales_lines.id of the HO twin
alter table public.sales_lines_ob_dups add column if not exists dup_of_docnum bigint;   -- HO OA number
alter table public.sales_lines_ob_dups add column if not exists moved_at      timestamptz default now();
create unique index if not exists sales_lines_ob_dups_id on public.sales_lines_ob_dups(id);

create or replace function public.ob_dedup(p_dry_run boolean default false)
returns table(fy int, basket text, lines bigint, value_lakh numeric)
language plpgsql security definer as $$
declare n int;
begin
  create temp table if not exists _pairs(id_a bigint primary key, id_e bigint unique) on commit drop;
  truncate _pairs;

  create temp table if not exists _cand(id_e bigint, id_a bigint, pd_a date) on commit drop;
  truncate _cand;
  insert into _cand
    select e.id, a.id, a.posting_date
    from sales_lines e
    join sales_lines a
      on  a.doc_type = 'OB' and a.source = 'excel' and a.company in ('AHM', 'Coimbatore_Live')
      and upper(regexp_replace(coalesce(a.card_name,''), '[^A-Za-z0-9]', '', 'g'))
        = upper(regexp_replace(coalesce(e.card_name,''), '[^A-Za-z0-9]', '', 'g'))
      and a.cat_code = e.cat_code
      and a.quantity = e.quantity
      and abs(coalesce(a.doc_total_fc,0) - coalesce(e.doc_total_fc,0)) <= 1
      and a.posting_date between e.posting_date - 3 and e.posting_date + 60
    where e.doc_type = 'OB' and e.source = 'excel' and e.company = 'ELM'
      and coalesce(e.card_name,'') <> ''
      and not exists (select 1 from sales_lines_ob_dups d where d.dup_of_id = e.id);  -- HO line already paired

  -- greedy one-to-one matching: each pass takes, for every HO line, its earliest free unit line,
  -- and resolves clashes in favour of the lowest HO id; repeat until nothing new matches.
  loop
    insert into _pairs(id_a, id_e)
    select id_a, id_e from (
      select id_a, id_e, row_number() over (partition by id_a order by id_e) as ra
      from (
        select c.id_a, c.id_e,
               row_number() over (partition by c.id_e order by c.pd_a, c.id_a) as re
        from _cand c
        where not exists (select 1 from _pairs p where p.id_a = c.id_a or p.id_e = c.id_e)
      ) x where re = 1
    ) y where ra = 1;
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;

  return query
    select s.fy_start, coalesce(s.product_basket,'(blank)'), count(*), round(sum(coalesce(s.doc_total_fc,0))/1e5, 1)
    from _pairs p join sales_lines s on s.id = p.id_a
    group by 1, 2 order by 1, 4 desc;

  if not p_dry_run then
    insert into sales_lines_ob_dups
      select s.*, p.id_e, e.doc_num, now()
      from _pairs p
      join sales_lines s on s.id = p.id_a
      join sales_lines e on e.id = p.id_e
    on conflict (id) do nothing;
    delete from sales_lines s using _pairs p where s.id = p.id_a;
  end if;
end $$;

-- UNDO: put every moved unit line back into sales_lines (and empty the backup)
create or replace function public.ob_dedup_restore()
returns bigint language plpgsql security definer as $$
declare cols text; n bigint;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'sales_lines' and is_generated = 'NEVER';
  execute format('insert into sales_lines (%s) select %s from sales_lines_ob_dups on conflict do nothing', cols, cols);
  get diagnostics n = row_count;
  delete from sales_lines_ob_dups;
  return n;
end $$;

-- ---------------- RUN (in the Supabase SQL editor) ----------------
-- 1) preview only:   select * from ob_dedup(true);
-- 2) apply:          select * from ob_dedup(false);
-- 3) check:          select fy_start, product_basket, count(*), round(sum(doc_total_fc)/1e5,1) as lakh
--                    from sales_lines_ob_dups group by 1,2 order by 1,4 desc;
-- Undo if ever needed: select ob_dedup_restore();
revoke all on function public.ob_dedup(boolean) from anon, authenticated;
revoke all on function public.ob_dedup_restore() from anon, authenticated;
