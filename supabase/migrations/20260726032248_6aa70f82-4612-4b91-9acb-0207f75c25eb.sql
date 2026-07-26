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
