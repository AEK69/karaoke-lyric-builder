
-- Translation history
CREATE TABLE public.translation_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  input_text TEXT NOT NULL,
  output_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.translation_history TO authenticated;
GRANT ALL ON public.translation_history TO service_role;
ALTER TABLE public.translation_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_history_select ON public.translation_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY own_history_insert ON public.translation_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY own_history_delete ON public.translation_history FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_th_user_created ON public.translation_history (user_id, created_at DESC);

-- Payment requests
CREATE TABLE public.payment_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  plan_label TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  premium_days INTEGER NOT NULL DEFAULT 0,
  slip_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  admin_note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.payment_requests TO authenticated;
GRANT ALL ON public.payment_requests TO service_role;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_payment_select ON public.payment_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY own_payment_insert ON public.payment_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_pr_status_created ON public.payment_requests (status, created_at DESC);

-- log_translation: insert history entry (called after successful translate)
CREATE OR REPLACE FUNCTION public.log_translation(p_direction TEXT, p_input TEXT, p_output TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  INSERT INTO public.translation_history (user_id, direction, input_text, output_text)
  VALUES (auth.uid(), p_direction, p_input, p_output) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- Admin approve payment: credits / premium days applied
CREATE OR REPLACE FUNCTION public.admin_approve_payment(p_id UUID, p_note TEXT DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_requests%ROWTYPE; v_until TIMESTAMPTZ;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO r FROM public.payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF r.status <> 'pending' THEN RETURN json_build_object('ok', false, 'error', 'already_reviewed'); END IF;

  IF r.credits > 0 THEN
    UPDATE public.profiles SET extra_credits = extra_credits + r.credits WHERE id = r.user_id;
  END IF;
  IF r.premium_days > 0 THEN
    SELECT GREATEST(COALESCE(premium_until, now()), now()) + (r.premium_days || ' days')::interval
    INTO v_until FROM public.profiles WHERE id = r.user_id;
    UPDATE public.profiles SET is_premium = true, premium_until = v_until WHERE id = r.user_id;
  END IF;
  UPDATE public.payment_requests SET status = 'approved', admin_note = p_note,
    reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reject_payment(p_id UUID, p_note TEXT DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.payment_requests SET status = 'rejected', admin_note = p_note,
    reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_id AND status = 'pending';
  RETURN json_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_credits(p_user UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.profiles SET extra_credits = 0 WHERE id = p_user;
  -- Also reset today's usage
  DELETE FROM public.daily_usage WHERE user_id = p_user AND used_date = (now() AT TIME ZONE 'UTC')::date;
  RETURN json_build_object('ok', true);
END; $$;

-- Admin list payments
CREATE OR REPLACE FUNCTION public.admin_list_payments(p_status TEXT DEFAULT 'pending')
RETURNS TABLE(id UUID, user_id UUID, email TEXT, full_name TEXT, amount INTEGER, plan_label TEXT,
  credits INTEGER, premium_days INTEGER, slip_url TEXT, status TEXT, admin_note TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT pr.id, pr.user_id, p.email, p.full_name, pr.amount, pr.plan_label,
      pr.credits, pr.premium_days, pr.slip_url, pr.status, pr.admin_note, pr.created_at
    FROM public.payment_requests pr
    LEFT JOIN public.profiles p ON p.id = pr.user_id
    WHERE p_status = 'all' OR pr.status = p_status
    ORDER BY pr.created_at DESC LIMIT 300;
END; $$;

-- Admin list topup codes
CREATE OR REPLACE FUNCTION public.admin_list_topup_codes(p_filter TEXT DEFAULT 'all')
RETURNS TABLE(id UUID, code TEXT, credits INTEGER, premium_days INTEGER, note TEXT,
  used_by UUID, used_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT c.id, c.code, c.credits, c.premium_days, c.note, c.used_by, c.used_at, c.expires_at, c.created_at
    FROM public.topup_codes c
    WHERE (p_filter = 'all')
       OR (p_filter = 'unused' AND c.used_by IS NULL AND (c.expires_at IS NULL OR c.expires_at > now()))
       OR (p_filter = 'used' AND c.used_by IS NOT NULL)
       OR (p_filter = 'expired' AND c.used_by IS NULL AND c.expires_at IS NOT NULL AND c.expires_at <= now())
    ORDER BY c.created_at DESC LIMIT 300;
END; $$;
