CREATE TABLE IF NOT EXISTS "contractor_visits" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"contractor_id" varchar(26) NOT NULL,
	"site_id" varchar(26),
	"title" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_start" timestamp with time zone NOT NULL,
	"scheduled_end" timestamp with time zone,
	"is_walk_in" boolean DEFAULT false NOT NULL,
	"authorized_by_user_id" varchar(64),
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"notes" text,
	"created_by_user_id" varchar(64),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_visits" ADD CONSTRAINT "contractor_visits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_visits" ADD CONSTRAINT "contractor_visits_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_visits" ADD CONSTRAINT "contractor_visits_authorized_by_user_id_user_id_fk" FOREIGN KEY ("authorized_by_user_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_visits" ADD CONSTRAINT "contractor_visits_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractor_visits_tenant_start_idx" ON "contractor_visits" ("tenant_id","scheduled_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractor_visits_contractor_idx" ON "contractor_visits" ("tenant_id","contractor_id");
