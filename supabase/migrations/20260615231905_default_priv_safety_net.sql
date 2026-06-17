-- Anti-leak safety net. PostgreSQL grants EXECUTE to PUBLIC (which includes the
-- anonymous role) on every newly created function by default, and Supabase
-- grants the anon role table access on newly created tables. That default is
-- exactly how unauthenticated clients could "probe" the backend. Flip the
-- defaults so any object added later is closed until explicitly opened.

-- Future functions are not callable by PUBLIC/anon unless granted explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Future tables are not reachable by the anonymous role at all.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
