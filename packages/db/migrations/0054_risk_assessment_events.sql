-- 0054 — Risk assessment change log (FreeHS B1, practitioner review #9).
-- Append-only: the API exposes no update/delete surface for these rows.
CREATE TABLE IF NOT EXISTS "risk_assessment_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"assessment_id" varchar(26) NOT NULL,
	"actor_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_events" ADD CONSTRAINT "ra_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_events" ADD CONSTRAINT "ra_events_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ra_events_assessment_idx" ON "risk_assessment_events" ("assessment_id","created_at");
