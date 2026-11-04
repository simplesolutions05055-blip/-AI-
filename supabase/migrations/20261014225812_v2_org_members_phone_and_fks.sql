alter table public.org_members add column if not exists phone text;
create index if not exists org_members_org_idx on public.org_members(org_id);
create index if not exists api_tokens_member_idx on public.api_tokens(member_id);
create index if not exists api_tokens_org_idx on public.api_tokens(org_id);;
