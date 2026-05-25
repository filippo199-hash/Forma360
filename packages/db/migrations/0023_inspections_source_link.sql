-- 0023_inspections_source_link.sql
-- Adds source_type / source_id nullable columns so an inspection can be
-- linked back to the entity that triggered it (e.g. sourceType='issue').
-- Existing rows stay NULL (no backfill needed — historical inspections
-- were not started from observations).

ALTER TABLE "inspections" ADD COLUMN IF NOT EXISTS "source_type" text;
ALTER TABLE "inspections" ADD COLUMN IF NOT EXISTS "source_id" varchar(26);
CREATE INDEX IF NOT EXISTS "inspections_source_idx"
  ON "inspections" ("tenant_id", "source_type", "source_id");
