-- Dashboard view counter (ADR 0018 follow-up).
--
-- A running count of how many times a dashboard has been opened, shown on
-- the dashboards home card. Additive + backward-compatible: existing rows
-- default to 0.

ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "view_count" integer DEFAULT 0 NOT NULL;
