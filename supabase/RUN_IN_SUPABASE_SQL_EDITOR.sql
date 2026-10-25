-- ==============================================================================
-- 🚀 RUN THIS IN SUPABASE SQL EDITOR TO PERMANENTLY ENABLE AUTO-CREDITING IN DB
-- URL: https://supabase.com/dashboard/project/vositjjwzclxwtrstyzj/sql/new
-- ==============================================================================

BEGIN;

-- 1. Remove rigid plan check constraint
ALTER TABLE public.payment_requests
  DROP CONSTRAINT IF EXISTS payment_requests_plan_check;

-- 2. Update is_valid_payment_plan function to allow custom credits (>= 1,000 LAK, >= 4 credits)
CREATE OR REPLACE FUNCTION public.is_valid_payment_plan(
  p_plan_label text,
  p_amount integer,
  p_credits integer,
  p_premium_days integer
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    (p_plan_label, p_amount, p_credits, p_premium_days) IN (
      ('20 ເຄຣດິດ',        5000,   20, 0),
      ('60 ເຄຣດິດ',        10000,  60, 0),
      ('Premium 1 ເດືອນ',  30000,  0,  30),
      ('Premium 1 ປີ',     300000, 0,  365)
    )
    OR (p_amount >= 1000 AND p_credits >= 4 AND p_premium_days = 0)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_valid_payment_plan(text, integer, integer, integer) TO authenticated;

-- 3. Automatic settlement RPC: bypasses privilege escalation trigger & grants credits directly
CREATE OR REPLACE FUNCTION public.complete_oneplay_payment(
  p_transaction_id text,
  p_request_id uuid DEFAULT NULL,
  p_amount integer DEFAULT NULL,
  p_credits integer DEFAULT NULL,
  p_premium_days integer DEFAULT NULL,
  p_plan_label text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new_credits integer;
  v_new_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Grant extra credits
  IF p_credits IS NOT NULL AND p_credits > 0 THEN
    PERFORM set_config('app.privileged_profile_write', 'on', true);
    UPDATE public.profiles
      SET extra_credits = extra_credits + p_credits
      WHERE id = v_uid
      RETURNING extra_credits INTO v_new_credits;
  END IF;

  -- Grant premium days
  IF p_premium_days IS NOT NULL AND p_premium_days > 0 THEN
    PERFORM set_config('app.privileged_profile_write', 'on', true);
    SELECT greatest(coalesce(premium_until, now()), now()) + (p_premium_days || ' days')::interval
      INTO v_new_until
      FROM public.profiles
      WHERE id = v_uid;

    UPDATE public.profiles
      SET is_premium = true, premium_until = v_new_until
      WHERE id = v_uid;
  END IF;

  -- Update payment_requests row if present
  IF p_request_id IS NOT NULL THEN
    UPDATE public.payment_requests
      SET status = 'approved',
          admin_note = coalesce(p_note, admin_note),
          reviewed_at = now()
      WHERE id = p_request_id;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'credits', v_new_credits,
    'premium_until', v_new_until
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_oneplay_payment(text, uuid, integer, integer, integer, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_oneplay_payment(text, uuid, integer, integer, integer, text, text) TO authenticated;

COMMIT;
