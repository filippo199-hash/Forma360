-- 0055 — COSHH (FreeHS module B2).
-- Substance inventory (by location, with storage classes), versioned safety
-- data sheets, task-level COSHH assessments with hierarchy-of-control
-- entries, exposure monitoring vs WELs, the LEV register + thorough
-- examination & test log, and the append-only module event log.
CREATE TABLE IF NOT EXISTS "coshh_substances" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"reference_number" text,
	"name" text NOT NULL,
	"supplier" text DEFAULT '' NOT NULL,
	"product_identifier" text DEFAULT '' NOT NULL,
	"physical_form" text,
	"usage_description" text DEFAULT '' NOT NULL,
	"signal_word" text,
	"hazard_classification" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"h_statements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"p_statements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pictograms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"workplace_exposure_limits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_carcinogen" boolean DEFAULT false NOT NULL,
	"is_mutagen" boolean DEFAULT false NOT NULL,
	"is_asthmagen" boolean DEFAULT false NOT NULL,
	"is_biological_agent" boolean DEFAULT false NOT NULL,
	"contains_lead" boolean DEFAULT false NOT NULL,
	"asbestos_referral" boolean DEFAULT false NOT NULL,
	"substitution_status" text DEFAULT 'not_assessed' NOT NULL,
	"substitution_notes" text DEFAULT '' NOT NULL,
	"sds_review_months" integer DEFAULT 36 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_substances" ADD CONSTRAINT "coshh_substances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_substances_tenant_status_idx" ON "coshh_substances" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_substances_tenant_name_idx" ON "coshh_substances" ("tenant_id","name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coshh_substance_locations" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"substance_id" varchar(26) NOT NULL,
	"site_id" varchar(26),
	"location_text" text DEFAULT '' NOT NULL,
	"quantity" real,
	"unit" text,
	"storage_class" text,
	"storage_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_substance_locations" ADD CONSTRAINT "coshh_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_substance_locations" ADD CONSTRAINT "coshh_locations_substance_id_fk" FOREIGN KEY ("substance_id") REFERENCES "coshh_substances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_substance_locations" ADD CONSTRAINT "coshh_locations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_locations_substance_idx" ON "coshh_substance_locations" ("substance_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_locations_tenant_site_idx" ON "coshh_substance_locations" ("tenant_id","site_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coshh_sds_documents" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"substance_id" varchar(26) NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"issue_date" timestamp with time zone,
	"review_by_date" timestamp with time zone,
	"extraction" jsonb,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_sds_documents" ADD CONSTRAINT "coshh_sds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_sds_documents" ADD CONSTRAINT "coshh_sds_substance_id_fk" FOREIGN KEY ("substance_id") REFERENCES "coshh_substances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coshh_sds_substance_version_uq" ON "coshh_sds_documents" ("substance_id","version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_sds_substance_idx" ON "coshh_sds_documents" ("substance_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coshh_assessments" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"substance_id" varchar(26) NOT NULL,
	"reference_number" text,
	"task_description" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"routes_of_exposure" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"persons_exposed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"persons_count" integer,
	"quantity_band" text,
	"frequency_band" text,
	"duration_band" text,
	"lev_required" boolean DEFAULT false NOT NULL,
	"health_surveillance_required" boolean DEFAULT false NOT NULL,
	"exposure_monitoring_required" boolean DEFAULT false NOT NULL,
	"emergency_notes" text DEFAULT '' NOT NULL,
	"plain_summary" text DEFAULT '' NOT NULL,
	"assessor_user_id" text,
	"review_frequency_months" integer,
	"next_review_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"last_reviewed_by" text,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_assessments" ADD CONSTRAINT "coshh_assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_assessments" ADD CONSTRAINT "coshh_assessments_substance_id_fk" FOREIGN KEY ("substance_id") REFERENCES "coshh_substances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_assessments_tenant_status_idx" ON "coshh_assessments" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_assessments_substance_idx" ON "coshh_assessments" ("substance_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_assessments_tenant_review_idx" ON "coshh_assessments" ("tenant_id","next_review_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coshh_assessment_controls" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"assessment_id" varchar(26) NOT NULL,
	"tier" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'in_place' NOT NULL,
	"ppe_justification" text,
	"action_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_assessment_controls" ADD CONSTRAINT "coshh_controls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_assessment_controls" ADD CONSTRAINT "coshh_controls_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "coshh_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_controls_assessment_idx" ON "coshh_assessment_controls" ("assessment_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coshh_exposure_monitoring" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"substance_id" varchar(26) NOT NULL,
	"agent" text NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"sample_type" text DEFAULT 'personal' NOT NULL,
	"period" text NOT NULL,
	"result_value" real NOT NULL,
	"result_unit" text NOT NULL,
	"exceeds_wel" boolean,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_exposure_monitoring" ADD CONSTRAINT "coshh_monitoring_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_exposure_monitoring" ADD CONSTRAINT "coshh_monitoring_substance_id_fk" FOREIGN KEY ("substance_id") REFERENCES "coshh_substances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_monitoring_substance_idx" ON "coshh_exposure_monitoring" ("substance_id","sampled_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coshh_lev_units" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"site_id" varchar(26),
	"location_text" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"test_interval_months" integer DEFAULT 14 NOT NULL,
	"last_test_at" timestamp with time zone,
	"next_test_due_at" timestamp with time zone,
	"status" text DEFAULT 'in_service' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_lev_units" ADD CONSTRAINT "coshh_lev_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_lev_units" ADD CONSTRAINT "coshh_lev_units_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_lev_units_tenant_status_idx" ON "coshh_lev_units" ("tenant_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coshh_lev_tests" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"lev_unit_id" varchar(26) NOT NULL,
	"tested_at" timestamp with time zone NOT NULL,
	"result" text NOT NULL,
	"examiner" text DEFAULT '' NOT NULL,
	"report_storage_key" text,
	"defects_summary" text DEFAULT '' NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_lev_tests" ADD CONSTRAINT "coshh_lev_tests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_lev_tests" ADD CONSTRAINT "coshh_lev_tests_unit_id_fk" FOREIGN KEY ("lev_unit_id") REFERENCES "coshh_lev_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_lev_tests_unit_idx" ON "coshh_lev_tests" ("lev_unit_id","tested_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coshh_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar(26) NOT NULL,
	"actor_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_events" ADD CONSTRAINT "coshh_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_events_entity_idx" ON "coshh_events" ("tenant_id","entity_type","entity_id","created_at");
