
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text;

INSERT INTO public.organizations (id, name, plan, org_type, status, contact_name, contact_email)
VALUES ('11111111-0000-0000-0000-000000000001', 'עיריית דמו', 'extended', 'municipality', 'active', 'מאור כהן', 'maor@demo.primeos.co.il')
ON CONFLICT (id) DO UPDATE SET plan='extended', org_type='municipality', contact_name='מאור כהן';

INSERT INTO public.org_members (id, org_id, name, email, role)
VALUES ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'מאור כהן', 'maor@demo.primeos.co.il', 'owner')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.api_tokens (token, org_id, member_id)
VALUES ('demo-primeos-2026', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001')
ON CONFLICT (token) DO NOTHING;

INSERT INTO public.departments (id, org_id, name)
VALUES
  ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'דוברות'),
  ('33333333-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'חינוך'),
  ('33333333-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'רווחה')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS hashtags text[] NOT NULL DEFAULT '{}';

INSERT INTO public.content_items (id, org_id, department_id, source, type, method, title, body, cta, hashtags, html, status)
VALUES
  ('44444444-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'web', 'graphic', 'free_text', 'ברכת ראש השנה', 'שנה טובה ומתוקה לכל תושבי העיר!', 'לפרטים: עיריית דמו', ARRAY['#ראשהשנה','#שנהטובה'], '<div style="background:#1a56db;color:#fff;padding:32px;border-radius:12px;font-family:Heebo,sans-serif;text-align:center;"><h2>שנה טובה!</h2><p>ברכות מעיריית דמו</p></div>', 'approved'),
  ('44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000002', 'web', 'graphic', 'free_text', 'פתיחת שנת הלימודים', 'ברוכים הבאים לשנת הלימודים החדשה!', 'לרישום: 04-000-0000', ARRAY['#חינוך','#פתיחתשנה'], '<div style="background:#059669;color:#fff;padding:32px;border-radius:12px;font-family:Heebo,sans-serif;text-align:center;"><h2>שנת לימודים טובה!</h2><p>מחלקת החינוך</p></div>', 'pending_approval'),
  ('44444444-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000003', 'web', 'document', 'free_text', 'עדכון שירותי הרווחה', 'מחלקת הרווחה מרחיבה את שירותיה לקשישים ומשפחות זכאיות.', 'לפניות: 04-000-0001', ARRAY['#רווחה','#קהילה'], '', 'draft')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.item_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  status text NOT NULL,
  actor_id uuid,
  note text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.item_approvals DISABLE ROW LEVEL SECURITY;

INSERT INTO public.admin_users (id, name, email)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'מאור - מנהל', 'admin@primeos.co.il')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_tokens (token, admin_id)
VALUES ('maor-primeos-2026', 'aaaaaaaa-0000-0000-0000-000000000001')
ON CONFLICT (token) DO NOTHING;
;
