-- Document-level visibility by group / site (To-Do #5). Mirrors the
-- existing folder visibility columns. Empty arrays = visible to everyone.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "visible_to_group_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "visible_to_site_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
