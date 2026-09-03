-- Remove settings rows whose only readers and writers are gone.
--
--   whatsapp_window_template           - Twilio Content API 24h-window template,
--                                        seeded by 20260620100000. Twilio is out.
--   whatsapp_interactive_content_cache - cache of Twilio Content SIDs, written by
--                                        the Twilio branch of worker.sendOut.
--   greenapi_instance_state            - written by _shared/instanceState.ts,
--                                        deleted with the GREEN-API transport.
--
-- Verified before writing this: a repo-wide search finds no reader and no writer
-- for any of the three. The admin Settings page used to skip them on load; that
-- guard is gone too, so without this they would be re-upserted unchanged on every
-- admin save.

delete from public.settings
 where key in (
   'whatsapp_window_template',
   'whatsapp_interactive_content_cache',
   'greenapi_instance_state'
 );
