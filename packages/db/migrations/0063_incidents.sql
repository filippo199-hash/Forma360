-- 0063 — Incident & Accident Management (FreeHS module B5).
-- Incident header with per-kind jsonb details, RIDDOR duty columns and
-- worker dedup stamps; affected persons + lost-time absences; versioned
-- investigations with separated-duty signatures; findings that generate
-- actions once; append-only evidence, witness statements and event log.
-- Tail: backfills the incidents.* permission keys onto existing tenants'
-- system permission sets (PF-8 — new modules must not strand old tenants).
CREATE TABLE IF NOT EXISTS "incidents" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"reference_number" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'minor' NOT NULL,
	"potential_severity" text,
	"status" text DEFAULT 'reported' NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reported_by_user_id" text NOT NULL,
	"site_id" varchar(26),
	"location_text" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observation_id" varchar(26),
	"permit_id" varchar(26),
	"contractor_id" varchar(26),
	"asset_id" varchar(26),
	"investigation_level" text,
	"lead_investigator_user_id" text,
	"riddor_category" text,
	"riddor_determination_note" text DEFAULT '' NOT NULL,
	"riddor_screened_by_user_id" text,
	"riddor_screened_at" timestamp with time zone,
	"riddor_deadline_at" timestamp with time zone,
	"riddor_rescreen_required" boolean DEFAULT false NOT NULL,
	"riddor_submitted_at" timestamp with time zone,
	"riddor_submitted_by_user_id" text,
	"riddor_submission_route" text,
	"riddor_hse_reference" text,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"effectiveness_due_at" timestamp with time zone,
	"effectiveness_verdict" text,
	"effectiveness_note" text DEFAULT '' NOT NULL,
	"effectiveness_recorded_at" timestamp with time zone,
	"effectiveness_recorded_by_user_id" text,
	"review_prompt_at" timestamp with time zone,
	"review_prompt_skipped_reason" text,
	"alert_sent_at" timestamp with time zone,
	"riddor_warning5_sent_at" timestamp with time zone,
	"riddor_warning2_sent_at" timestamp with time zone,
	"riddor_escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_observation_id_issues_id_fk" FOREIGN KEY ("observation_id") REFERENCES "issues"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_permit_id_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "permits"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_tenant_status_idx" ON "incidents" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_tenant_occurred_idx" ON "incidents" ("tenant_id","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_tenant_riddor_deadline_idx" ON "incidents" ("tenant_id","riddor_deadline_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_site_idx" ON "incidents" ("site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_tenant_observation_idx" ON "incidents" ("tenant_id","observation_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_persons" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"incident_id" varchar(26) NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"injury" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"oh_follow_up_required" boolean DEFAULT false NOT NULL,
	"returned_to_work" boolean DEFAULT false NOT NULL,
	"on_restricted_duties" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_persons" ADD CONSTRAINT "incident_persons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_persons" ADD CONSTRAINT "incident_persons_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_persons_incident_idx" ON "incident_persons" ("tenant_id","incident_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_absences" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"incident_id" varchar(26) NOT NULL,
	"person_id" varchar(26) NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_absences" ADD CONSTRAINT "incident_absences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_absences" ADD CONSTRAINT "incident_absences_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_absences" ADD CONSTRAINT "incident_absences_person_id_incident_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "incident_persons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_absences_incident_idx" ON "incident_absences" ("tenant_id","incident_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_investigations" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"incident_id" varchar(26) NOT NULL,
	"revision" integer NOT NULL,
	"method" text,
	"immediate_cause" text DEFAULT '' NOT NULL,
	"underlying_cause" text DEFAULT '' NOT NULL,
	"contributing_factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why_chain" jsonb,
	"causal_factors" jsonb,
	"timeline_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conclusion_summary" text DEFAULT '' NOT NULL,
	"root_cause_statement" text DEFAULT '' NOT NULL,
	"recurrence_likelihood" text,
	"lessons_learned" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_by_user_id" text,
	"submitted_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_investigations" ADD CONSTRAINT "incident_investigations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_investigations" ADD CONSTRAINT "incident_investigations_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_investigations_incident_idx" ON "incident_investigations" ("tenant_id","incident_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incident_investigations_revision_unique" ON "incident_investigations" ("incident_id","revision");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_findings" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"incident_id" varchar(26) NOT NULL,
	"investigation_id" varchar(26) NOT NULL,
	"category" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"description" text NOT NULL,
	"requires_action" boolean DEFAULT true NOT NULL,
	"action_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_findings" ADD CONSTRAINT "incident_findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_findings" ADD CONSTRAINT "incident_findings_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_findings" ADD CONSTRAINT "incident_findings_investigation_id_incident_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "incident_investigations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_findings_investigation_idx" ON "incident_findings" ("tenant_id","investigation_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_evidence" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"incident_id" varchar(26) NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text,
	"filename" text,
	"caption" text DEFAULT '' NOT NULL,
	"collected_by_user_id" text NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_evidence" ADD CONSTRAINT "incident_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_evidence" ADD CONSTRAINT "incident_evidence_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_evidence_incident_idx" ON "incident_evidence" ("tenant_id","incident_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_witness_statements" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"incident_id" varchar(26) NOT NULL,
	"witness_user_id" text,
	"witness_name" text NOT NULL,
	"statement" text NOT NULL,
	"taken_by_user_id" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_data" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_witness_statements" ADD CONSTRAINT "incident_witness_statements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_witness_statements" ADD CONSTRAINT "incident_witness_statements_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_witness_statements_incident_idx" ON "incident_witness_statements" ("tenant_id","incident_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"incident_id" varchar(26) NOT NULL,
	"actor_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_events_incident_idx" ON "incident_events" ("tenant_id","incident_id","created_at");
--> statement-breakpoint
-- PF-8 backfill: existing tenants' system permission sets gain the new
-- incidents.* keys (new tenants get them from the seed). Guarded so the
-- statement is idempotent and never duplicates keys.
UPDATE "permission_sets" SET "permissions" = "permissions" || '["incidents.view","incidents.report","incidents.investigate","incidents.manage","incidents.confidential.view"]'::jsonb
WHERE "is_system" = true AND "name" IN ('Administrator','Manager') AND NOT "permissions" @> '["incidents.manage"]'::jsonb;
--> statement-breakpoint
UPDATE "permission_sets" SET "permissions" = "permissions" || '["incidents.view","incidents.report"]'::jsonb
WHERE "is_system" = true AND "name" = 'Standard' AND NOT "permissions" @> '["incidents.view"]'::jsonb;
