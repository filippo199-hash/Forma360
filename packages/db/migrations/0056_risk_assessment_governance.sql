-- 0056 — Risk Assessment governance (FreeHS module B1, practitioner
-- feedback round 2).
--   P-2  hazards gain residual_justification (tolerability note)
--   P-4  per-tenant matrix settings (thresholds + severity floors)
--   A-1/M-2/M-3  immutable published versions with first-class sign-off
--   A-3  acknowledgement deadline + reminder stamp
--   A-4  variant fork timestamp for drift detection
--   M-1  review clock anchored to publish — drafts lose their premature
--        next-review date
ALTER TABLE "risk_assessments" ADD COLUMN IF NOT EXISTS "current_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN IF NOT EXISTS "forked_from_parent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN IF NOT EXISTS "content_updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "risk_assessment_hazards" ADD COLUMN IF NOT EXISTS "residual_justification" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "risk_assessment_acknowledgements" ADD COLUMN IF NOT EXISTS "version_number" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "risk_assessment_acknowledgements" ADD COLUMN IF NOT EXISTS "acknowledged_version" integer;
--> statement-breakpoint
ALTER TABLE "risk_assessment_acknowledgements" ADD COLUMN IF NOT EXISTS "due_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "risk_assessment_acknowledgements" ADD COLUMN IF NOT EXISTS "last_reminder_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_assessment_versions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"assessment_id" varchar(26) NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"signed_off_by" text NOT NULL,
	"signed_off_by_name" text,
	"signed_off_at" timestamp with time zone NOT NULL,
	"actions_created" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_versions" ADD CONSTRAINT "risk_assessment_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_versions" ADD CONSTRAINT "risk_assessment_versions_assessment_id_risk_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ra_versions_assessment_version_idx" ON "risk_assessment_versions" ("assessment_id","version_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ra_versions_tenant_idx" ON "risk_assessment_versions" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_risk_matrix_settings" (
	"tenant_id" varchar(26) PRIMARY KEY NOT NULL,
	"low_max" integer DEFAULT 4 NOT NULL,
	"medium_max" integer DEFAULT 9 NOT NULL,
	"high_max" integer DEFAULT 15 NOT NULL,
	"severity_floors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_risk_matrix_settings" ADD CONSTRAINT "tenant_risk_matrix_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- M-1: the review clock must start at publish, not creation. Drafts that
-- have never been live lose the next-review date they were stamped with
-- at creation; their frequency stays so publish can compute the real one.
UPDATE "risk_assessments" SET "next_review_at" = NULL WHERE "status" = 'draft' AND "published_at" IS NULL;
--> statement-breakpoint
-- Rows acknowledged before versioning existed acknowledged what was then
-- the only version (1).
UPDATE "risk_assessment_acknowledgements" SET "acknowledged_version" = 1 WHERE "acknowledged_at" IS NOT NULL;
