-- ════════════════════════ Backend hardening (defense in depth) ════════════════════════
-- No functional change for legitimate users: every real path uses either an RLS
-- policy or a SECURITY DEFINER RPC that runs as the table owner. This migration
-- strips redundant, over-broad privileges so that no single future
-- misconfiguration (e.g. an accidentally dropped RLS policy) can expose the
-- backend or let a normal user escalate.

-- 1) Drop the unused community aggregator (the member ticker was removed from
--    the UI). It exposed every member's display name to any signed-in user, so
--    removing it also closes an information leak.
DROP FUNCTION IF EXISTS public.community_ticker();

-- 2) Lock down function execution. Postgres grants EXECUTE to PUBLIC by default,
--    which currently lets the anon role even *call* admin RPCs (they are saved
--    only by their internal has_role() check). Remove that blanket access and
--    re-grant execution explicitly to the roles that need it.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)                                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.try_consume_translation(integer)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_topup_code(text)                                               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_translation(text, text, text)                                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text)                                              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_premium(uuid, integer)                                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_premium(uuid)                                            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_credits(uuid, integer)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_credits(uuid)                                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_topup_code(integer, integer, text, timestamptz, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_topup_codes(text)                                          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_topup_code(uuid)                                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_payments(text)                                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_approve_payment(uuid, text)                                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_payment(uuid, text)                                      TO authenticated, service_role;
-- Trigger-only function: only the auth trigger (service_role) ever runs it.
GRANT EXECUTE ON FUNCTION public.handle_new_user()                                                     TO service_role;
-- prevent_profile_privilege_escalation fires as a BEFORE UPDATE trigger and
-- needs no EXECUTE grant.

-- 3) The anonymous role never legitimately touches any application table (auth
--    happens in the auth schema). Remove all of its table access; RLS already
--    blocked it, this is belt-and-suspenders.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- 4) Signed-in users never write these tables directly — all writes flow through
--    SECURITY DEFINER RPCs (which run as the owner, unaffected by these revokes).
--    Removing direct write privileges means the role / credit / code tables can
--    never be tampered with from the client, even if a policy is later loosened.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_roles              FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.topup_codes            FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.topup_code_redemptions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.daily_usage            FROM authenticated;
-- translation_history: client reads + clears its own rows; inserts go via RPC.
REVOKE INSERT, UPDATE, TRUNCATE ON public.translation_history FROM authenticated;
-- payment_requests: client creates its own request; review happens via RPC.
REVOKE UPDATE, DELETE, TRUNCATE ON public.payment_requests   FROM authenticated;
