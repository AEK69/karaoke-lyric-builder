-- Community ticker for the translate page: total member count + a list of
-- member display names, with premium members flagged and their premium expiry
-- exposed so the client can show a live countdown.
--
-- profiles is normally readable only by its owner (own_profile_select RLS), so
-- this SECURITY DEFINER aggregator is the only way a signed-in user can see the
-- community list. It deliberately exposes ONLY a display name (full_name, else
-- the email local-part, never the full email) and premium status/expiry.

CREATE OR REPLACE FUNCTION public.community_ticker()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total_users', (SELECT count(*) FROM public.profiles),
    'premium_users', (
      SELECT count(*) FROM public.profiles
      WHERE is_premium AND (premium_until IS NULL OR premium_until > now())
    ),
    'members', COALESCE((
      SELECT json_agg(m) FROM (
        SELECT
          COALESCE(NULLIF(btrim(p.full_name), ''), split_part(p.email, '@', 1), 'ຜູ້ໃຊ້') AS name,
          (p.is_premium AND (p.premium_until IS NULL OR p.premium_until > now())) AS is_premium,
          CASE
            WHEN p.is_premium AND p.premium_until IS NOT NULL AND p.premium_until > now()
            THEN p.premium_until
            ELSE NULL
          END AS premium_until
        FROM public.profiles p
        ORDER BY
          (p.is_premium AND (p.premium_until IS NULL OR p.premium_until > now())) DESC,
          p.created_at DESC
        LIMIT 60
      ) m
    ), '[]'::json)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.community_ticker() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_ticker() TO authenticated, service_role;
