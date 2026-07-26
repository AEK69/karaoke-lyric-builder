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
