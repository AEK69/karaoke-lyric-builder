
-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  premium_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_profile_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own_profile_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "own_profile_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Daily usage
CREATE TABLE public.daily_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, used_date)
);
GRANT SELECT ON public.daily_usage TO authenticated;
GRANT ALL ON public.daily_usage TO service_role;
ALTER TABLE public.daily_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_usage_select" ON public.daily_usage FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RPC: try to consume one translation. Returns json: { allowed, remaining, is_premium, used }
CREATE OR REPLACE FUNCTION public.try_consume_translation(p_limit INTEGER DEFAULT 10)
RETURNS JSON AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_premium BOOLEAN := false;
  v_premium_until TIMESTAMPTZ;
  v_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT is_premium, premium_until INTO v_premium, v_premium_until
  FROM public.profiles WHERE id = v_uid;

  IF v_premium AND (v_premium_until IS NULL OR v_premium_until > now()) THEN
    INSERT INTO public.daily_usage (user_id, used_date, count)
    VALUES (v_uid, v_today, 1)
    ON CONFLICT (user_id, used_date)
    DO UPDATE SET count = public.daily_usage.count + 1
    RETURNING count INTO v_count;
    RETURN json_build_object('allowed', true, 'is_premium', true, 'used', v_count, 'remaining', -1);
  END IF;

  SELECT count INTO v_count FROM public.daily_usage WHERE user_id = v_uid AND used_date = v_today;
  v_count := COALESCE(v_count, 0);

  IF v_count >= p_limit THEN
    RETURN json_build_object('allowed', false, 'is_premium', false, 'used', v_count, 'remaining', 0);
  END IF;

  INSERT INTO public.daily_usage (user_id, used_date, count)
  VALUES (v_uid, v_today, 1)
  ON CONFLICT (user_id, used_date)
  DO UPDATE SET count = public.daily_usage.count + 1
  RETURNING count INTO v_count;

  RETURN json_build_object('allowed', true, 'is_premium', false, 'used', v_count, 'remaining', p_limit - v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.try_consume_translation(INTEGER) TO authenticated;
