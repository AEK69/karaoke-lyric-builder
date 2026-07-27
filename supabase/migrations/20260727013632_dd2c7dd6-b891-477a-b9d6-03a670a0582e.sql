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

NOTIFY pgrst, 'reload schema';