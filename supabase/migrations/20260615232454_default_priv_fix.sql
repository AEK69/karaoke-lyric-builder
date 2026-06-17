-- Correctly close default privileges so future objects can't be probed by
-- unauthenticated clients. Supabase seeds default ACLs (per creating role) that
-- explicitly grant anon/PUBLIC; the previous generic REVOKE missed them. Target
-- each role that creates objects in `public` and revoke anon + PUBLIC.
DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
EXCEPTION WHEN OTHERS THEN NULL;  -- skip if not permitted to alter supabase_admin defaults
END $$;
