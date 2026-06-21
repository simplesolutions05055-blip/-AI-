-- ============================================================================
-- Rule 4 (two QA layers): split the single 'qa' stage into two independent
-- layers so each runs in its own context with its own skill set.
--   qa1 — brand-compliance-qa (technical/branding self-check)
--   qa2 — independent-qa-reviewer (holistic, fresh-eyes review)
-- ============================================================================

-- QA #1 — technical/branding. brand-compliance-qa also runs during generation.
update public.skills set applies_to = '{"stages":["image","presentation","text","qa1"]}'::jsonb
  where key = 'brand-compliance-qa';
update public.skills set applies_to = '{"stages":["qa1"]}'::jsonb
  where key = 'agent-qa1';

-- QA #2 — independent holistic review.
update public.skills set applies_to = '{"stages":["qa2"]}'::jsonb
  where key in ('independent-qa-reviewer', 'agent-qa2');
