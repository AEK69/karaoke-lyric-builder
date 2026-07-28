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

NOTIFY pgrst, 'reload schema';