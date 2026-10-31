-- Region Tracking: won potentials without OA – v2 (31-Oct-2026). Safe to re-run.
-- Many OAs are raised in Zoho WITHOUT linking the Potential (Hyderabad Oct: 39 of 83 OAs).
-- A won potential now also counts as "has OA" when an unlinked OA exists for the SAME ACCOUNT
-- dated 45 days before … 60 days after its closing date. Those come back with flag 1
-- (shown separately as "OA not linked in Zoho"); flag 0 = really no OA.

-- PART 1 : account name key (upper case, no punctuation, no Pvt / Ltd / India …)
create or replace function public.rt_acc_key(t text)
returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(
    regexp_replace(upper(coalesce(t, '')),
      '[^A-Z0-9]+', ' ', 'g'),
    '\m(PVT|PRIVATE|LTD|LIMITED|LLP|INDIA|CO|COMPANY|CORPORATION|CORP|THE|M S|MS)\M',
      ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

-- PART 2 : the list
create or replace function public.rt_noa(
  p_cy int, p_rg text)
returns jsonb language sql stable
security definer set search_path = public as $$
with w as (
  select d.id, d.name, d.account, d.owner,
         d.ptype, d.amount, d.closing,
         rt_acc_key(d.account) as ak
  from ptt_deals_base() d
  where d.sgrp = 'Won' and d.rg = p_rg
    and d.closing >= make_date(p_cy, 4, 1)
    and d.closing < make_date(p_cy + 1, 4, 1)),
o as (
  select distinct deal_id from oa_deal_link
  where deal_id is not null
    and coalesce(status, '') not ilike 'cancel%'),
u as (
  select rt_acc_key(account) as ak,
         left(oa_date::text, 10)::date as od
  from oa_deal_link
  where deal_id is null and oa_date is not null
    and coalesce(status, '') not ilike 'cancel%')
select jsonb_build_object('rows',
  coalesce(jsonb_agg(jsonb_build_array(
    w.id, w.name, p.project_name, w.account,
    w.owner, w.ptype, round(w.amount / 1e5, 2),
    w.closing,
    case when w.ak <> '' and exists (
      select 1 from u where u.ak = w.ak
        and u.od between w.closing - 45
                     and w.closing + 60)
    then 1 else 0 end) order by w.closing desc),
  '[]'::jsonb))
from w
left join potentials_cache p on p.id::text = w.id
where not exists
  (select 1 from o where o.deal_id = w.id);
$$;
grant execute on function public.rt_noa(int, text)
  to anon, authenticated;
notify pgrst, 'reload schema';
