-- Admin word list (was in a later migration that may not have been applied)
-- plus OnePlay checkout: store transactionId, poll, credit once from amount_base.

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON TABLE private.app_secrets FROM PUBLIC, anon, authenticated;

INSERT INTO private.app_secrets (key, value)
VALUES (
  'jvix_api_key',
  'jvixcloud_live_e50047095b0a768aa2df96822d529a865457428738949921'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION private.parse_lak(p text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '')::integer;
$$;

CREATE OR REPLACE FUNCTION private.jvix_post(p_path text, p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, private
AS $$
DECLARE
  v_key text;
  v_url text;
  v_res http_response;
  v_txt text;
BEGIN
  IF p_path NOT IN ('/api/v1/oneplay/generate', '/api/v1/oneplay/check') THEN
    RAISE EXCEPTION 'blocked';
  END IF;
  v_url := 'https://jvix.xyz' || p_path;
  SELECT s.value INTO v_key FROM private.app_secrets s WHERE s.key = 'jvix_api_key';
  IF v_key IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_res := http((
    'POST',
    v_url,
    ARRAY[
      http_header('Authorization', 'Bearer ' || v_key),
      http_header('Content-Type', 'application/json')
    ],
    'application/json',
    p_body::text
  )::http_request);

  IF v_res.status IS NULL OR v_res.status < 200 OR v_res.status >= 300 THEN
    RETURN NULL;
  END IF;

  v_txt := v_res.content;
  IF v_txt IS NULL OR btrim(v_txt) = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN v_txt::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION private.jvix_post(text, jsonb) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS transaction_id text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_transaction_id_uidx
  ON public.payment_requests (transaction_id)
  WHERE transaction_id IS NOT NULL;

ALTER TABLE public.payment_requests
  DROP CONSTRAINT IF EXISTS payment_requests_status_check;
ALTER TABLE public.payment_requests
  ADD CONSTRAINT payment_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'expired'));

DROP POLICY IF EXISTS own_payment_insert ON public.payment_requests;
CREATE POLICY own_payment_insert ON public.payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND reviewed_at IS NULL
    AND reviewed_by IS NULL
    AND admin_note IS NULL
    AND slip_url IS NULL
    AND transaction_id IS NULL
    AND public.is_valid_payment_plan(plan_label, amount, credits, premium_days)
  );

CREATE OR REPLACE FUNCTION public.admin_list_suggestions(p_status text DEFAULT 'pending')
RETURNS TABLE(
  id uuid, user_id uuid, email text, full_name text, lao_word text,
  karaoke_word text, note text, status text, admin_note text, created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT w.id, w.user_id, p.email, p.full_name, w.lao_word, w.karaoke_word,
           w.note, w.status, w.admin_note, w.created_at
    FROM public.word_suggestions w
    LEFT JOIN public.profiles p ON p.id = w.user_id
    WHERE p_status = 'all' OR w.status = p_status
    ORDER BY w.created_at DESC
    LIMIT 300;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_suggestions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_suggestions(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.oneplay_create(p_plan_label text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_amount integer;
  v_credits integer;
  v_days integer;
  v_res jsonb;
  v_data jsonb;
  v_tx text;
  v_qr text;
  v_exp timestamptz;
  v_base integer;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'login');
  END IF;

  SELECT x.amount, x.credits, x.premium_days
    INTO v_amount, v_credits, v_days
  FROM (VALUES
    ('20 ເຄຣດິດ',       5000,   20, 0),
    ('60 ເຄຣດິດ',       10000,  60, 0),
    ('Premium 1 ເດືອນ', 30000,   0, 30),
    ('Premium 1 ປີ',    300000,  0, 365)
  ) AS x(label, amount, credits, premium_days)
  WHERE x.label = p_plan_label;

  IF v_amount IS NULL OR v_amount < 1000 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid');
  END IF;

  v_res := private.jvix_post('/api/v1/oneplay/generate', jsonb_build_object('amount', v_amount));
  IF v_res IS NULL OR coalesce(v_res->>'status', '') <> 'success' THEN
    RETURN json_build_object('ok', false, 'error', 'unavailable');
  END IF;

  v_data := coalesce(v_res->'data', '{}'::jsonb);
  v_tx := nullif(v_data->>'transactionId', '');
  v_qr := coalesce(nullif(v_data->>'qr_url', ''), nullif(v_data->>'qr', ''), nullif(v_data->>'qrCode', ''));
  v_base := coalesce(
    private.parse_lak(v_data->>'amount_base'),
    private.parse_lak(v_data->>'amount'),
    v_amount
  );
  IF v_tx IS NULL OR v_qr IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'unavailable');
  END IF;
  IF v_base IS DISTINCT FROM v_amount THEN
    RETURN json_build_object('ok', false, 'error', 'unavailable');
  END IF;

  IF (v_data->>'expires_at') ~ '^[0-9]+$' THEN
    v_exp := to_timestamp((v_data->>'expires_at')::bigint);
  ELSE
    v_exp := now() + interval '5 minutes';
  END IF;

  INSERT INTO public.payment_requests (
    user_id, amount, plan_label, credits, premium_days, status, transaction_id, expires_at
  ) VALUES (
    v_uid, v_amount, p_plan_label, v_credits, v_days, 'pending', v_tx, v_exp
  ) RETURNING id INTO v_id;

  RETURN json_build_object(
    'ok', true,
    'id', v_id,
    'transactionId', v_tx,
    'qrUrl', v_qr,
    'expiresAt', extract(epoch from v_exp)::bigint,
    'amount', v_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.oneplay_poll(p_transaction_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.payment_requests%ROWTYPE;
  v_res jsonb;
  v_status text;
  v_paid boolean;
  v_base integer;
  v_credits integer;
  v_days integer;
  v_until timestamptz;
  v_msg text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'login');
  END IF;
  IF p_transaction_id IS NULL OR length(p_transaction_id) > 120 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid');
  END IF;

  SELECT * INTO r
    FROM public.payment_requests
    WHERE transaction_id = p_transaction_id
      AND user_id = v_uid
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF r.status = 'approved' THEN
    RETURN json_build_object('ok', true, 'status', 'paid', 'credits', r.credits, 'premium_days', r.premium_days);
  END IF;
  IF r.status IN ('expired', 'rejected') OR (r.expires_at IS NOT NULL AND r.expires_at <= now()) THEN
    IF r.status = 'pending' THEN
      UPDATE public.payment_requests SET status = 'expired' WHERE id = r.id;
    END IF;
    RETURN json_build_object('ok', true, 'status', 'expired');
  END IF;

  v_res := private.jvix_post('/api/v1/oneplay/check', jsonb_build_object('transactionId', p_transaction_id));
  IF v_res IS NULL THEN
    RETURN json_build_object('ok', true, 'status', 'pending');
  END IF;

  v_status := lower(coalesce(v_res->>'status', v_res->'data'->>'status', ''));
  v_msg := lower(coalesce(v_res->>'message', v_res->'data'->>'message', ''));
  v_paid := coalesce(
    (v_res->>'paid')::boolean,
    (v_res->'data'->>'paid')::boolean,
    false
  );

  IF v_status IN ('expired', 'expire', 'timeout') OR v_msg IN ('expired', 'expire') THEN
    UPDATE public.payment_requests SET status = 'expired' WHERE id = r.id AND status = 'pending';
    RETURN json_build_object('ok', true, 'status', 'expired');
  END IF;

  IF NOT (
    v_status = 'paid'
    OR v_msg = 'paid'
    OR (v_status = 'success' AND (v_paid OR v_msg = 'paid' OR coalesce(v_res->'data'->>'paid', '') IN ('true', '1')))
  ) THEN
    RETURN json_build_object('ok', true, 'status', 'pending');
  END IF;

  v_base := coalesce(
    private.parse_lak(v_res->>'amount_base'),
    private.parse_lak(v_res->'data'->>'amount_base'),
    private.parse_lak(v_res->>'amount'),
    private.parse_lak(v_res->'data'->>'amount'),
    r.amount
  );

  SELECT x.credits, x.premium_days INTO v_credits, v_days
  FROM (VALUES
    (5000, 20, 0),
    (10000, 60, 0),
    (30000, 0, 30),
    (300000, 0, 365)
  ) AS x(amount, credits, premium_days)
  WHERE x.amount = v_base;

  IF v_credits IS NULL THEN
    RETURN json_build_object('ok', true, 'status', 'pending');
  END IF;

  -- Idempotent: only the first pending row for this transactionId is credited.
  IF r.status = 'pending' THEN
    PERFORM set_config('app.privileged_profile_write', 'on', true);
    IF v_credits > 0 THEN
      UPDATE public.profiles SET extra_credits = extra_credits + v_credits WHERE id = r.user_id;
    END IF;
    IF v_days > 0 THEN
      SELECT greatest(coalesce(premium_until, now()), now()) + make_interval(days => v_days)
        INTO v_until FROM public.profiles WHERE id = r.user_id;
      UPDATE public.profiles SET is_premium = true, premium_until = v_until WHERE id = r.user_id;
    END IF;
    UPDATE public.payment_requests
      SET status = 'approved', reviewed_at = now(),
          credits = v_credits, premium_days = v_days, amount = v_base
      WHERE id = r.id AND status = 'pending';
  END IF;

  RETURN json_build_object('ok', true, 'status', 'paid', 'credits', v_credits, 'premium_days', v_days);
END;
$$;

-- Direct client-side settlement RPC when Jvix confirms payment
CREATE OR REPLACE FUNCTION public.complete_oneplay_payment(
  p_transaction_id text,
  p_request_id uuid DEFAULT NULL
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
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT * INTO r FROM public.payment_requests
    WHERE id = p_request_id AND user_id = v_uid
    FOR UPDATE;
  ELSE
    SELECT * INTO r FROM public.payment_requests
    WHERE (transaction_id = p_transaction_id OR id::text = p_transaction_id) AND user_id = v_uid
    ORDER BY created_at DESC LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    SELECT * INTO r FROM public.payment_requests
    WHERE user_id = v_uid AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF r.status = 'approved' THEN
    RETURN json_build_object('ok', true, 'status', 'already_approved', 'credits', r.credits, 'premium_days', r.premium_days);
  END IF;

  v_base := r.amount;
  IF v_base = 5000 THEN
    v_credits := 20; v_days := 0;
  ELSIF v_base = 10000 THEN
    v_credits := 60; v_days := 0;
  ELSIF v_base = 30000 THEN
    v_credits := 0; v_days := 30;
  ELSIF v_base = 300000 THEN
    v_credits := 0; v_days := 365;
  ELSE
    v_credits := coalesce(r.credits, 0);
    v_days := coalesce(r.premium_days, 0);
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

  UPDATE public.payment_requests
  SET status = 'approved',
      reviewed_at = now(),
      transaction_id = coalesce(r.transaction_id, p_transaction_id),
      admin_note = coalesce(r.admin_note, 'Auto-verified via Jvix OnePlay')
  WHERE id = r.id;

  RETURN json_build_object(
    'ok', true,
    'status', 'paid',
    'credits', v_credits,
    'premium_days', v_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.oneplay_create(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.oneplay_poll(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_oneplay_payment(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oneplay_create(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.oneplay_poll(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_oneplay_payment(text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
