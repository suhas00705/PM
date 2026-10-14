-- 14-Oct-2026: remove AI Agents & Jarvis. PERMANENT (user confirmed). Safe to re-run.

-- 1) take the two tabs out of every user's allowed tabs (works whether allowed_tabs is text[] or jsonb)
do $$
declare t text;
begin
  select data_type into t from information_schema.columns
   where table_schema = 'public' and table_name = 'user_permissions' and column_name = 'allowed_tabs';
  if t = 'ARRAY' then
    update public.user_permissions
       set allowed_tabs = array_remove(array_remove(allowed_tabs, 'aiagents'), 'jarvis')
     where allowed_tabs && array['aiagents','jarvis'];
  elsif t in ('jsonb','json') then
    update public.user_permissions
       set allowed_tabs = (select coalesce(jsonb_agg(x), '[]'::jsonb)
                           from jsonb_array_elements_text(allowed_tabs::jsonb) x
                           where x not in ('aiagents','jarvis'))
     where allowed_tabs::jsonb ?| array['aiagents','jarvis'];
  end if;
end $$;

-- 2) delete the 8 AI Agents / Jarvis / old-login tables
drop table if exists public."PM_Desk" cascade;
drop table if exists public.agent_logs cascade;
drop table if exists public.builders_knowledge cascade;
drop table if exists public.dashboard_data cascade;
drop table if exists public.industry_leads cascade;
drop table if exists public.portal_authorized_users cascade;
drop table if exists public.portal_sessions cascade;
drop table if exists public.real_estate_projects cascade;

notify pgrst, 'reload schema';

-- check: should list none of the 8 tables, and no user with aiagents / jarvis
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('PM_Desk','agent_logs','builders_knowledge','dashboard_data','industry_leads','portal_authorized_users','portal_sessions','real_estate_projects')
union all
select 'user still has AI tab: ' || email from public.user_permissions where allowed_tabs::text ~ 'aiagents|jarvis';
