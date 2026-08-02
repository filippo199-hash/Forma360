-- 0059 — Permit to Work & High-Risk Activities (FreeHS module B3).
-- Per-tenant permit-type catalogue (seeded from DEFAULT_PERMIT_TYPES on
-- first use), the permit lifecycle row with jsonb precondition / gas-test /
-- attachment / closure snapshots and multi-party signature timestamps, and
-- the append-only permit event log.
CREATE TABLE IF NOT EXISTS "permit_types" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"requires_authoriser" boolean DEFAULT false NOT NULL,
	"requires_gas_testing" boolean DEFAULT false NOT NULL,
	"requires_isolation_certificate" boolean DEFAULT false NOT NULL,
	"requires_rescue_plan" boolean DEFAULT false NOT NULL,
	"max_duration_hours" integer DEFAULT 12 NOT NULL,
	"preconditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permit_types" ADD CONSTRAINT "permit_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permit_types_tenant_idx" ON "permit_types" ("tenant_id","archived_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permits" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"permit_type_id" varchar(26) NOT NULL,
	"reference_number" text,
	"title" text NOT NULL,
	"work_description" text DEFAULT '' NOT NULL,
	"site_id" varchar(26),
	"location_text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"acceptor_user_id" text,
	"accepted_at" timestamp with time zone,
	"issuer_user_id" text,
	"issued_at" timestamp with time zone,
	"authoriser_user_id" text,
	"authorised_at" timestamp with time zone,
	"preconditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gas_readings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isolation_certificate_ref" text DEFAULT '' NOT NULL,
	"rescue_plan" text DEFAULT '' NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_by" text,
	"suspension_reason" text DEFAULT '' NOT NULL,
	"extension_count" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"closure_checks" jsonb,
	"closure_notes" text DEFAULT '' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancellation_reason" text DEFAULT '' NOT NULL,
	"expiry_escalated_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permits" ADD CONSTRAINT "permits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permits" ADD CONSTRAINT "permits_permit_type_id_permit_types_id_fk" FOREIGN KEY ("permit_type_id") REFERENCES "permit_types"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permits" ADD CONSTRAINT "permits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permits_tenant_status_idx" ON "permits" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permits_tenant_site_idx" ON "permits" ("tenant_id","site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permits_tenant_valid_to_idx" ON "permits" ("tenant_id","valid_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permits_type_idx" ON "permits" ("permit_type_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permit_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"permit_id" varchar(26) NOT NULL,
	"actor_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permit_events" ADD CONSTRAINT "permit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permit_events" ADD CONSTRAINT "permit_events_permit_id_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "permits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permit_events_permit_idx" ON "permit_events" ("tenant_id","permit_id","created_at");
