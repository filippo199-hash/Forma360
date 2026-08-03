-- Platform HSE review, Wave F (field usability).
-- PF-19: versioned contractor induction + version-aware acknowledgement.
CREATE TABLE IF NOT EXISTS "contractor_induction_config" (
  "tenant_id" varchar(26) PRIMARY KEY REFERENCES "tenants"("id") ON DELETE restrict,
  "body" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "updated_by" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "contractor_users" ADD COLUMN IF NOT EXISTS "acknowledged_version" integer;
--> statement-breakpoint
-- PF-11: anonymous QR reports can now attach photos — no user to credit.
ALTER TABLE "issue_attachments" ALTER COLUMN "uploaded_by_user_id" DROP NOT NULL;
--> statement-breakpoint
-- PF-17 + PF-10 touch the FreeHS brand-module tables (fire safety, COSHH).
-- Guarded with to_regclass so the statements are no-ops on a database that
-- never ran the brand-module migrations (e.g. the pinned-migration test
-- harnesses); on the real chain 0055/0060 always precede this file.
DO $$ BEGIN
  IF to_regclass('fire_logbook_checks') IS NOT NULL THEN
    ALTER TABLE "fire_logbook_checks" ADD COLUMN IF NOT EXISTS "asset_id" varchar(26) REFERENCES "assets"("id") ON DELETE set null;
    CREATE INDEX IF NOT EXISTS "fire_logbook_checks_tenant_asset_idx" ON "fire_logbook_checks" ("tenant_id","asset_id");
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF to_regclass('fire_logbook_entries') IS NOT NULL THEN
    ALTER TABLE "fire_logbook_entries" ADD COLUMN IF NOT EXISTS "client_request_id" varchar(26);
    CREATE UNIQUE INDEX IF NOT EXISTS "fire_logbook_entries_client_req_idx" ON "fire_logbook_entries" ("tenant_id","client_request_id") WHERE "client_request_id" IS NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF to_regclass('coshh_assessments') IS NOT NULL THEN
    ALTER TABLE "coshh_assessments" ADD COLUMN IF NOT EXISTS "client_request_id" varchar(26);
    CREATE UNIQUE INDEX IF NOT EXISTS "coshh_assessments_client_req_idx" ON "coshh_assessments" ("tenant_id","client_request_id") WHERE "client_request_id" IS NOT NULL;
  END IF;
END $$;
