-- Remove the translation-history feature entirely. The client no longer logs
-- translations or reads history, so drop the RPC and the backing table.
-- DROP TABLE cascades to its RLS policies and indexes; this deletes all
-- previously stored history rows.

DROP FUNCTION IF EXISTS public.log_translation(text, text, text);
DROP TABLE IF EXISTS public.translation_history;
