-- ─── DEFAULT PRIVILEGES: no table left public by default ──────
-- Hardens already-deployed databases the same way scripts/schema.sql now
-- does for fresh installs. Safe to run any number of times — REVOKE on
-- something already unprivileged is a no-op — and does not touch the
-- table owner's (the app's DB user) own rights.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
