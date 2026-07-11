ALTER TABLE "permission_sets" ADD COLUMN IF NOT EXISTS "external_managed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "contractor_id" varchar(26);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "contractor_activities" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractor_users" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"contractor_id" varchar(26) NOT NULL,
	"user_id" text NOT NULL,
	"activities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_users" ADD CONSTRAINT "contractor_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_users" ADD CONSTRAINT "contractor_users_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_users" ADD CONSTRAINT "contractor_users_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractor_users_user_unique" ON "contractor_users" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractor_users_contractor_idx" ON "contractor_users" ("tenant_id","contractor_id");
