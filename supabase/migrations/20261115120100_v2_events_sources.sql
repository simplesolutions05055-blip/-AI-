-- the other sources that already land in a table: whatsapp, incidents, browser errors, admin actions + deploys
-- nothing here can raise (v2_ev swallows its own errors; the job cast is guarded by a full UUID pattern)
create or replace function v2_src_event() returns trigger language plpgsql security definer set search_path = public as $$
declare oname text; lvl text; job uuid;
begin
  if tg_table_name = 'v2_wa_msgs' then
    select name into oname from organizations where id = new.org_id;
    perform v2_ev('wa', case when new.dir = 'out' then 'wa.out' else 'wa.in' end, 'info',
      case when new.dir = 'out' then 'הבוט שלח הודעה' else 'הודעת WhatsApp נכנסה' end || ' · ' || coalesce(oname, 'מספר לא רשום'),
      jsonb_build_object('phone_tail', right(new.phone, 4), 'media', new.media is not null), null, new.org_id, null);
  elsif tg_table_name = 'v2_incidents' then
    -- an incident about one production (detail.job) shows on that production's timeline
    job := case when new.detail->>'job' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (new.detail->>'job')::uuid end;
    if tg_op = 'INSERT' then
      lvl := case when new.severity in ('crit','high') then 'error' else 'warn' end;
      perform v2_ev('monitor', 'incident.open', lvl, 'תקלה נפתחה: ' || new.title,
        jsonb_build_object('incident', new.id, 'kind', new.kind, 'severity', new.severity), null, new.org_id, job);
    elsif new.state is distinct from old.state and new.state in ('fixed','resolved') then
      perform v2_ev('monitor', 'incident.close', 'info', 'תקלה נסגרה: ' || new.title,
        jsonb_build_object('incident', new.id, 'kind', new.kind, 'by', new.closed_by), null, new.org_id, job);
    elsif new.state is distinct from old.state and new.state = 'muted' then
      perform v2_ev('monitor', 'incident.mute', 'info', 'תקלה הושתקה: ' || new.title,
        jsonb_build_object('incident', new.id, 'kind', new.kind, 'until', new.mute_until), null, new.org_id, job);
    end if;
  elsif tg_table_name = 'v2_client_errors' then
    perform v2_ev('client', 'client.error', 'warn', 'שגיאה בדפדפן' || coalesce(' · ' || new.route, ''),
      jsonb_build_object('error', v2_ev_mask(new.msg), 'route', new.route, 'ver', new.ver, 'who', new.kind), null, new.org_id, null);
  elsif tg_table_name = 'v2_audit' then
    if new.action = 'deploy' then
      perform v2_ev('admin', 'deploy', 'info', 'גרסה חדשה עלתה', jsonb_build_object('target', left(coalesce(new.target, ''), 200), 'by', new.actor_kind), null, new.org_id, null);
    elsif new.action like 'admin.%' then
      perform v2_ev('admin', 'admin.action', 'info', 'פעולת מנהל: ' || new.action, jsonb_build_object('action', new.action, 'target', left(coalesce(new.target, ''), 200)), null, new.org_id, null);
    end if;
  end if;
  return new;
end $$;
revoke all on function v2_src_event() from public, anon, authenticated;

drop trigger if exists v2_wa_msgs_event on v2_wa_msgs;
create trigger v2_wa_msgs_event after insert on v2_wa_msgs for each row execute function v2_src_event();
drop trigger if exists v2_incidents_event on v2_incidents;
create trigger v2_incidents_event after insert or update of state on v2_incidents for each row execute function v2_src_event();
drop trigger if exists v2_client_errors_event on v2_client_errors;
create trigger v2_client_errors_event after insert on v2_client_errors for each row execute function v2_src_event();
drop trigger if exists v2_audit_event on v2_audit;
create trigger v2_audit_event after insert on v2_audit for each row execute function v2_src_event();
