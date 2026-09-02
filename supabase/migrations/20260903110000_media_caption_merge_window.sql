-- ============================================================================
-- Merge window for a caption that arrives as its own message
-- ----------------------------------------------------------------------------
-- Smart Send does not render the caption of a media message (last_message
-- arrives as the literal "{{last_message}}"), so "photo + text", which WhatsApp
-- shows as ONE message, reaches us as two halves. The photo lands first with no
-- words; the caption follows as its own inbound message seconds later.
--
-- media_caption_seconds is how long a photo with no words waits before the bot
-- asks "what should I make with it?". A caption that lands inside the window
-- joins the same open request and starts the work, and the question is never
-- asked. Only a photo that really came alone gets it.
-- ============================================================================
update public.settings
set value_json = value_json || jsonb_build_object('media_caption_seconds', 25)
where key = 'message_merge';

insert into public.settings (key, value_json)
select 'message_merge', jsonb_build_object('debounce_seconds', 6, 'media_caption_seconds', 25)
where not exists (select 1 from public.settings where key = 'message_merge');
