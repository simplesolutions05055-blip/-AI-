-- ============================================================================
-- Mark which components are not yet implemented in the system, so the Skills
-- screen shows it clearly (e.g. Meta publishing).
-- ============================================================================

alter table public.skills
  add column implemented boolean not null default true;

-- Not yet built: Meta Graph API publishing and its agent.
update public.skills set implemented = false
  where key in ('publishing-rules-meta', 'agent-publishing');
