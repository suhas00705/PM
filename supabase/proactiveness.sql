-- PART 7 : table for OA <-> Zoho deal link (lead proactiveness). Safe to re-run.
create table if not exists public.oa_deal_link (
  so_id text primary key,
  sap_oa_no text,
  oa_date date,
  status text,
  subject text,
  account text,
  region text,
  owner text,
  grand_total numeric,
  deal_id text,
  deal_name text,
  deal_created timestamptz,
  deal_closing date,
  deal_source text,
  modified_time timestamptz,
  synced_at timestamptz default now()
);
create index if not exists oa_deal_link_date on public.oa_deal_link (oa_date);
create index if not exists oa_deal_link_oa on public.oa_deal_link (sap_oa_no);
grant select, insert, update on public.oa_deal_link to anon, authenticated;
-- PART 8 : proactiveness functions (read-only)
-- Every approved OA of the FY, with its value from the portal OB data,
-- the target region and how many days the Zoho deal existed before the OA.
create or replace function public.ptt_oa_base(p_cy int)
returns table(so_id text, oa text, oa_date date, m int, account text,
              deal_name text, deal_id text, owner text, rg text,
              deal_created date, days int, bucket int, v numeric,
              source text)
language sql stable security definer set search_path = public as $$
  with o as materialized (
    select * from oa_deal_link
    where status ilike 'approved'
      and oa_date between make_date(p_cy, 4, 1) and make_date(p_cy + 1, 3, 31)),
  sv as materialized (
    select o.so_id, sum(s.doc_total_fc) / 1e5 as v
    from o join sales_lines s
      on s.doc_type = 'OB'
     and (s.doc_num = case when o.sap_oa_no ~ '^\d+$'
                           then o.sap_oa_no::bigint end
          or (s.doc_num is null and s.zoho_parent_id = o.so_id))
    group by 1)
  select o.so_id, o.sap_oa_no, o.oa_date,
         ((extract(month from o.oa_date)::int + 8) % 12),
         o.account, o.deal_name, o.deal_id, o.owner,
         ptt_region(o.region, o.owner), o.deal_created::date,
         (o.oa_date - o.deal_created::date),
         case when o.deal_id is null then 0
              when o.oa_date - o.deal_created::date <= 0 then 1
              when o.oa_date - o.deal_created::date <= 7 then 2
              when o.oa_date - o.deal_created::date <= 30 then 3
              when o.oa_date - o.deal_created::date <= 90 then 4
              else 5 end,
         round(coalesce(sv.v, o.grand_total / 1.18e5), 2),
         o.deal_source
  from o left join sv on sv.so_id = o.so_id;
$$;

-- Summary: [region, owner, bucket, OAs, value L] for the chosen months
create or replace function public.ptt_proactive(p_cy int, p_months int[])
returns jsonb language sql stable security definer
set search_path = public as $$
  select jsonb_build_object(
    'asof', (select max(synced_at) from oa_deal_link),
    -- [region, owner, bucket, calendar month, OAs, value L]
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(rg, owner, bucket,
               mon, n, v)), '[]')
             from (select rg, owner, bucket, (b.m + 3) % 12 + 1 mon,
                     count(*) n, round(sum(v), 2) v
                   from ptt_oa_base(p_cy) b
                   where coalesce(cardinality(p_months), 0) = 0
                      or (b.m + 3) % 12 + 1 = any(p_months)
                   group by 1, 2, 3, 4) t));
$$;

-- OA list for one region (and optional owner / bucket)
create or replace function public.ptt_proactive_list(p_cy int,
  p_months int[], p_rg text, p_owner text, p_bucket int)
returns jsonb language sql stable security definer
set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(oa, oa_date, account,
           deal_name, owner, deal_created, days, bucket, v, so_id, deal_id,
           source) order by v desc), '[]')
  from (select * from ptt_oa_base(p_cy) b
        where (p_rg is null or b.rg = p_rg)
          and (p_owner is null or b.owner = p_owner)
          and (p_bucket is null or b.bucket = p_bucket)
          and (coalesce(cardinality(p_months), 0) = 0
               or (b.m + 3) % 12 + 1 = any(p_months))
        order by v desc limit 400) t;
$$;

grant execute on function public.ptt_proactive(int, int[])
  to anon, authenticated;
grant execute on function
  public.ptt_proactive_list(int, int[], text, text, int)
  to anon, authenticated;
notify pgrst, 'reload schema';
-- PART 9 : converted leads (lead -> deal link) so the timeline starts at
-- lead creation. Safe to re-run.
create table if not exists public.lead_conv (
  lead_id text primary key,
  deal_id text,
  lead_created timestamptz,
  converted_at timestamptz,
  lead_source text,
  owner text,
  modified_time timestamptz,
  synced_at timestamptz default now()
);
create index if not exists lead_conv_deal on public.lead_conv (deal_id);
grant select, insert, update on public.lead_conv to anon, authenticated;
-- PART 10 : timeline = lead created (or deal created when there was no lead)
-- -> converted to potential -> OA. Replaces ptt_oa_base / ptt_proactive_list.
drop function if exists public.ptt_oa_base(int);
create function public.ptt_oa_base(p_cy int)
returns table(so_id text, oa text, oa_date date, m int, account text,
              deal_name text, deal_id text, owner text, rg text,
              deal_created date, days int, bucket int, v numeric,
              source text, lead_created date, conv_days int)
language sql stable security definer set search_path = public as $$
  with o as materialized (
    select * from oa_deal_link
    where status ilike 'approved'
      and coalesce(account, '') !~* '(B\s*&\s*E\s+ELECTRIC|TEST\s+DUMMY)'
      and oa_date between make_date(p_cy, 4, 1) and make_date(p_cy + 1, 3, 31)),
  lc as materialized (
    select deal_id, min(lead_created) as lead_created,
           min(converted_at) as converted_at
    from lead_conv where deal_id is not null group by 1),
  sv as materialized (
    select o.so_id, sum(s.doc_total_fc) / 1e5 as v
    from o join sales_lines s
      on s.doc_type = 'OB'
     and (s.doc_num = case when o.sap_oa_no ~ '^\d+$'
                           then o.sap_oa_no::bigint end
          or (s.doc_num is null and s.zoho_parent_id = o.so_id))
    group by 1),
  x as (
    select o.*, lc.lead_created as lcr, lc.converted_at as lconv,
           -- start of the journey: the lead, else the deal itself
           least(lc.lead_created, o.deal_created)::date as st
    from o left join lc on lc.deal_id = o.deal_id)
  select x.so_id, x.sap_oa_no, x.oa_date,
         ((extract(month from x.oa_date)::int + 8) % 12),
         x.account, x.deal_name, x.deal_id, x.owner,
         ptt_region(x.region, x.owner), x.deal_created::date,
         (x.oa_date - x.st),
         case when x.deal_id is null then 0
              when x.oa_date - x.st <= 0 then 1
              when x.oa_date - x.st <= 7 then 2
              when x.oa_date - x.st <= 30 then 3
              when x.oa_date - x.st <= 90 then 4
              else 5 end,
         round(coalesce(sv.v, x.grand_total / 1.18e5), 2),
         x.deal_source, x.lcr::date,
         case when x.lcr is not null
              then (coalesce(x.lconv, x.deal_created)::date - x.lcr::date)
         end
  from x left join sv on sv.so_id = x.so_id;
$$;

create or replace function public.ptt_proactive_list(p_cy int,
  p_months int[], p_rg text, p_owner text, p_bucket int)
returns jsonb language sql stable security definer
set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(oa, oa_date, account,
           deal_name, owner, deal_created, days, bucket, v, so_id, deal_id,
           source, lead_created, conv_days) order by v desc), '[]')
  from (select * from ptt_oa_base(p_cy) b
        where (p_rg is null or b.rg = p_rg)
          and (p_owner is null or b.owner = p_owner)
          and (p_bucket is null or b.bucket = p_bucket)
          and (coalesce(cardinality(p_months), 0) = 0
               or (b.m + 3) % 12 + 1 = any(p_months))
        order by v desc limit 400) t;
$$;
grant execute on function
  public.ptt_proactive_list(int, int[], text, text, int)
  to anon, authenticated;
notify pgrst, 'reload schema';
