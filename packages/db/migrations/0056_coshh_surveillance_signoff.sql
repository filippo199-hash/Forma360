-- COSHH HSE-expert review round: health surveillance register (Reg 11),
-- RPE detail on controls (type / APF / face-fit), and the assessor
-- sign-off stamp on publish. Idempotent guards so re-apply is a no-op.
ALTER TABLE "coshh_assessments" ADD COLUMN IF NOT EXISTS "published_by" text;--> statement-breakpoint
ALTER TABLE "coshh_assessment_controls" ADD COLUMN IF NOT EXISTS "rpe_type" text;--> statement-breakpoint
ALTER TABLE "coshh_assessment_controls" ADD COLUMN IF NOT EXISTS "rpe_apf" integer;--> statement-breakpoint
ALTER TABLE "coshh_assessment_controls" ADD COLUMN IF NOT EXISTS "face_fit_confirmed_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coshh_health_surveillance" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"substance_id" varchar(26) NOT NULL,
	"user_id" text NOT NULL,
	"interval_months" integer DEFAULT 12 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_check_at" timestamp with time zone,
	"next_due_at" timestamp with time zone NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"ended_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_health_surveillance" ADD CONSTRAINT "coshh_health_surveillance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coshh_health_surveillance" ADD CONSTRAINT "coshh_health_surveillance_substance_id_coshh_substances_id_fk" FOREIGN KEY ("substance_id") REFERENCES "coshh_substances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_surveillance_substance_idx" ON "coshh_health_surveillance" ("substance_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coshh_surveillance_tenant_due_idx" ON "coshh_health_surveillance" ("tenant_id","next_due_at");
