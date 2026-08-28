-- Public AI health flag.
--
-- `provider_outage_state` stays admin-only: it carries the provider's own
-- wording (account + billing state). This row is its content-free mirror —
-- "AI is degraded, since <when>" — and is the only thing the browser reads to
-- disable AI entry points and show the outage banner.
insert into public.settings (key, value_json)
values ('ai_status', '{"degraded": false, "since": null}'::jsonb)
on conflict (key) do nothing;

create policy "settings_public_ai_status_select" on public.settings
  for select to anon, authenticated
  using (key = 'ai_status');
