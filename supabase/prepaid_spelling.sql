-- 26-Nov-2026: Prepaid/Smart accepts basket spelling
-- variants ("Prepaid and Smart Meters", "prepaid &
-- smart meter", extra spaces). Same as before otherwise.
create or replace function public.prd_fam(
  p_bk text, p_gov boolean default false,
  p_ext boolean default false)
returns text language sql immutable as $$
  select case
    when b in ('Panel Meters', 'High End MFM', 'Nano VIP',
               'Power Quality') then 'Panel Meters'
    when p_ext and b in ('Hi End MFM Series',
               'Mid Range MFM', 'iELR', 'Din Meters',
               'APFC', 'GMD')
      then 'Panel Meters'
    when b = 'ACCL' or (p_ext and b like 'ACCL%')
      then 'ACCL'
    when b = 'Transfer Switch' then 'ATES'
    when lower(b) in ('prepaid', 'smart meters',
                      'smart meter')
      or lower(b) ~ '^prepaid ?(&|and|/) ?smart meters?$'
      then case when p_gov then 'Prepaid/Smart – Govt'
                else 'Prepaid/Smart' end
    when b = 'SWITCHGEAR' then 'LVS'
    when b = 'FDP' then 'FDP'
    when b = 'OEM' then 'OEM'
    else 'Other' end
  from (select regexp_replace(trim(coalesce(p_bk, '')),
                 '\s+', ' ', 'g') as b) x;
$$;
