
create or replace function v2_job_incident() returns trigger language plpgsql security definer set search_path = public as $$
declare oname text; kname text;
begin
  if new.state = 'error' and coalesce(old.state,'') <> 'error' and coalesce(new.error,'') not like 'quota:%' then
    select name into oname from organizations where id = new.org_id;
    if coalesce(oname,'') like 'qa-%' then return new; end if;
    kname := case new.kind when 'graphic' then 'גרפיקה' when 'video' then 'סרטון' when 'vscan' then 'סריקת סרטון' when 'deck' then 'מצגת' when 'doc' then 'מסמך' else new.kind end;
    insert into v2_incidents(kind, severity, title, org_id, detail)
    values ('job_fail', 'high', 'יצירת ' || kname || ' נכשלה · ' || coalesce(oname,'לקוח'), new.org_id,
      jsonb_build_object('job', new.id, 'job_kind', new.kind, 'org', oname, 'ui_id', new.ui_id, 'src', new.src,
        'checked', 'עבודת יצירה של לקוח הסתיימה בשגיאה',
        'note', 'שלב: ' || coalesce(new.step,'-') || ' · שגיאה: ' || left(coalesce(new.error,'-'), 300) || ' · ניסיונות: ' || coalesce(new.tries,0),
        'cause', 'ספק AI שלא ענה, זמן ריצה ארוך מדי או קלט חריג',
        'fix', 'החזרת העבודה לתור עם ניסיון חוזר'));
  elsif new.state = 'done' and old.state is distinct from 'done' then
    update v2_incidents set state = 'fixed', closed_at = now(), closed_by = 'מערכת',
      fix_log = fix_log || jsonb_build_array(jsonb_build_object('at', now(), 'by', 'מערכת', 'ok', true, 'text', 'העבודה הושלמה בניסיון חוזר'))
    where kind = 'job_fail' and state in ('open','muted') and detail->>'job' = new.id::text;
  end if;
  return new;
end $$;
revoke all on function v2_job_incident() from public, anon, authenticated;
drop trigger if exists v2_jobs_incident on v2_jobs;
create trigger v2_jobs_incident after update of state on v2_jobs for each row execute function v2_job_incident();

create table if not exists v2_client_errors (
  id bigserial primary key,
  org_id uuid, member_id uuid, kind text,
  msg text, src text, line int, stack text, route text, ua text, ver text,
  created_at timestamptz not null default now()
);
create index if not exists v2_client_errors_at on v2_client_errors(created_at desc);
alter table v2_client_errors enable row level security;
;
