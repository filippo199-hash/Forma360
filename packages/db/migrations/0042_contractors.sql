CREATE TABLE IF NOT EXISTS "contractors" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"status" text DEFAULT 'active' NOT NULL,
	"primary_contact_name" text,
	"primary_contact_email" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractor_requirements" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"contractor_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"blocking" boolean DEFAULT true NOT NULL,
	"recurrence_months" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractor_documents" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"contractor_id" varchar(26) NOT NULL,
	"requirement_id" varchar(26) NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"uploaded_by_user_id" varchar(64),
	"verified_by_user_id" varchar(64),
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractors" ADD CONSTRAINT "contractors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_requirements" ADD CONSTRAINT "contractor_requirements_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_documents" ADD CONSTRAINT "contractor_documents_requirement_id_contractor_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "contractor_requirements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_documents" ADD CONSTRAINT "contractor_documents_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractors_tenant_idx" ON "contractors" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractor_requirements_contractor_idx" ON "contractor_requirements" ("tenant_id","contractor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractor_documents_requirement_idx" ON "contractor_documents" ("tenant_id","requirement_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractor_documents_contractor_idx" ON "contractor_documents" ("tenant_id","contractor_id");
