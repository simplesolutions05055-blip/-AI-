-- v2 gateway tables are reached only through the v2-api edge function (service role).
-- Close them to the public REST API: RLS on with no policies + no grants for anon/authenticated.
alter table public.api_tokens enable row level security;
alter table public.admin_tokens enable row level security;
alter table public.admin_users enable row level security;
alter table public.org_members enable row level security;
alter table public.item_approvals enable row level security;
revoke all on table public.api_tokens, public.admin_tokens, public.admin_users, public.org_members, public.item_approvals, public.org_state, public.admin_state, public.access_links from anon, authenticated;;
