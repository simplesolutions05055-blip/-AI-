-- Allow PrimeOS to switch a brand's social publishing connection from direct
-- Meta Graph API credentials to an AutoPost OAuth token without changing the
-- existing scheduling and target-selection contracts.

alter table public.meta_connections
  add column if not exists provider text not null default 'meta';

alter table public.meta_connections
  drop constraint if exists meta_connections_provider_check;

alter table public.meta_connections
  add constraint meta_connections_provider_check
  check (provider in ('meta', 'autopost'));

comment on column public.meta_connections.provider is
  'Publishing backend: direct Meta Graph API or AutoPost Public API';
