-- Sites → Sites/Projects. A "project" is a site with a lifecycle: the same
-- table, access model and hierarchy, plus a discriminator and optional
-- time-bound fields. Sites leave the project fields null. `kind` defaults to
-- 'site' so every existing row keeps its meaning. A project may parent-link to
-- a physical site via the existing `parent_id` (the "Both" case) for free.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'site';
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "client" text;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "start_date" date;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "end_date" date;
CREATE INDEX IF NOT EXISTS "sites_tenant_kind_idx" ON "sites" ("tenant_id", "kind");
