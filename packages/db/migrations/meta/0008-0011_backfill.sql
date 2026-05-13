-- Backfill drizzle.__drizzle_migrations for entries 0008–0011.
--
-- Why this file exists: when migrations 0008_invitations,
-- 0009_signature_workflow, 0010_issues and 0011_observations_richer
-- were authored, their tags were not added to packages/db/migrations/meta/_journal.json.
-- That meant `drizzle-kit migrate` (run on every deploy) silently skipped
-- them, so the schema on prod never matched the codebase. PR-3
-- (Observations richer detail page) surfaced the gap when `INSERT INTO
-- issue_categories ... enabled_built_in_fields` failed with "column does
-- not exist".
--
-- Fix:
--   1. The migration SQL was applied manually via the Railway Postgres
--      SQL console on 2026-05-13.
--   2. The journal was patched to include all four entries so future
--      deploys see the full set.
--   3. drizzle's `__drizzle_migrations` ledger needs a row per migration
--      so the next `drizzle-kit migrate` doesn't try to re-apply them
--      (those CREATE TABLE statements would now fail with "relation
--      already exists" and abort the deploy).
--
-- Run this once on prod (Railway → Postgres → Data → SQL). Idempotent;
-- the `WHERE NOT EXISTS` guard makes re-runs safe.

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'cdec4b84bb1cc0568b8543a0bf3acf93b2c8afb7a5e31594affb0623b0530d1d', 1777800000000
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations
  WHERE hash = 'cdec4b84bb1cc0568b8543a0bf3acf93b2c8afb7a5e31594affb0623b0530d1d'
);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '258b42d953fb31b6d62227d73c19e8c4649b8b59866c92377316e1fa1fbfefa5', 1778000000000
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations
  WHERE hash = '258b42d953fb31b6d62227d73c19e8c4649b8b59866c92377316e1fa1fbfefa5'
);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'a080fe79a861ce40fe808b422ea4db184cb2d43e6f6482c12b87392c8eaef2b3', 1778200000000
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations
  WHERE hash = 'a080fe79a861ce40fe808b422ea4db184cb2d43e6f6482c12b87392c8eaef2b3'
);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'b335cf3247abfefd1a0dc0334c6c678df1216fe30c3743cb9d498964870a73d0', 1778400000000
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations
  WHERE hash = 'b335cf3247abfefd1a0dc0334c6c678df1216fe30c3743cb9d498964870a73d0'
);
