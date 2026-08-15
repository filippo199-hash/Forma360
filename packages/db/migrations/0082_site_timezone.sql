-- BUG-14, per-site: which clock a printed document is stamped in.
--
-- The first fix stamped every document in one deployment-wide APP_TIMEZONE,
-- which is right for a single-country operator and wrong the moment a
-- customer runs sites in more than one zone — their Frankfurt permit would
-- print London time, the same defect with a different offset.
--
-- Null means "inherit the tenant default" (tenants.settings.timezone), which
-- itself falls back to APP_TIMEZONE. So existing rows are unaffected.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "timezone" text;
