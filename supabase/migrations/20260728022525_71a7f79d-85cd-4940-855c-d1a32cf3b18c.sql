-- Admin/user-only functions must not be callable by signed-out visitors
REVOKE ALL ON FUNCTION public.admin_list_audit_logs(integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.mark_notifications_read() FROM anon, PUBLIC;

-- Internal trigger helpers should never be callable via the API
REVOKE ALL ON FUNCTION public.prevent_profile_privilege_escalation() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;

-- Plain helper, no elevated privileges, but no need for anon access
REVOKE ALL ON FUNCTION public.is_valid_payment_plan(text, integer, integer, integer) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_payment_plan(text, integer, integer, integer) TO authenticated;

-- Keep only the intentional public API surface reachable without sign-in
GRANT EXECUTE ON FUNCTION public.api_consume(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_quota_status(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_top_words(integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_word_usage_series(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_word_usage(text[], text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';