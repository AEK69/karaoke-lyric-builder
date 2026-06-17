-- (1) Multi-use top-up codes: one code can be redeemed by many users, but each
--     user can redeem a given code only once.
-- (2) Ticker privacy: the community ticker exposes only name + avatar (no
--     premium/promotion info). The premium countdown is the viewer's own and is
--     handled client-side from their profile.

-- ── (1) schema ──────────────────────────────────────────────────────────────
ALTER TABLE public.topup_codes
  ADD COLUMN IF NOT EXISTS max_uses  integer,                 -- NULL = unlimited
  ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.topup_code_redemptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id     uuid NOT NULL REFERENCES public.topup_codes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code_id, user_id)
);
GRANT SELECT ON public.topup_code_redemptions TO authenticated;
GRANT ALL    ON public.topup_code_redemptions TO service_role;
ALTER TABLE public.topup_code_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_redemptions_select" ON public.topup_code_redemptions;
CREATE POLICY "own_redemptions_select" ON public.topup_code_redemptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Backfill: existing codes were single-use. Keep them capped at one use and
-- preserve any existing claim as a redemption row.
UPDATE public.topup_codes SET max_uses = 1 WHERE max_uses IS NULL;
INSERT INTO public.topup_code_redemptions (code_id, user_id, redeemed_at)
  SELECT id, used_by, COALESCE(used_at, now()) FROM public.topup_codes WHERE used_by IS NOT NULL
ON CONFLICT (code_id, user_id) DO NOTHING;
UPDATE public.topup_codes c
  SET use_count = (SELECT count(*) FROM public.topup_code_redemptions r WHERE r.code_id = c.id);

-- ── redeem: multi-use + once-per-user ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redeem_topup_code(p_code text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < v_now THEN
    RETURN json_build_object('ok', false, 'error', 'expired'); END IF;
  IF EXISTS (SELECT 1 FROM public.topup_code_redemptions r
             WHERE r.code_id = v_row.id AND r.user_id = v_uid) THEN
    RETURN json_build_object('ok', false, 'error', 'already_redeemed'); END IF;
  IF v_row.max_uses IS NOT NULL AND v_row.use_count >= v_row.max_uses THEN
    RETURN json_build_object('ok', false, 'error', 'used_up'); END IF;

  INSERT INTO public.topup_code_redemptions (code_id, user_id) VALUES (v_row.id, v_uid);
  UPDATE public.topup_codes
    SET use_count = use_count + 1,
        used_by   = COALESCE(used_by, v_uid),
        used_at   = COALESCE(used_at, v_now)
    WHERE id = v_row.id;

  -- Authorise the privileged profile write for this transaction (see
  -- prevent_profile_privilege_escalation guard).
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
END; $$;
REVOKE EXECUTE ON FUNCTION public.redeem_topup_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_topup_code(text) TO authenticated, service_role;

-- ── admin create: accept how many people may use the code ───────────────────
DROP FUNCTION IF EXISTS public.admin_create_topup_code(integer, integer, text, timestamptz);
CREATE OR REPLACE FUNCTION public.admin_create_topup_code(
  p_credits integer, p_premium_days integer, p_note text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL, p_max_uses integer DEFAULT 1
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; v_max integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_credits NOT BETWEEN 0 AND 1000000 OR p_premium_days NOT BETWEEN 0 AND 3650
     OR (p_credits = 0 AND p_premium_days = 0)
     OR length(coalesce(p_note, '')) > 500
     OR (p_expires_at IS NOT NULL AND p_expires_at <= now())
     OR (p_max_uses IS NOT NULL AND p_max_uses NOT BETWEEN 0 AND 1000000) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  v_max := CASE WHEN p_max_uses IS NULL OR p_max_uses <= 0 THEN NULL ELSE p_max_uses END;
  v_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 12));
  INSERT INTO public.topup_codes (code, credits, premium_days, note, created_by, expires_at, max_uses)
    VALUES (v_code, p_credits, p_premium_days, nullif(trim(p_note), ''), auth.uid(), p_expires_at, v_max);
  RETURN json_build_object('ok', true, 'code', v_code);
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_create_topup_code(integer, integer, text, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_topup_code(integer, integer, text, timestamptz, integer) TO authenticated, service_role;

-- ── admin list: report usage instead of single claimant ─────────────────────
DROP FUNCTION IF EXISTS public.admin_list_topup_codes(text);
CREATE OR REPLACE FUNCTION public.admin_list_topup_codes(p_filter text DEFAULT 'all')
RETURNS TABLE(id uuid, code text, credits integer, premium_days integer, note text,
  max_uses integer, use_count integer, expires_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT c.id, c.code, c.credits, c.premium_days, c.note, c.max_uses, c.use_count, c.expires_at, c.created_at
    FROM public.topup_codes c
    WHERE (p_filter = 'all')
       OR (p_filter = 'unused'  AND (c.expires_at IS NULL OR c.expires_at > now())
             AND (c.max_uses IS NULL OR c.use_count < c.max_uses))
       OR (p_filter = 'used'    AND c.max_uses IS NOT NULL AND c.use_count >= c.max_uses)
       OR (p_filter = 'expired' AND c.expires_at IS NOT NULL AND c.expires_at <= now()
             AND (c.max_uses IS NULL OR c.use_count < c.max_uses))
    ORDER BY c.created_at DESC LIMIT 300;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_list_topup_codes(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_topup_codes(text) TO authenticated, service_role;

-- ── (2) ticker privacy: only name + avatar ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_ticker()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'total_users', (SELECT count(*) FROM public.profiles),
    'members', COALESCE((
      SELECT json_agg(m) FROM (
        SELECT
          COALESCE(NULLIF(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'ຜູ້ໃຊ້') AS name,
          p.avatar_url AS avatar_url
        FROM public.profiles p
        ORDER BY p.created_at DESC
        LIMIT 80
      ) m
    ), '[]'::json)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.community_ticker() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_ticker() TO authenticated, service_role;
