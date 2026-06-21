-- ============================================================================
-- Dynamic skill selection: each skill declares machine-readable applicability
-- conditions, so the pipeline picks the relevant set per request instead of a
-- hardcoded stage→skills map. Rules always apply unless a condition narrows
-- them (e.g. the public-sector rule only applies to municipality clients).
--
-- applies_to shape (all keys optional; missing/empty = "any"):
--   { "stages": ["brief"], "output_types": ["image"], "client_types": ["municipality"] }
-- Non-rule skills require an explicit stage match to be auto-selected.
-- ============================================================================

alter table public.skills add column applies_to jsonb not null default '{}';

-- Brief / conversation stage
update public.skills set applies_to = '{"stages":["brief"]}'::jsonb
  where key in ('whatsapp-brief-parser', 'agent-brief-intake', 'agent-business-brain');

-- Generation stage
update public.skills set applies_to = '{"stages":["image"]}'::jsonb
  where key = 'social-graphics-engine';
update public.skills set applies_to = '{"stages":["presentation","text"]}'::jsonb
  where key = 'presentation-doc-engine';
update public.skills set applies_to = '{"stages":["image","presentation","text"]}'::jsonb
  where key = 'agent-generation';

-- QA stage (brand-compliance-qa runs both at generation and QA)
update public.skills set applies_to = '{"stages":["image","presentation","text","qa"]}'::jsonb
  where key = 'brand-compliance-qa';
update public.skills set applies_to = '{"stages":["qa"]}'::jsonb
  where key in ('independent-qa-reviewer', 'agent-qa1', 'agent-qa2');

-- The public-sector rule is relevant only to municipality clients.
update public.skills set applies_to = '{"client_types":["municipality"]}'::jsonb
  where key = 'rule-public-sector';
