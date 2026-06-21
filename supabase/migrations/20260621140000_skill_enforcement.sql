-- ============================================================================
-- Mark how each skill is enforced, so the admin knows whether editing its text
-- actually changes behaviour:
--   prompt — text-only: the content is injected as instructions; edits apply live
--   code   — behaviour lives in code/DB; the text is documentation only
--   mixed  — text steers the model AND a code guardrail enforces the hard part
-- ============================================================================

alter table public.skills
  add column enforcement text not null default 'prompt'
  check (enforcement in ('prompt', 'code', 'mixed'));

-- ── code: editing the text does NOT change behaviour (needs a developer) ──────
update public.skills set enforcement = 'code' where key in (
  'business-onboarding',          -- entered via the Branding screen, not injected
  'approval-email-composer',      -- email/approval flow is code (Resend)
  'publishing-rules-meta',        -- Meta publishing (not yet implemented)
  'cloud-archive-structurer',     -- storage structure is code
  'revision-to-rule-converter',   -- extraction prompt lives in code (openai.ts)
  'agent-business-brain',         -- DB access layer
  'agent-routing',                -- skill selection / routing is code
  'agent-approval-orchestrator',
  'agent-publishing',
  'agent-archive',
  'agent-learning',
  'rule-approval',                -- approval gate (code)
  'rule-two-layers',              -- two-layer QA wiring (code)
  'rule-consistency',             -- template lock (code + DB)
  'rule-no-delete',               -- enforced by tool design (no delete exists)
  'rule-tenant-isolation',        -- brand_id scoping / RLS
  'rule-timezone',                -- Asia/Jerusalem in code
  'rule-round-cap'                -- revision_round counter (code)
);

-- ── mixed: text steers the model, but a code guardrail enforces the hard part ─
update public.skills set enforcement = 'mixed' where key in (
  'whatsapp-brief-parser',        -- injected text + required-field/brand gate
  'brand-compliance-qa',          -- injected checklist + two-layer wiring
  'independent-qa-reviewer',      -- injected checklist + two-layer wiring
  'agent-brief-intake',           -- injected text + gate
  'agent-qa1',
  'agent-qa2',
  'rule-branding',                -- injected brand kit + code gate
  'rule-no-fabrication',          -- injected text + code gate
  'rule-public-sector'            -- skill text is doc; trigger+block are code
);

-- everything else (graphics/presentation engines, agent-generation) stays
-- 'prompt' — their content is injected and edits apply live.
