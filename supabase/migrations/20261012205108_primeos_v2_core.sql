
-- api_tokens
CREATE TABLE IF NOT EXISTS public.api_tokens (
  token text PRIMARY KEY,
  org_id uuid,
  member_id uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.api_tokens DISABLE ROW LEVEL SECURITY;

-- admin_users
CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.admin_users DISABLE ROW LEVEL SECURITY;

-- admin_tokens
CREATE TABLE IF NOT EXISTS public.admin_tokens (
  token text PRIMARY KEY,
  admin_id uuid REFERENCES public.admin_users(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.admin_tokens DISABLE ROW LEVEL SECURITY;

-- org_members (mirrors members but with plan-aware fields)
CREATE TABLE IF NOT EXISTS public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL,
  email text,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.org_members DISABLE ROW LEVEL SECURITY;
;
