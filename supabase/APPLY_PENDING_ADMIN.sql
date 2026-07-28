-- Consolidated pending migrations (20260726032248 → 20260728023048)
-- Run once in Supabase SQL Editor for project vositjjwzclxwtrstyzj
-- Self-contained & re-runnable: creates payment-plan guard, word_suggestions/word_usage/
-- audit_logs/notifications/api_usage tables + admin stats/suggestions/audit/top-words RPCs.
BEGIN;

-- ================= 20260726032248_6aa70f82-4612-4b91-9acb-0207f75c25eb =================
-- 1) Prevent self privilege escalation on profiles
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- SECURITY DEFINER functions (redeem/admin/payment approval) run with the
  -- table owner role; direct end-user updates come in as 'authenticated'.
  IF current_setting('role', true) IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_premium IS DISTINCT FROM OLD.is_premium
     OR NEW.premium_until IS DISTINCT FROM OLD.premium_until
     OR NEW.extra_credits IS DISTINCT FROM OLD.extra_credits THEN
    RAISE EXCEPTION 'forbidden: premium and credit fields cannot be changed directly';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'forbidden: immutable fields cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_privilege_escalation ON public.profiles;
CREATE TRIGGER profiles_prevent_privilege_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_escalation();

-- 2) Constrain payment_requests to the fixed plan catalog
CREATE OR REPLACE FUNCTION public.is_valid_payment_plan(
  p_plan_label text, p_amount integer, p_credits integer, p_premium_days integer
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_plan_label, p_amount, p_credits, p_premium_days) IN (
    ('20 ເຄຣດິດ',        5000,   20, 0),
    ('60 ເຄຣດິດ',        10000,  60, 0),
    ('Premium 1 ເດືອນ',  30000,  0,  30),
    ('Premium 1 ປີ',     300000, 0,  365)
  );
$$;

DROP POLICY IF EXISTS own_payment_insert ON public.payment_requests;
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
    AND public.is_valid_payment_plan(plan_label, amount, credits, premium_days)
  );

-- ================= 20260726032316_bd07fadf-13c5-46e0-b096-1dde58d88d44 =================
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Trusted paths (admin RPCs, redeem, payment approval) are SECURITY DEFINER
  -- functions owned by the table owner, so current_user is not 'authenticated'.
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_premium IS DISTINCT FROM OLD.is_premium
     OR NEW.premium_until IS DISTINCT FROM OLD.premium_until
     OR NEW.extra_credits IS DISTINCT FROM OLD.extra_credits
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'forbidden: protected profile fields cannot be changed directly';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_payment_plan(
  p_plan_label text, p_amount integer, p_credits integer, p_premium_days integer
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (p_plan_label, p_amount, p_credits, p_premium_days) IN (
    ('20 ເຄຣດິດ',        5000,   20, 0),
    ('60 ເຄຣດິດ',        10000,  60, 0),
    ('Premium 1 ເດືອນ',  30000,  0,  30),
    ('Premium 1 ປີ',     300000, 0,  365)
  );
$$;

-- ================= 20260726033347_2557703e-a05a-43cc-95b8-19d48a389adc =================

CREATE TABLE IF NOT EXISTS public.word_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lao_word text NOT NULL,
  karaoke_word text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending',
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.word_suggestions TO authenticated;
GRANT SELECT ON public.word_suggestions TO anon;
GRANT ALL ON public.word_suggestions TO service_role;

ALTER TABLE public.word_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own suggestions readable" ON public.word_suggestions;
CREATE POLICY "own suggestions readable" ON public.word_suggestions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "approved suggestions public" ON public.word_suggestions;
CREATE POLICY "approved suggestions public" ON public.word_suggestions
  FOR SELECT TO anon, authenticated USING (status = 'approved');

DROP POLICY IF EXISTS "admins read all suggestions" ON public.word_suggestions;
CREATE POLICY "admins read all suggestions" ON public.word_suggestions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS word_suggestions_unique_lao
  ON public.word_suggestions (lower(lao_word)) WHERE status <> 'rejected';
CREATE INDEX IF NOT EXISTS word_suggestions_status_idx ON public.word_suggestions (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.submit_word_suggestion(p_lao text, p_karaoke text, p_note text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lao text := trim(p_lao);
  v_kara text := lower(trim(p_karaoke));
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF length(v_lao) NOT BETWEEN 1 AND 100
     OR length(v_kara) NOT BETWEEN 1 AND 100
     OR length(coalesce(p_note, '')) > 300 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF v_lao !~ '[\u0E80-\u0EFF]' THEN
    RETURN json_build_object('ok', false, 'error', 'not_lao');
  END IF;
  IF v_kara !~ '^[a-z0-9 ''-]+$' THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_karaoke');
  END IF;
  IF EXISTS (SELECT 1 FROM public.word_suggestions w
             WHERE lower(w.lao_word) = lower(v_lao) AND w.status <> 'rejected') THEN
    RETURN json_build_object('ok', false, 'error', 'duplicate');
  END IF;
  IF (SELECT count(*) FROM public.word_suggestions w
      WHERE w.user_id = v_uid AND w.created_at > now() - interval '1 day') >= 20 THEN
    RETURN json_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  INSERT INTO public.word_suggestions (user_id, lao_word, karaoke_word, note)
  VALUES (v_uid, v_lao, v_kara, nullif(trim(p_note), ''))
  RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_list_suggestions(p_status text DEFAULT 'pending')
RETURNS TABLE(id uuid, user_id uuid, email text, full_name text, lao_word text,
  karaoke_word text, note text, status text, admin_note text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT w.id, w.user_id, p.email, p.full_name, w.lao_word, w.karaoke_word,
           w.note, w.status, w.admin_note, w.created_at
    FROM public.word_suggestions w
    LEFT JOIN public.profiles p ON p.id = w.user_id
    WHERE p_status = 'all' OR w.status = p_status
    ORDER BY w.created_at DESC LIMIT 300;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_review_suggestion(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.word_suggestions%ROWTYPE; v_until timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(coalesce(p_note, '')) > 300 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT * INTO r FROM public.word_suggestions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF r.status <> 'pending' THEN RETURN json_build_object('ok', false, 'error', 'already_reviewed'); END IF;

  UPDATE public.word_suggestions
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        admin_note = nullif(trim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = p_id;

  IF p_approve THEN
    SELECT greatest(coalesce(premium_until, now()), now()) + interval '1 day'
      INTO v_until FROM public.profiles WHERE id = r.user_id;
    UPDATE public.profiles SET is_premium = true, premium_until = v_until WHERE id = r.user_id;
  END IF;
  RETURN json_build_object('ok', true, 'premium_until', v_until);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_stats(p_days integer DEFAULT 14)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_days integer := least(greatest(coalesce(p_days, 14), 1), 90); v_out json;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT json_build_object(
    'total_users', (SELECT count(*) FROM public.profiles),
    'premium_users', (SELECT count(*) FROM public.profiles
                      WHERE is_premium AND (premium_until IS NULL OR premium_until > now())),
    'new_users_7d', (SELECT count(*) FROM public.profiles WHERE created_at > now() - interval '7 days'),
    'translations_total', (SELECT coalesce(sum(count), 0) FROM public.daily_usage),
    'translations_today', (SELECT coalesce(sum(count), 0) FROM public.daily_usage
                           WHERE used_date = (now() AT TIME ZONE 'UTC')::date),
    'pending_payments', (SELECT count(*) FROM public.payment_requests WHERE status = 'pending'),
    'pending_words', (SELECT count(*) FROM public.word_suggestions WHERE status = 'pending'),
    'approved_words', (SELECT count(*) FROM public.word_suggestions WHERE status = 'approved'),
    'revenue_total', (SELECT coalesce(sum(amount), 0) FROM public.payment_requests WHERE status = 'approved'),
    'active_codes', (SELECT count(*) FROM public.topup_codes
                     WHERE (max_uses IS NULL OR use_count < max_uses)
                       AND (expires_at IS NULL OR expires_at > now())),
    'series', (
      SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.day), '[]'::json) FROM (
        SELECT d::date AS day,
          (SELECT coalesce(sum(u.count), 0) FROM public.daily_usage u WHERE u.used_date = d::date) AS translations,
          (SELECT count(*) FROM public.profiles p WHERE p.created_at::date = d::date) AS new_users,
          (SELECT count(*) FROM public.word_suggestions w WHERE w.created_at::date = d::date) AS words
        FROM generate_series((now() AT TIME ZONE 'UTC')::date - (v_days - 1), (now() AT TIME ZONE 'UTC')::date, interval '1 day') d
      ) t
    )
  ) INTO v_out;
  RETURN v_out;
END; $$;

REVOKE EXECUTE ON FUNCTION public.submit_word_suggestion(text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_suggestions(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_review_suggestion(uuid, boolean, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_stats(integer) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_word_suggestion(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_suggestions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_suggestion(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_stats(integer) TO authenticated;

-- ================= 20260727013532_522f9843-1d7f-47ae-95f1-0dd7f8ee095c =================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- 1. Word usage stats
CREATE TABLE IF NOT EXISTS public.word_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word text NOT NULL,
  direction text NOT NULL DEFAULT 'lao-to-karaoke',
  used_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (word, direction, used_date)
);
GRANT SELECT ON public.word_usage TO authenticated;
GRANT ALL ON public.word_usage TO service_role;
ALTER TABLE public.word_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read word usage" ON public.word_usage;
CREATE POLICY "admins read word usage" ON public.word_usage FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_word_usage_date ON public.word_usage (used_date DESC);

-- 2. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own notifications read" ON public.notifications;
CREATE POLICY "own notifications read" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own notifications update" ON public.notifications;
CREATE POLICY "own notifications update" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, created_at DESC);

-- 3. Audit log
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_user_id uuid,
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read audit logs" ON public.audit_logs;
CREATE POLICY "admins read audit logs" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at DESC);

-- 4. Public API quota
CREATE TABLE IF NOT EXISTS public.api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key text NOT NULL,
  used_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_key, used_date)
);
GRANT ALL ON public.api_usage TO service_role;
GRANT SELECT ON public.api_usage TO authenticated;
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read api usage" ON public.api_usage;
CREATE POLICY "admins read api usage" ON public.api_usage FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_word_usage_updated BEFORE UPDATE ON public.word_usage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_notifications_updated BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_api_usage_updated BEFORE UPDATE ON public.api_usage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Record word usage (called by web + public API)
CREATE OR REPLACE FUNCTION public.record_word_usage(p_words text[], p_direction text DEFAULT 'lao-to-karaoke')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_w text; v_dir text := CASE WHEN p_direction = 'karaoke-to-lao' THEN 'karaoke-to-lao' ELSE 'lao-to-karaoke' END;
BEGIN
  IF p_words IS NULL OR array_length(p_words, 1) IS NULL THEN RETURN json_build_object('ok', true, 'saved', 0); END IF;
  FOREACH v_w IN ARRAY p_words[1:200] LOOP
    v_w := trim(v_w);
    CONTINUE WHEN v_w = '' OR length(v_w) > 60;
    INSERT INTO public.word_usage (word, direction, count) VALUES (v_w, v_dir, 1)
    ON CONFLICT (word, direction, used_date) DO UPDATE SET count = public.word_usage.count + 1;
  END LOOP;
  RETURN json_build_object('ok', true);
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_word_usage(text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_word_usage(text[], text) TO anon, authenticated, service_role;

-- Public aggregated top words
CREATE OR REPLACE FUNCTION public.public_top_words(p_days integer DEFAULT 14, p_limit integer DEFAULT 50)
RETURNS TABLE(word text, direction text, uses bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.word, w.direction, sum(w.count)::bigint AS uses
  FROM public.word_usage w
  WHERE w.used_date > (now() AT TIME ZONE 'UTC')::date - least(greatest(coalesce(p_days, 14), 1), 90)
  GROUP BY w.word, w.direction
  ORDER BY uses DESC
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
REVOKE EXECUTE ON FUNCTION public.public_top_words(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_top_words(integer, integer) TO anon, authenticated, service_role;

-- Public daily series of total word usage
CREATE OR REPLACE FUNCTION public.public_word_usage_series(p_days integer DEFAULT 14)
RETURNS TABLE(day date, uses bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d::date AS day,
    (SELECT coalesce(sum(w.count), 0)::bigint FROM public.word_usage w WHERE w.used_date = d::date) AS uses
  FROM generate_series(
    (now() AT TIME ZONE 'UTC')::date - (least(greatest(coalesce(p_days, 14), 1), 90) - 1),
    (now() AT TIME ZONE 'UTC')::date, interval '1 day') d;
$$;
REVOKE EXECUTE ON FUNCTION public.public_word_usage_series(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_word_usage_series(integer) TO anon, authenticated, service_role;

-- Public API quota consumption
CREATE OR REPLACE FUNCTION public.api_consume(p_key text, p_limit integer DEFAULT 200)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text := substring(coalesce(nullif(trim(p_key), ''), 'anonymous') from 1 for 128);
        v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 200);
        v_count integer;
BEGIN
  SELECT count INTO v_count FROM public.api_usage WHERE client_key = v_key AND used_date = (now() AT TIME ZONE 'UTC')::date;
  v_count := coalesce(v_count, 0);
  IF v_count >= v_limit THEN
    RETURN json_build_object('allowed', false, 'limit', v_limit, 'used', v_count, 'remaining', 0);
  END IF;
  INSERT INTO public.api_usage (client_key, count) VALUES (v_key, 1)
  ON CONFLICT (client_key, used_date) DO UPDATE SET count = public.api_usage.count + 1
  RETURNING count INTO v_count;
  RETURN json_build_object('allowed', true, 'limit', v_limit, 'used', v_count, 'remaining', greatest(v_limit - v_count, 0));
END; $$;
REVOKE EXECUTE ON FUNCTION public.api_consume(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_consume(text, integer) TO anon, authenticated, service_role;

-- Admin audit log listing
CREATE OR REPLACE FUNCTION public.admin_list_audit_logs(p_limit integer DEFAULT 200)
RETURNS TABLE(id uuid, actor_email text, action text, target_email text, details jsonb, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT a.id, pa.email, a.action, pt.email, a.details, a.created_at
    FROM public.audit_logs a
    LEFT JOIN public.profiles pa ON pa.id = a.actor_id
    LEFT JOIN public.profiles pt ON pt.id = a.target_user_id
    ORDER BY a.created_at DESC
    LIMIT least(greatest(coalesce(p_limit, 200), 1), 500);
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_list_audit_logs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_audit_logs(integer) TO authenticated, service_role;

-- Mark my notifications read
CREATE OR REPLACE FUNCTION public.mark_notifications_read()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE public.notifications SET read_at = now() WHERE user_id = auth.uid() AND read_at IS NULL;
  RETURN json_build_object('ok', true);
END; $$;
REVOKE EXECUTE ON FUNCTION public.mark_notifications_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read() TO authenticated, service_role;

-- Review suggestion now writes notification + audit log
CREATE OR REPLACE FUNCTION public.admin_review_suggestion(p_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.word_suggestions%ROWTYPE; v_until timestamptz; v_start timestamptz := now();
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(coalesce(p_note, '')) > 300 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT * INTO r FROM public.word_suggestions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF r.status <> 'pending' THEN RETURN json_build_object('ok', false, 'error', 'already_reviewed'); END IF;

  UPDATE public.word_suggestions
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        admin_note = nullif(trim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = p_id;

  IF p_approve THEN
    SELECT greatest(coalesce(premium_until, now()), now()) INTO v_start FROM public.profiles WHERE id = r.user_id;
    v_until := v_start + interval '1 day';
    UPDATE public.profiles SET is_premium = true, premium_until = v_until WHERE id = r.user_id;

    INSERT INTO public.notifications (user_id, kind, title, body, meta)
    VALUES (r.user_id, 'suggestion_approved',
      'ຄຳສັບ "' || r.lao_word || '" ຖືກອະນຸມັດແລ້ວ',
      'ທ່ານໄດ້ຮັບ Premium ຟຣີ 1 ມື້',
      json_build_object('lao_word', r.lao_word, 'karaoke_word', r.karaoke_word,
        'premium_from', v_start, 'premium_until', v_until, 'admin_note', nullif(trim(p_note), ''))::jsonb);

    INSERT INTO public.audit_logs (actor_id, action, target_user_id, target_id, details)
    VALUES (auth.uid(), 'suggestion_approved', r.user_id, r.id,
      json_build_object('lao_word', r.lao_word, 'karaoke_word', r.karaoke_word, 'note', nullif(trim(p_note), ''))::jsonb);
    INSERT INTO public.audit_logs (actor_id, action, target_user_id, target_id, details)
    VALUES (auth.uid(), 'premium_granted', r.user_id, r.id,
      json_build_object('days', 1, 'premium_from', v_start, 'premium_until', v_until)::jsonb);
  ELSE
    INSERT INTO public.notifications (user_id, kind, title, body, meta)
    VALUES (r.user_id, 'suggestion_rejected',
      'ຄຳສັບ "' || r.lao_word || '" ບໍ່ຜ່ານການອະນຸມັດ',
      coalesce(nullif(trim(p_note), ''), 'ຂອບໃຈສຳລັບການສົ່ງຄຳສັບ'),
      json_build_object('lao_word', r.lao_word, 'karaoke_word', r.karaoke_word, 'admin_note', nullif(trim(p_note), ''))::jsonb);
    INSERT INTO public.audit_logs (actor_id, action, target_user_id, target_id, details)
    VALUES (auth.uid(), 'suggestion_rejected', r.user_id, r.id,
      json_build_object('lao_word', r.lao_word, 'note', nullif(trim(p_note), ''))::jsonb);
  END IF;
  RETURN json_build_object('ok', true, 'premium_from', v_start, 'premium_until', v_until);
END; $$;


-- ================= 20260727013632_dd2c7dd6-b891-477a-b9d6-03a670a0582e =================
CREATE OR REPLACE FUNCTION public.api_quota_status(p_key text, p_limit integer DEFAULT 200)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text := substring(coalesce(nullif(trim(p_key), ''), 'anonymous') from 1 for 128);
        v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 200);
        v_count integer;
BEGIN
  SELECT count INTO v_count FROM public.api_usage
   WHERE client_key = v_key AND used_date = (now() AT TIME ZONE 'UTC')::date;
  v_count := coalesce(v_count, 0);
  RETURN json_build_object('limit', v_limit, 'used', v_count, 'remaining', greatest(v_limit - v_count, 0));
END; $$;
REVOKE EXECUTE ON FUNCTION public.api_quota_status(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_quota_status(text, integer) TO anon, authenticated, service_role;


-- ================= 20260728022525_71a7f79d-85cd-4940-855c-d1a32cf3b18c =================
-- Admin/user-only functions must not be callable by signed-out visitors
REVOKE ALL ON FUNCTION public.admin_list_audit_logs(integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.mark_notifications_read() FROM anon, PUBLIC;

-- Internal trigger helpers should never be callable via the API
REVOKE ALL ON FUNCTION public.prevent_profile_privilege_escalation() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, PUBLIC;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='handle_new_user' AND pronamespace='public'::regnamespace) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC';
  END IF;
END $guard$;

-- Plain helper, no elevated privileges, but no need for anon access
REVOKE ALL ON FUNCTION public.is_valid_payment_plan(text, integer, integer, integer) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_payment_plan(text, integer, integer, integer) TO authenticated;

-- Keep only the intentional public API surface reachable without sign-in
GRANT EXECUTE ON FUNCTION public.api_consume(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_quota_status(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_top_words(integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_word_usage_series(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_word_usage(text[], text) TO anon, authenticated;


-- ================= 20260728022641_28c90b6d-63e2-40a3-a10f-66823940932a =================
REVOKE ALL ON FUNCTION public.api_consume(text, integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.api_quota_status(text, integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.record_word_usage(text[], text) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.public_top_words(integer, integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.public_word_usage_series(integer) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_word_usage(text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_top_words(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_word_usage_series(integer) TO authenticated;


-- ================= 20260728023048_b1599fb6-a609-4513-b000-7778bbdf4f93 =================
-- 1) Fix Lao-script detection (the plain string never expanded the \u escapes)
CREATE OR REPLACE FUNCTION public.submit_word_suggestion(p_lao text, p_karaoke text, p_note text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_lao text := trim(p_lao);
  v_kara text := lower(trim(p_karaoke));
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF length(v_lao) NOT BETWEEN 1 AND 100
     OR length(v_kara) NOT BETWEEN 1 AND 100
     OR length(coalesce(p_note, '')) > 300 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF v_lao !~ E'[\u0E80-\u0EFF]' THEN
    RETURN json_build_object('ok', false, 'error', 'not_lao');
  END IF;
  IF v_kara !~ E'^[a-z0-9 \'-]+$' THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_karaoke');
  END IF;
  IF EXISTS (SELECT 1 FROM public.word_suggestions w
             WHERE lower(w.lao_word) = lower(v_lao) AND w.status <> 'rejected') THEN
    RETURN json_build_object('ok', false, 'error', 'duplicate');
  END IF;
  IF (SELECT count(*) FROM public.word_suggestions w
      WHERE w.user_id = v_uid AND w.created_at > now() - interval '1 day') >= 20 THEN
    RETURN json_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  INSERT INTO public.word_suggestions (user_id, lao_word, karaoke_word, note)
  VALUES (v_uid, v_lao, v_kara, nullif(trim(p_note), ''))
  RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id);
END; $function$;

-- 2) Admin user list now includes today's free usage
DROP FUNCTION IF EXISTS public.admin_search_users(text);
CREATE FUNCTION public.admin_search_users(p_query text DEFAULT ''::text)
 RETURNS TABLE(id uuid, email text, full_name text, avatar_url text, is_premium boolean,
               premium_until timestamptz, extra_credits integer, created_at timestamptz,
               used_today integer, free_remaining integer, total_translations bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_limit constant integer := 15; v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT p.id, p.email, p.full_name, p.avatar_url, p.is_premium, p.premium_until,
           p.extra_credits, p.created_at,
           coalesce(d.count, 0)::integer AS used_today,
           CASE WHEN p.is_premium AND (p.premium_until IS NULL OR p.premium_until > now())
                THEN -1 ELSE greatest(v_limit - coalesce(d.count, 0), 0) END::integer AS free_remaining,
           coalesce((SELECT sum(u.count) FROM public.daily_usage u WHERE u.user_id = p.id), 0)::bigint AS total_translations
    FROM public.profiles p
    LEFT JOIN public.daily_usage d ON d.user_id = p.id AND d.used_date = v_today
    WHERE p_query = '' OR p.email ILIKE '%'||p_query||'%' OR p.full_name ILIKE '%'||p_query||'%'
    ORDER BY p.created_at DESC LIMIT 200;
END; $function$;

REVOKE ALL ON FUNCTION public.admin_search_users(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_word_suggestion(text, text, text) TO authenticated;


COMMIT;
NOTIFY pgrst, 'reload schema';
