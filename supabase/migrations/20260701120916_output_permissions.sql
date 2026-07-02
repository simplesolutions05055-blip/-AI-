insert into public.settings (key, value_json)
values (
  'output_permissions',
  '{
    "image": { "admin": true, "user": true },
    "text": { "admin": true, "user": true },
    "presentation": { "admin": true, "user": true },
    "pdf": { "admin": true, "user": true },
    "quote": { "admin": true, "user": true }
  }'::jsonb
)
on conflict (key) do nothing;

create policy "settings_public_output_permissions_select" on public.settings
  for select to authenticated
  using (key = 'output_permissions');
