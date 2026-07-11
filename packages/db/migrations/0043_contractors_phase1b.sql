ALTER TABLE "contractors" ADD COLUMN IF NOT EXISTS "upload_token" text;
--> statement-breakpoint
ALTER TABLE "contractor_documents" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractor_requirement_templates" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"blocking" boolean DEFAULT true NOT NULL,
	"recurrence_months" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_requirement_templates" ADD CONSTRAINT "contractor_requirement_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractor_req_templates_tenant_idx" ON "contractor_requirement_templates" ("tenant_id","category");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractors_upload_token_idx" ON "contractors" ("upload_token");
