
CREATE TABLE public.word_suggestions (
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

CREATE POLICY "own suggestions readable" ON public.word_suggestions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "approved suggestions public" ON public.word_suggestions
  FOR SELECT TO anon, authenticated USING (status = 'approved');

CREATE POLICY "admins read all suggestions" ON public.word_suggestions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX word_suggestions_unique_lao
  ON public.word_suggestions (lower(lao_word)) WHERE status <> 'rejected';
CREATE INDEX word_suggestions_status_idx ON public.word_suggestions (status, created_at DESC);

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
