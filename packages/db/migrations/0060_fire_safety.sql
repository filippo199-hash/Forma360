-- 0058 — Fire Safety (FreeHS module B3).
-- Buildings with their statutory duty profile, fire risk assessments with
-- significant findings and the append-only review log, the fire safety
-- logbook (check calendar + entries), fire doors as inspectable assets,
-- drills, PEEPs, the marshal register, and the module event log.
CREATE TABLE IF NOT EXISTS "fire_buildings" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"site_id" varchar(26),
	"address" text DEFAULT '' NOT NULL,
	"use_description" text DEFAULT '' NOT NULL,
	"is_residential" boolean DEFAULT false NOT NULL,
	"height_metres" real,
	"storeys" integer,
	"has_fire_alarm" boolean DEFAULT true NOT NULL,
	"has_emergency_lighting" boolean DEFAULT true NOT NULL,
	"has_sprinklers" boolean DEFAULT false NOT NULL,
	"has_dampers" boolean DEFAULT false NOT NULL,
	"has_risers" boolean DEFAULT false NOT NULL,
	"external_wall_system" text DEFAULT '' NOT NULL,
	"compartmentation_notes" text DEFAULT '' NOT NULL,
	"means_of_escape_notes" text DEFAULT '' NOT NULL,
	"service_risers_notes" text DEFAULT '' NOT NULL,
	"secure_info_box_location" text DEFAULT '' NOT NULL,
	"info_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_buildings" ADD CONSTRAINT "fire_buildings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_buildings" ADD CONSTRAINT "fire_buildings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_buildings_tenant_status_idx" ON "fire_buildings" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_buildings_tenant_name_idx" ON "fire_buildings" ("tenant_id","name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_risk_assessments" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"building_id" varchar(26),
	"reference_number" text,
	"title" text NOT NULL,
	"premises_description" text DEFAULT '' NOT NULL,
	"methodology" text DEFAULT 'pas79' NOT NULL,
	"responsible_person_name" text DEFAULT '' NOT NULL,
	"assessor_user_id" text,
	"assessor_name" text DEFAULT '' NOT NULL,
	"persons_at_risk" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_occupancy" integer,
	"sleeping_occupants" boolean DEFAULT false NOT NULL,
	"ignition_sources" text DEFAULT '' NOT NULL,
	"fuel_sources" text DEFAULT '' NOT NULL,
	"oxygen_sources" text DEFAULT '' NOT NULL,
	"evaluation_notes" text DEFAULT '' NOT NULL,
	"risk_rating" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"review_frequency_months" integer,
	"next_review_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"last_reviewed_by" text,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_risk_assessments" ADD CONSTRAINT "fire_fras_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_risk_assessments" ADD CONSTRAINT "fire_fras_building_id_fire_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "fire_buildings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_fras_tenant_status_idx" ON "fire_risk_assessments" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_fras_tenant_review_idx" ON "fire_risk_assessments" ("tenant_id","next_review_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_fras_building_idx" ON "fire_risk_assessments" ("building_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_significant_findings" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"fra_id" varchar(26) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"category" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"description" text NOT NULL,
	"requires_action" boolean DEFAULT true NOT NULL,
	"action_id" varchar(26),
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_significant_findings" ADD CONSTRAINT "fire_findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_significant_findings" ADD CONSTRAINT "fire_findings_fra_id_fire_risk_assessments_id_fk" FOREIGN KEY ("fra_id") REFERENCES "fire_risk_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_findings_fra_idx" ON "fire_significant_findings" ("fra_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_fra_reviews" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"fra_id" varchar(26) NOT NULL,
	"trigger" text NOT NULL,
	"outcome" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reviewed_by" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_fra_reviews" ADD CONSTRAINT "fire_fra_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_fra_reviews" ADD CONSTRAINT "fire_fra_reviews_fra_id_fire_risk_assessments_id_fk" FOREIGN KEY ("fra_id") REFERENCES "fire_risk_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_fra_reviews_fra_idx" ON "fire_fra_reviews" ("fra_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_logbook_checks" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"building_id" varchar(26) NOT NULL,
	"check_type" text NOT NULL,
	"frequency" text NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"assigned_to_user_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"last_done_at" timestamp with time zone,
	"next_due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_logbook_checks" ADD CONSTRAINT "fire_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_logbook_checks" ADD CONSTRAINT "fire_checks_building_id_fire_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "fire_buildings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fire_checks_building_type_uq" ON "fire_logbook_checks" ("building_id","check_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_checks_tenant_due_idx" ON "fire_logbook_checks" ("tenant_id","next_due_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_logbook_entries" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"building_id" varchar(26) NOT NULL,
	"check_id" varchar(26),
	"check_type" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"performed_by" text NOT NULL,
	"result" text NOT NULL,
	"call_point_ref" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"defects_summary" text DEFAULT '' NOT NULL,
	"action_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_logbook_entries" ADD CONSTRAINT "fire_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_logbook_entries" ADD CONSTRAINT "fire_entries_building_id_fire_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "fire_buildings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_logbook_entries" ADD CONSTRAINT "fire_entries_check_id_fire_logbook_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "fire_logbook_checks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_entries_building_time_idx" ON "fire_logbook_entries" ("building_id","performed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_entries_tenant_time_idx" ON "fire_logbook_entries" ("tenant_id","performed_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_doors" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"building_id" varchar(26) NOT NULL,
	"door_ref" text NOT NULL,
	"location_kind" text DEFAULT 'other' NOT NULL,
	"floor" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rating_minutes" integer,
	"self_closing" boolean DEFAULT true NOT NULL,
	"inspection_interval_months_override" integer,
	"last_inspected_at" timestamp with time zone,
	"next_inspection_due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_doors" ADD CONSTRAINT "fire_doors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_doors" ADD CONSTRAINT "fire_doors_building_id_fire_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "fire_buildings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_doors_building_status_idx" ON "fire_doors" ("building_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_doors_tenant_due_idx" ON "fire_doors" ("tenant_id","next_inspection_due_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_door_inspections" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"door_id" varchar(26) NOT NULL,
	"inspected_at" timestamp with time zone NOT NULL,
	"inspected_by" text NOT NULL,
	"outcome" text NOT NULL,
	"checklist" jsonb,
	"defects_summary" text DEFAULT '' NOT NULL,
	"action_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_door_inspections" ADD CONSTRAINT "fire_door_inspections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_door_inspections" ADD CONSTRAINT "fire_door_inspections_door_id_fire_doors_id_fk" FOREIGN KEY ("door_id") REFERENCES "fire_doors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_door_inspections_door_idx" ON "fire_door_inspections" ("door_id","inspected_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_drills" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"building_id" varchar(26) NOT NULL,
	"conducted_at" timestamp with time zone NOT NULL,
	"conducted_by" text NOT NULL,
	"evacuation_seconds" integer,
	"people_present" integer,
	"people_accounted_for" integer,
	"roll_complete" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"lessons_learned" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_drills" ADD CONSTRAINT "fire_drills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_drills" ADD CONSTRAINT "fire_drills_building_id_fire_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "fire_buildings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_drills_building_time_idx" ON "fire_drills" ("building_id","conducted_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_peeps" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"building_id" varchar(26),
	"user_id" text,
	"person_name" text NOT NULL,
	"assistance_needs" text DEFAULT '' NOT NULL,
	"plan_summary" text DEFAULT '' NOT NULL,
	"buddy_name" text DEFAULT '' NOT NULL,
	"equipment_needed" text DEFAULT '' NOT NULL,
	"review_frequency_months" integer DEFAULT 12 NOT NULL,
	"next_review_at" timestamp with time zone NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_peeps" ADD CONSTRAINT "fire_peeps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_peeps" ADD CONSTRAINT "fire_peeps_building_id_fire_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "fire_buildings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_peeps_tenant_review_idx" ON "fire_peeps" ("tenant_id","next_review_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_peeps_building_idx" ON "fire_peeps" ("building_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_marshals" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"building_id" varchar(26) NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'marshal' NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"trained_at" timestamp with time zone,
	"training_expires_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"ended_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_marshals" ADD CONSTRAINT "fire_marshals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_marshals" ADD CONSTRAINT "fire_marshals_building_id_fire_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "fire_buildings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_marshals_building_idx" ON "fire_marshals" ("building_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_marshals_tenant_expiry_idx" ON "fire_marshals" ("tenant_id","training_expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_events" (
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
 ALTER TABLE "fire_events" ADD CONSTRAINT "fire_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_events_entity_idx" ON "fire_events" ("tenant_id","entity_type","entity_id","created_at");
