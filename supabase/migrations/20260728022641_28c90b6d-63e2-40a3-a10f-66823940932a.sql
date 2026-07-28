REVOKE ALL ON FUNCTION public.api_consume(text, integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.api_quota_status(text, integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.record_word_usage(text[], text) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.public_top_words(integer, integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.public_word_usage_series(integer) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_word_usage(text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_top_words(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_word_usage_series(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';