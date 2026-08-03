-- 0061 — Permit to Work HSE-review hardening (docs/reviews/permits-hse-expert-review.md).
-- PW-1: per-type gas limits + freshness window so the gas gate evaluates
--       readings instead of counting them; backfills the seeded
--       gas-requiring types that already exist in production.
-- PW-7: risk-assessment + method-statement links on the permit.
-- PW-8: workers (the gang) + entry/exit log.
-- PW-10: pre-expiry warning stamp.
ALTER TABLE "permit_types" ADD COLUMN IF NOT EXISTS "gas_limits" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "permit_types" ADD COLUMN IF NOT EXISTS "gas_test_max_age_minutes" integer DEFAULT 60 NOT NULL;
--> statement-breakpoint
ALTER TABLE "permit_types" ADD COLUMN IF NOT EXISTS "requires_risk_assessment" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "risk_assessment_id" varchar(26);
--> statement-breakpoint
ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "method_statement_document_id" varchar(26);
--> statement-breakpoint
ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "workers" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "entry_log" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "expiry_warning_sent_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permits" ADD CONSTRAINT "permits_risk_assessment_id_risk_assessments_id_fk" FOREIGN KEY ("risk_assessment_id") REFERENCES "risk_assessments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permits" ADD CONSTRAINT "permits_method_statement_document_id_documents_id_fk" FOREIGN KEY ("method_statement_document_id") REFERENCES "documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Backfill the seeded (is_system) gas-requiring types that predate PW-1 so
-- existing tenants get evaluable limits without re-seeding. Idempotent:
-- only rows still carrying the empty default are touched.
UPDATE "permit_types" SET "gas_limits" = '[{"id":"flammables_lel","label":"Flammables (LEL)","unit":"percent_lel","min":null,"max":10}]'::jsonb
 WHERE "is_system" = true AND "category" = 'hot_work' AND "gas_limits" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "permit_types" SET "gas_limits" = '[{"id":"oxygen","label":"Oxygen (O₂)","unit":"percent_o2","min":19.5,"max":23.5},{"id":"flammables_lel","label":"Flammables (LEL)","unit":"percent_lel","min":null,"max":10},{"id":"carbon_monoxide","label":"Carbon monoxide (CO)","unit":"ppm","min":null,"max":30}]'::jsonb,
 "gas_test_max_age_minutes" = 30
 WHERE "is_system" = true AND "category" = 'confined_space' AND "gas_limits" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "permit_types" SET "gas_limits" = '[{"id":"oxygen","label":"Oxygen (O₂)","unit":"percent_o2","min":19.5,"max":23.5},{"id":"flammables_lel","label":"Flammables (LEL)","unit":"percent_lel","min":null,"max":10}]'::jsonb
 WHERE "is_system" = true AND "category" = 'excavation' AND "gas_limits" = '[]'::jsonb;
