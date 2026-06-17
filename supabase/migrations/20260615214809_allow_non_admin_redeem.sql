-- Non-admin users could not redeem top-up codes (nor spend purchased credits).
--
-- The BEFORE UPDATE trigger `profiles_prevent_privilege_escalation` blocks any
-- change to privileged profile columns (extra_credits / is_premium /
-- premium_until / id / created_at / email) unless the caller is an admin or
-- there is no JWT. Because `redeem_topup_code` and `try_consume_translation`
-- are SECURITY DEFINER, `auth.uid()` inside them is still the *caller's* id, so
-- for a normal logged-in user the guard raised
--   "not allowed to modify privileged profile columns"  (HTTP 400)
-- even though the write was being made by a trusted, controlled function.
--
-- Fix: let trusted server-side routines opt in to the privileged write via a
-- transaction-local GUC. PostgREST never lets a plain request set this GUC, and
-- the only functions that set it constrain exactly what they write, so this
-- does not reopen the privilege-escalation hole the guard was added to close.

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Trusted RPCs set this flag (transaction-local) right before a legitimate
  -- privileged write. Not settable from a normal PostgREST request.
  IF current_setting('app.privileged_profile_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.is_premium    IS DISTINCT FROM OLD.is_premium
  OR NEW.premium_until IS DISTINCT FROM OLD.premium_until
  OR NEW.extra_credits IS DISTINCT FROM OLD.extra_credits
  OR NEW.id            IS DISTINCT FROM OLD.id
  OR NEW.created_at    IS DISTINCT FROM OLD.created_at
  OR NEW.email         IS DISTINCT FROM OLD.email
  THEN RAISE EXCEPTION 'not allowed to modify privileged profile columns';
  END IF;
  RETURN NEW;
END; $$;

-- redeem_topup_code: authorise the privileged profile write for this txn only.
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
  -- Trusted write on behalf of the (non-admin) user redeeming their code.
  PERFORM set_config('app.privileged_profile_write', 'on', true);
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

-- try_consume_translation: same flag for the paid-credit decrement path.
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
    PERFORM set_config('app.privileged_profile_write', 'on', true);
    UPDATE public.profiles SET extra_credits = extra_credits - 1 WHERE id = v_uid RETURNING extra_credits INTO v_credits;
    INSERT INTO public.daily_usage (user_id, used_date, count) VALUES (v_uid, v_today, 1)
    ON CONFLICT (user_id, used_date) DO UPDATE SET count = public.daily_usage.count + 1
    RETURNING count INTO v_count;
    RETURN json_build_object('allowed', true, 'is_premium', false, 'used', v_count, 'remaining', 0, 'credits', v_credits);
  END IF;
  RETURN json_build_object('allowed', false, 'is_premium', false, 'used', v_count, 'remaining', 0, 'credits', v_credits);
END;
$$;
