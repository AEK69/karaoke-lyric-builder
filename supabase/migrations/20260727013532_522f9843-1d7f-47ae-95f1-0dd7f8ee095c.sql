CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- 1. Word usage stats
CREATE TABLE public.word_usage (
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
CREATE POLICY "admins read word usage" ON public.word_usage FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_word_usage_date ON public.word_usage (used_date DESC);

-- 2. Notifications
CREATE TABLE public.notifications (
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
CREATE POLICY "own notifications read" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own notifications update" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX idx_notifications_user ON public.notifications (user_id, created_at DESC);

-- 3. Audit log
CREATE TABLE public.audit_logs (
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
CREATE POLICY "admins read audit logs" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_audit_logs_created ON public.audit_logs (created_at DESC);

-- 4. Public API quota
CREATE TABLE public.api_usage (
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

NOTIFY pgrst, 'reload schema';