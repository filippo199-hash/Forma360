-- 0073 — Remove the Assets maintenance feature entirely
--
-- The maintenance plans/programs sub-feature of the Assets module is being
-- withdrawn from the product. Its router, UI, workers, permission key and
-- i18n have all been deleted; this migration drops the five now-orphaned
-- tables it owned.
--
-- These tables are a self-contained subgraph: FKs run between them and
-- outward to `tenants` / `assets` only — nothing outside points in — so the
-- drop cannot cascade into any surviving table's rows. `IF EXISTS` keeps it
-- idempotent; `CASCADE` clears the intra-subgraph FKs and indexes.
--
-- Created (and now removed): maintenance_plans / maintenance_plan_assets in
-- 0014_phase5.sql; maintenance_programs / maintenance_program_triggers /
-- maintenance_program_assets in 0034_maintenance_programs.sql.
DROP TABLE IF EXISTS "maintenance_program_assets" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "maintenance_program_triggers" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "maintenance_programs" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "maintenance_plan_assets" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "maintenance_plans" CASCADE;
