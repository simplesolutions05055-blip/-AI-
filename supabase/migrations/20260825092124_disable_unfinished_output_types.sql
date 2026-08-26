insert into public.settings (key, value_json)
values ('output_permissions', '{}'::jsonb)
on conflict (key) do nothing;

update public.settings
set value_json = jsonb_set(
  jsonb_set(
    coalesce(value_json, '{}'::jsonb),
    '{presentation}',
    '{"admin": false, "user": false}'::jsonb,
    true
  ),
  '{pdf}',
  '{"admin": false, "user": false}'::jsonb,
  true
)
where key = 'output_permissions';
