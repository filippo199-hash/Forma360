-- CT-G06 (contractors audit): bind the kiosk gate token to a SITE.
--
-- `contractor_gate_config` was keyed on tenant_id, so one token unlocked
-- every reception screen in the company. Consequences, all real:
--   * every kiosk listed every site's contractor arrivals — names,
--     companies, times — with no session;
--   * any kiosk could admit a visit booked for a different site;
--   * revocation was all-or-nothing: regenerating the token for one
--     compromised screen killed every other screen in the business.
--
-- Backward compatibility is the whole design of this migration. A
-- NULLABLE site_id means the row that exists today keeps working exactly
-- as it does now — it is simply "the tenant-wide token" — so no live
-- kiosk stops working the moment this deploys. Sites get their own rows
-- as administrators create them, and a tenant can retire the legacy row
-- once every screen has a site-specific token.
--
-- Two partial unique indexes rather than one composite: Postgres treats
-- NULLs as distinct in a normal unique index, so (tenant_id, site_id)
-- alone would happily allow ten tenant-wide rows for the same tenant.

-- 1. The new surrogate key. Backfilled before it becomes the PK.
ALTER TABLE "contractor_gate_config" ADD COLUMN IF NOT EXISTS "id" varchar(26);
--> statement-breakpoint
ALTER TABLE "contractor_gate_config" ADD COLUMN IF NOT EXISTS "site_id" varchar(26);
--> statement-breakpoint

-- 2. Backfill ids for the rows that already exist. ULIDs are minted in the
--    app; here any collision-free 26-char value is fine, and these rows are
--    rewritten by the app the next time a token is regenerated.
UPDATE "contractor_gate_config"
SET "id" = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 26))
WHERE "id" IS NULL;
--> statement-breakpoint
ALTER TABLE "contractor_gate_config" ALTER COLUMN "id" SET NOT NULL;
--> statement-breakpoint

-- 3. Move the primary key from tenant_id to id, so a tenant may hold more
--    than one gate config (one per site, plus the legacy tenant-wide row).
DO $$ BEGIN
  ALTER TABLE "contractor_gate_config" DROP CONSTRAINT "contractor_gate_config_pkey";
EXCEPTION WHEN undefined_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "contractor_gate_config" ADD CONSTRAINT "contractor_gate_config_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
ALTER TABLE "contractor_gate_config" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "contractor_gate_config" ADD CONSTRAINT "contractor_gate_config_site_id_fk"
   FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- 4. A token must resolve to exactly one config, or the kiosk lookup is
--    ambiguous — which is a security property, not a tidiness one.
CREATE UNIQUE INDEX IF NOT EXISTS "contractor_gate_config_token_idx"
  ON "contractor_gate_config" ("gate_token");
--> statement-breakpoint

-- 5. One legacy tenant-wide row per tenant …
CREATE UNIQUE INDEX IF NOT EXISTS "contractor_gate_config_tenant_legacy_uq"
  ON "contractor_gate_config" ("tenant_id") WHERE "site_id" IS NULL;
--> statement-breakpoint
-- … and one row per (tenant, site).
CREATE UNIQUE INDEX IF NOT EXISTS "contractor_gate_config_tenant_site_uq"
  ON "contractor_gate_config" ("tenant_id", "site_id") WHERE "site_id" IS NOT NULL;
