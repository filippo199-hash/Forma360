-- AI-built custom dashboards (ADR 0018).
--
-- Three tables. The dashboard layout is a versioned jsonb spec (widgets
-- referencing the bounded source catalogue) — no query text, no data.
-- Shares back the 'selected' visibility; schedules drive recurring
-- PDF-by-email delivery with free-text recipients (recipient cap and
-- send logging live at the router/worker layer).
--
-- The paid-plan gate (`customDashboards` entitlement) is a tRPC-layer
-- check on tenants.settings.plan; no schema change is needed for it.

CREATE TABLE IF NOT EXISTS "dashboards" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "owner_user_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "spec" jsonb NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "visibility" text DEFAULT 'private' NOT NULL,
  "conversation_id" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_shares" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "dashboard_id" varchar(26) NOT NULL,
  "user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_schedules" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "dashboard_id" varchar(26) NOT NULL,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "rrule" text NOT NULL,
  "start_at" timestamp with time zone NOT NULL,
  "end_at" timestamp with time zone,
  "recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "paused" boolean DEFAULT false NOT NULL,
  "last_sent_at" timestamp with time zone,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_tenant_id_tenants_id_fk"
   FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_owner_user_id_fk"
   FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_conversation_id_fk"
   FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_shares" ADD CONSTRAINT "dashboard_shares_tenant_id_tenants_id_fk"
   FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_shares" ADD CONSTRAINT "dashboard_shares_dashboard_id_fk"
   FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_shares" ADD CONSTRAINT "dashboard_shares_user_id_fk"
   FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_schedules" ADD CONSTRAINT "dashboard_schedules_tenant_id_tenants_id_fk"
   FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_schedules" ADD CONSTRAINT "dashboard_schedules_dashboard_id_fk"
   FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboards_tenant_status_idx" ON "dashboards" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboards_tenant_owner_idx" ON "dashboards" ("tenant_id","owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_shares_unique" ON "dashboard_shares" ("dashboard_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_shares_tenant_user_idx" ON "dashboard_shares" ("tenant_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_schedules_tenant_paused_idx" ON "dashboard_schedules" ("tenant_id","paused");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_schedules_dashboard_idx" ON "dashboard_schedules" ("dashboard_id");
