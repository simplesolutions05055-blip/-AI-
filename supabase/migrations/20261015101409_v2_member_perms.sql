alter table public.org_members add column if not exists perms jsonb not null default '{}'::jsonb;;
