-- Auto-credit settlement migration:
-- 1. Drops rigid plan checks so custom credit amounts can be purchased
-- 2. Updates is_valid_payment_plan to allow custom credit packages
-- 3. Implements complete_oneplay_payment to credit users immediately & record transfer details

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS transaction_id text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_transaction_id_uidx
  ON public.payment_requests (transaction_id)
  WHERE transaction_id IS NOT NULL;

-- Drop rigid check constraint
ALTER TABLE public.payment_requests
  DROP CONSTRAINT IF EXISTS payment_requests_plan_check;

-- Update validation function
CREATE OR REPLACE FUNCTION public.is_valid_payment_plan(
  p_plan_label text, p_amount integer, p_credits integer, p_premium_days integer
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

-- Complete payment RPC
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
  r public.payment_requests%ROWTYPE;
  v_until timestamptz;
  v_credits integer;
  v_days integer;
  v_base integer;
  v_label text;
  v_found boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT * INTO r FROM public.payment_requests
    WHERE id = p_request_id AND user_id = v_uid
    FOR UPDATE;
    v_found := FOUND;
  END IF;

  IF NOT v_found AND p_transaction_id IS NOT NULL THEN
    SELECT * INTO r FROM public.payment_requests
    WHERE (transaction_id = p_transaction_id OR id::text = p_transaction_id) AND user_id = v_uid
    ORDER BY created_at DESC LIMIT 1
    FOR UPDATE;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    SELECT * INTO r FROM public.payment_requests
    WHERE user_id = v_uid AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1
    FOR UPDATE;
    v_found := FOUND;
  END IF;

  IF v_found AND r.status = 'approved' THEN
    RETURN json_build_object('ok', true, 'status', 'already_approved', 'credits', r.credits, 'premium_days', r.premium_days);
  END IF;

  IF v_found THEN
    v_base := r.amount;
    v_label := r.plan_label;
    v_credits := coalesce(r.credits, 0);
    v_days := coalesce(r.premium_days, 0);
  ELSE
    v_base := coalesce(p_amount, 0);
    v_label := coalesce(p_plan_label, 'Custom Credit');
    v_credits := coalesce(p_credits, 0);
    v_days := coalesce(p_premium_days, 0);
  END IF;

  -- Match preset plans or calculate custom credits at 250 LAK per credit
  IF v_base = 5000 THEN
    v_credits := 20; v_days := 0;
  ELSIF v_base = 10000 THEN
    v_credits := 60; v_days := 0;
  ELSIF v_base = 30000 THEN
    v_credits := 0; v_days := 30;
  ELSIF v_base = 300000 THEN
    v_credits := 0; v_days := 365;
  ELSIF v_credits = 0 AND v_days = 0 AND v_base >= 1000 THEN
    v_credits := floor(v_base / 250)::integer;
  END IF;

  -- Allow privileged write on profiles
  PERFORM set_config('app.privileged_profile_write', 'on', true);

  IF v_credits > 0 THEN
    UPDATE public.profiles
    SET extra_credits = coalesce(extra_credits, 0) + v_credits
    WHERE id = v_uid;
  END IF;

  IF v_days > 0 THEN
    SELECT greatest(coalesce(premium_until, now()), now()) + (v_days || ' days')::interval
      INTO v_until FROM public.profiles WHERE id = v_uid;
    UPDATE public.profiles
    SET is_premium = true, premium_until = v_until
    WHERE id = v_uid;
  END IF;

  IF v_found THEN
    UPDATE public.payment_requests
    SET status = 'approved',
        reviewed_at = now(),
        transaction_id = coalesce(r.transaction_id, p_transaction_id),
        admin_note = coalesce(p_note, r.admin_note, 'Auto-verified via Jvix OnePlay'),
        credits = v_credits,
        premium_days = v_days
    WHERE id = r.id;
  ELSE
    INSERT INTO public.payment_requests (
      user_id, amount, plan_label, credits, premium_days,
      status, transaction_id, reviewed_at, admin_note
    ) VALUES (
      v_uid, v_base, v_label, v_credits, v_days,
      'approved', p_transaction_id, now(), coalesce(p_note, 'Auto-verified via Jvix OnePlay')
    );
  END IF;

  RETURN json_build_object(
    'ok', true,
    'status', 'paid',
    'credits', v_credits,
    'premium_days', v_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_oneplay_payment(text, uuid, integer, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_oneplay_payment(text, uuid, integer, integer, integer, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
