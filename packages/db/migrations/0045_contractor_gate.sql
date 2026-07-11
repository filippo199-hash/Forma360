CREATE TABLE IF NOT EXISTS "contractor_gate_fields" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"label" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractor_visit_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"visit_id" varchar(26) NOT NULL,
	"contractor_id" varchar(26) NOT NULL,
	"event_type" text NOT NULL,
	"method" text NOT NULL,
	"override_reason" text,
	"captured_fields" jsonb,
	"actor_user_id" varchar(64),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractor_gate_config" (
	"tenant_id" varchar(26) PRIMARY KEY NOT NULL,
	"gate_token" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_gate_fields" ADD CONSTRAINT "contractor_gate_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_visit_events" ADD CONSTRAINT "contractor_visit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_visit_events" ADD CONSTRAINT "contractor_visit_events_visit_id_contractor_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "contractor_visits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_visit_events" ADD CONSTRAINT "contractor_visit_events_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_visit_events" ADD CONSTRAINT "contractor_visit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_gate_config" ADD CONSTRAINT "contractor_gate_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractor_gate_fields_tenant_idx" ON "contractor_gate_fields" ("tenant_id","sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractor_visit_events_visit_idx" ON "contractor_visit_events" ("tenant_id","visit_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractor_gate_config_token_idx" ON "contractor_gate_config" ("gate_token");
