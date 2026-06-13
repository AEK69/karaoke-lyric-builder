-- Prevent direct privilege escalation through profile writes.
DROP POLICY IF EXISTS "own_profile_insert" ON public.profiles;
DROP POLICY IF EXISTS "own_profile_update" ON public.profiles;

REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
GRANT INSERT (id, email, full_name, avatar_url) ON public.profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url) ON public.profiles TO authenticated;

CREATE POLICY "own_profile_insert" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = id
  AND is_premium = false
  AND premium_until IS NULL
  AND extra_credits = 0
);

CREATE POLICY "own_profile_update" ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Only accept the exact commercial plans offered by the application, and
-- prevent clients from supplying review/approval state at creation time.
ALTER TABLE public.payment_requests
  DROP CONSTRAINT IF EXISTS payment_requests_status_check,
  DROP CONSTRAINT IF EXISTS payment_requests_plan_check,
  ADD CONSTRAINT payment_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD CONSTRAINT payment_requests_plan_check CHECK (
    (amount = 5000 AND plan_label = '20 ເຄຣດິດ' AND credits = 20 AND premium_days = 0)
    OR (amount = 10000 AND plan_label = '60 ເຄຣດິດ' AND credits = 60 AND premium_days = 0)
    OR (amount = 30000 AND plan_label = 'Premium 1 ເດືອນ' AND credits = 0 AND premium_days = 30)
    OR (amount = 300000 AND plan_label = 'Premium 1 ປີ' AND credits = 0 AND premium_days = 365)
  );

DROP POLICY IF EXISTS "own_payment_insert" ON public.payment_requests;
CREATE POLICY "own_payment_insert" ON public.payment_requests
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND reviewed_at IS NULL
  AND reviewed_by IS NULL
  AND admin_note IS NULL
  AND slip_url IS NULL
);

-- Harden every exposed SECURITY DEFINER function. PostgreSQL grants function
-- execution to PUBLIC by default, so remove that implicit access first.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- Trigger-only function: never callable through the Data API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- Role helper is intentionally callable only by signed-in users and the backend.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- User RPCs require auth.uid() internally.
GRANT EXECUTE ON FUNCTION public.try_consume_translation(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_topup_code(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_translation(text, text, text) TO authenticated, service_role;

-- Admin RPCs require has_role(auth.uid(), 'admin') internally.
GRANT EXECUTE ON FUNCTION public.admin_search_users(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_premium(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_premium(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_credits(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_topup_code(integer, integer, text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_approve_payment(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_payment(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_credits(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_payments(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_topup_codes(text) TO authenticated, service_role;

-- Add server-side bounds to user-controlled RPC arguments.
CREATE OR REPLACE FUNCTION public.log_translation(p_direction text, p_input text, p_output text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_direction NOT IN ('lao-to-karaoke', 'karaoke-to-lao')
     OR length(p_input) NOT BETWEEN 1 AND 5000
     OR length(p_output) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  INSERT INTO public.translation_history (user_id, direction, input_text, output_text)
  VALUES (auth.uid(), p_direction, p_input, p_output)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_translation(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_translation(text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.redeem_topup_code(p_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.topup_codes%ROWTYPE;
  v_now timestamptz := now();
  v_new_until timestamptz;
  v_code text := upper(trim(p_code));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF v_code !~ '^[A-F0-9]{12}$' THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_code');
  END IF;
  SELECT * INTO v_row FROM public.topup_codes WHERE code = v_code FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'invalid_code'); END IF;
  IF v_row.used_by IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'already_used'); END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < v_now THEN RETURN json_build_object('ok', false, 'error', 'expired'); END IF;
  UPDATE public.topup_codes SET used_by = v_uid, used_at = v_now WHERE id = v_row.id;
  IF v_row.credits > 0 THEN
    UPDATE public.profiles SET extra_credits = extra_credits + v_row.credits WHERE id = v_uid;
  END IF;
  IF v_row.premium_days > 0 THEN
    SELECT greatest(coalesce(premium_until, v_now), v_now) + make_interval(days => v_row.premium_days)
      INTO v_new_until FROM public.profiles WHERE id = v_uid;
    UPDATE public.profiles SET is_premium = true, premium_until = v_new_until WHERE id = v_uid;
  END IF;
  RETURN json_build_object('ok', true, 'credits', v_row.credits, 'premium_days', v_row.premium_days);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.redeem_topup_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_topup_code(text) TO authenticated, service_role;

-- Bound the caller-provided daily limit so it cannot be increased by a client.
CREATE OR REPLACE FUNCTION public.try_consume_translation(p_limit integer DEFAULT 15)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_premium boolean := false;
  v_premium_until timestamptz;
  v_credits integer := 0;
  v_count integer := 0;
  v_limit constant integer := 15;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT is_premium, premium_until, extra_credits INTO v_premium, v_premium_until, v_credits
    FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  IF v_premium AND (v_premium_until IS NULL OR v_premium_until > now()) THEN
    INSERT INTO public.daily_usage (user_id, used_date, count) VALUES (v_uid, v_today, 1)
    ON CONFLICT (user_id, used_date) DO UPDATE SET count = public.daily_usage.count + 1
    RETURNING count INTO v_count;
    RETURN json_build_object('allowed', true, 'is_premium', true, 'used', v_count, 'remaining', -1, 'credits', v_credits);
  END IF;
  SELECT count INTO v_count FROM public.daily_usage WHERE user_id = v_uid AND used_date = v_today;
  v_count := coalesce(v_count, 0);
  IF v_count < v_limit THEN
    INSERT INTO public.daily_usage (user_id, used_date, count) VALUES (v_uid, v_today, 1)
    ON CONFLICT (user_id, used_date) DO UPDATE SET count = public.daily_usage.count + 1
    RETURNING count INTO v_count;
    RETURN json_build_object('allowed', true, 'is_premium', false, 'used', v_count, 'remaining', v_limit - v_count, 'credits', v_credits);
  END IF;
  IF v_credits > 0 THEN
    UPDATE public.profiles SET extra_credits = extra_credits - 1 WHERE id = v_uid RETURNING extra_credits INTO v_credits;
    INSERT INTO public.daily_usage (user_id, used_date, count) VALUES (v_uid, v_today, 1)
    ON CONFLICT (user_id, used_date) DO UPDATE SET count = public.daily_usage.count + 1
    RETURNING count INTO v_count;
    RETURN json_build_object('allowed', true, 'is_premium', false, 'used', v_count, 'remaining', 0, 'credits', v_credits);
  END IF;
  RETURN json_build_object('allowed', false, 'is_premium', false, 'used', v_count, 'remaining', 0, 'credits', v_credits);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.try_consume_translation(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_consume_translation(integer) TO authenticated, service_role;

-- Constrain high-impact admin arguments even after role authorization.
CREATE OR REPLACE FUNCTION public.admin_add_credits(p_user uuid, p_amount integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_amount NOT BETWEEN -1000000 AND 1000000 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  UPDATE public.profiles SET extra_credits = greatest(0, extra_credits + p_amount)
    WHERE id = p_user RETURNING extra_credits INTO v_new;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  RETURN json_build_object('ok', true, 'credits', v_new);
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_add_credits(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_credits(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_grant_premium(p_user uuid, p_days integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_until timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_days NOT BETWEEN 1 AND 3650 THEN RAISE EXCEPTION 'invalid_days'; END IF;
  UPDATE public.profiles
    SET is_premium = true,
        premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => p_days)
    WHERE id = p_user RETURNING premium_until INTO v_until;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  RETURN json_build_object('ok', true, 'premium_until', v_until);
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_grant_premium(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_premium(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_create_topup_code(
  p_credits integer, p_premium_days integer, p_note text DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_credits NOT BETWEEN 0 AND 1000000 OR p_premium_days NOT BETWEEN 0 AND 3650
     OR (p_credits = 0 AND p_premium_days = 0)
     OR length(coalesce(p_note, '')) > 500
     OR (p_expires_at IS NOT NULL AND p_expires_at <= now()) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  v_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 12));
  INSERT INTO public.topup_codes (code, credits, premium_days, note, created_by, expires_at)
    VALUES (v_code, p_credits, p_premium_days, nullif(trim(p_note), ''), auth.uid(), p_expires_at);
  RETURN json_build_object('ok', true, 'code', v_code);
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_create_topup_code(integer, integer, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_topup_code(integer, integer, text, timestamptz) TO authenticated, service_role;