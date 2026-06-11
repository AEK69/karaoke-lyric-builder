
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "own_roles_select" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Extra credits column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS extra_credits INTEGER NOT NULL DEFAULT 0;

-- Top-up codes
CREATE TABLE public.topup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL DEFAULT 0,
  premium_days INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  used_by UUID REFERENCES auth.users(id),
  used_at TIMESTAMPTZ
);
GRANT SELECT ON public.topup_codes TO authenticated;
GRANT ALL ON public.topup_codes TO service_role;
ALTER TABLE public.topup_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_select_codes" ON public.topup_codes FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Updated consume: 15/day default + credits fallback
CREATE OR REPLACE FUNCTION public.try_consume_translation(p_limit INTEGER DEFAULT 15)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_premium BOOLEAN := false;
  v_premium_until TIMESTAMPTZ;
  v_credits INTEGER := 0;
  v_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT is_premium, premium_until, extra_credits INTO v_premium, v_premium_until, v_credits
  FROM public.profiles WHERE id = v_uid;

  -- Premium = unlimited
  IF v_premium AND (v_premium_until IS NULL OR v_premium_until > now()) THEN
    INSERT INTO public.daily_usage (user_id, used_date, count) VALUES (v_uid, v_today, 1)
    ON CONFLICT (user_id, used_date) DO UPDATE SET count = public.daily_usage.count + 1
    RETURNING count INTO v_count;
    RETURN json_build_object('allowed', true, 'is_premium', true, 'used', v_count, 'remaining', -1, 'credits', v_credits);
  END IF;

  SELECT count INTO v_count FROM public.daily_usage WHERE user_id = v_uid AND used_date = v_today;
  v_count := COALESCE(v_count, 0);

  -- Within daily free quota
  IF v_count < p_limit THEN
    INSERT INTO public.daily_usage (user_id, used_date, count) VALUES (v_uid, v_today, 1)
    ON CONFLICT (user_id, used_date) DO UPDATE SET count = public.daily_usage.count + 1
    RETURNING count INTO v_count;
    RETURN json_build_object('allowed', true, 'is_premium', false, 'used', v_count, 'remaining', p_limit - v_count, 'credits', v_credits);
  END IF;

  -- Use extra credits
  IF v_credits > 0 THEN
    UPDATE public.profiles SET extra_credits = extra_credits - 1 WHERE id = v_uid RETURNING extra_credits INTO v_credits;
    INSERT INTO public.daily_usage (user_id, used_date, count) VALUES (v_uid, v_today, 1)
    ON CONFLICT (user_id, used_date) DO UPDATE SET count = public.daily_usage.count + 1
    RETURNING count INTO v_count;
    RETURN json_build_object('allowed', true, 'is_premium', false, 'used', v_count, 'remaining', 0, 'credits', v_credits);
  END IF;

  RETURN json_build_object('allowed', false, 'is_premium', false, 'used', v_count, 'remaining', 0, 'credits', v_credits);
END; $$;
GRANT EXECUTE ON FUNCTION public.try_consume_translation(INTEGER) TO authenticated;

-- Redeem code (user)
CREATE OR REPLACE FUNCTION public.redeem_topup_code(p_code TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.topup_codes%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_new_until TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_row FROM public.topup_codes WHERE code = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'invalid_code'); END IF;
  IF v_row.used_by IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'already_used'); END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < v_now THEN RETURN json_build_object('ok', false, 'error', 'expired'); END IF;

  UPDATE public.topup_codes SET used_by = v_uid, used_at = v_now WHERE id = v_row.id;

  IF v_row.credits > 0 THEN
    UPDATE public.profiles SET extra_credits = extra_credits + v_row.credits WHERE id = v_uid;
  END IF;

  IF v_row.premium_days > 0 THEN
    SELECT GREATEST(COALESCE(premium_until, v_now), v_now) + (v_row.premium_days || ' days')::interval
    INTO v_new_until FROM public.profiles WHERE id = v_uid;
    UPDATE public.profiles SET is_premium = true, premium_until = v_new_until WHERE id = v_uid;
  END IF;

  RETURN json_build_object('ok', true, 'credits', v_row.credits, 'premium_days', v_row.premium_days);
END; $$;
GRANT EXECUTE ON FUNCTION public.redeem_topup_code(TEXT) TO authenticated;

-- Admin: search users
CREATE OR REPLACE FUNCTION public.admin_search_users(p_query TEXT DEFAULT '')
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, avatar_url TEXT, is_premium BOOLEAN, premium_until TIMESTAMPTZ, extra_credits INTEGER, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT p.id, p.email, p.full_name, p.avatar_url, p.is_premium, p.premium_until, p.extra_credits, p.created_at
    FROM public.profiles p
    WHERE p_query = '' OR p.email ILIKE '%'||p_query||'%' OR p.full_name ILIKE '%'||p_query||'%'
    ORDER BY p.created_at DESC LIMIT 200;
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_search_users(TEXT) TO authenticated;

-- Admin: grant premium
CREATE OR REPLACE FUNCTION public.admin_grant_premium(p_user UUID, p_days INTEGER)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_until TIMESTAMPTZ;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT GREATEST(COALESCE(premium_until, now()), now()) + (p_days || ' days')::interval
  INTO v_until FROM public.profiles WHERE id = p_user;
  UPDATE public.profiles SET is_premium = true, premium_until = v_until WHERE id = p_user;
  RETURN json_build_object('ok', true, 'premium_until', v_until);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_grant_premium(UUID, INTEGER) TO authenticated;

-- Admin: revoke premium
CREATE OR REPLACE FUNCTION public.admin_revoke_premium(p_user UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.profiles SET is_premium = false, premium_until = NULL WHERE id = p_user;
  RETURN json_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_revoke_premium(UUID) TO authenticated;

-- Admin: add credits
CREATE OR REPLACE FUNCTION public.admin_add_credits(p_user UUID, p_amount INTEGER)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.profiles SET extra_credits = GREATEST(0, extra_credits + p_amount) WHERE id = p_user
  RETURNING extra_credits INTO v_new;
  RETURN json_build_object('ok', true, 'credits', v_new);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_add_credits(UUID, INTEGER) TO authenticated;

-- Admin: create topup code
CREATE OR REPLACE FUNCTION public.admin_create_topup_code(p_credits INTEGER, p_premium_days INTEGER, p_note TEXT DEFAULT NULL, p_expires_at TIMESTAMPTZ DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 12));
  INSERT INTO public.topup_codes (code, credits, premium_days, note, created_by, expires_at)
  VALUES (v_code, GREATEST(0, p_credits), GREATEST(0, p_premium_days), p_note, auth.uid(), p_expires_at);
  RETURN json_build_object('ok', true, 'code', v_code);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_create_topup_code(INTEGER, INTEGER, TEXT, TIMESTAMPTZ) TO authenticated;

-- Admin: list topup codes (use SELECT policy already)
