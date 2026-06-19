-- ============================================================================
-- WhatsApp AI Agent — Initial schema
-- Spec §15 (tables), §16 (statuses), §20 (security/RLS)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ─── Enums ──────────────────────────────────────────────────────────────────
create type conversation_status as enum ('active', 'waiting_for_user', 'closed');

create type request_status as enum (
  'received', 'collecting_details', 'queued', 'processing', 'quality_check',
  'waiting_for_approval', 'approved', 'rejected', 'regenerating', 'sending',
  'sent', 'needs_attention', 'failed', 'closed'
);

create type job_status as enum ('pending', 'processing', 'completed', 'failed', 'retrying');

create type message_direction as enum ('inbound', 'outbound');

create type output_type as enum ('text', 'image', 'pdf', 'presentation');

create type approval_mode as enum ('manual', 'automatic', 'by_output_type');

create type log_severity as enum ('debug', 'info', 'warning', 'error');

-- ─── profiles ───────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── conversations ──────────────────────────────────────────────────────────
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  whatsapp_from text not null,
  status conversation_status not null default 'active',
  current_request_id uuid,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  closed_at timestamptz
);
create index conversations_whatsapp_from_idx on public.conversations (whatsapp_from);
create index conversations_status_idx on public.conversations (status);

-- ─── requests ───────────────────────────────────────────────────────────────
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  customer_email text,
  output_type output_type,
  structured_brief jsonb,
  approval_mode approval_mode not null default 'by_output_type',
  status request_status not null default 'received',
  attempt_count int not null default 0,
  question_rounds int not null default 0,
  estimated_cost numeric(12, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  closed_at timestamptz
);
create index requests_conversation_idx on public.requests (conversation_id);
create index requests_status_idx on public.requests (status);
create index requests_created_idx on public.requests (created_at desc);

alter table public.conversations
  add constraint conversations_current_request_fk
  foreign key (current_request_id) references public.requests (id) on delete set null;

-- ─── messages ───────────────────────────────────────────────────────────────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  request_id uuid references public.requests (id) on delete set null,
  direction message_direction not null,
  body text,
  media_type text,
  storage_path text,
  twilio_message_sid text unique,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_request_idx on public.messages (request_id);

-- ─── jobs ───────────────────────────────────────────────────────────────────
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  job_type text not null,
  status job_status not null default 'pending',
  attempts int not null default 0,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_status_idx on public.jobs (status, created_at);
create index jobs_request_idx on public.jobs (request_id);

-- ─── outputs ────────────────────────────────────────────────────────────────
create table public.outputs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  version int not null default 1,
  output_type output_type not null,
  text_content text,
  storage_path text,
  mime_type text,
  model_name text,
  prompt_snapshot text,
  qa_result jsonb,
  estimated_cost numeric(12, 4) not null default 0,
  created_at timestamptz not null default now()
);
create index outputs_request_idx on public.outputs (request_id, version desc);

-- ─── settings ───────────────────────────────────────────────────────────────
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value_json jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ─── system_prompt_versions ─────────────────────────────────────────────────
create table public.system_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  is_active boolean not null default false
);
create unique index system_prompt_one_active_idx
  on public.system_prompt_versions (is_active) where is_active;

-- ─── usage_events ───────────────────────────────────────────────────────────
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests (id) on delete set null,
  provider text not null,
  model text,
  input_units numeric(14, 2) not null default 0,
  output_units numeric(14, 2) not null default 0,
  estimated_cost numeric(12, 4) not null default 0,
  created_at timestamptz not null default now()
);
create index usage_events_created_idx on public.usage_events (created_at desc);
create index usage_events_request_idx on public.usage_events (request_id);

-- ─── logs ───────────────────────────────────────────────────────────────────
create table public.logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests (id) on delete set null,
  severity log_severity not null default 'info',
  action text not null,
  message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index logs_created_idx on public.logs (created_at desc);
create index logs_request_idx on public.logs (request_id);
create index logs_severity_idx on public.logs (severity);

-- ─── blocked_numbers ────────────────────────────────────────────────────────
create table public.blocked_numbers (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ─── rate_limit_events (supports §12 rate limiting) ─────────────────────────
create table public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null,
  event_type text not null, -- 'message' | 'generation'
  created_at timestamptz not null default now()
);
create index rate_limit_lookup_idx on public.rate_limit_events (phone_number, event_type, created_at desc);

-- ─── updated_at trigger ─────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger requests_updated_at before update on public.requests
  for each row execute function public.set_updated_at();
create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();
