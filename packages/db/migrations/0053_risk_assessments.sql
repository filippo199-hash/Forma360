-- 0053 — Risk Assessments (FreeHS module B1).
-- HSE five-step model: assessments → hazards → controls (hierarchy of
-- control) + review log + distribution/acknowledgement records.
CREATE TABLE IF NOT EXISTS "risk_assessments" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"reference_number" text,
	"title" text NOT NULL,
	"activity" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'standing' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"site_id" varchar(26),
	"location_text" text,
	"assessor_user_id" text,
	"person_specific_for" text,
	"parent_assessment_id" varchar(26),
	"matrix" jsonb DEFAULT '{"lowMax":4,"mediumMax":9,"highMax":15}'::jsonb NOT NULL,
	"review_frequency_months" integer,
	"next_review_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"last_reviewed_by" text,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_assessments_tenant_status_idx" ON "risk_assessments" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_assessments_tenant_review_idx" ON "risk_assessments" ("tenant_id","next_review_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_assessment_hazards" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"assessment_id" varchar(26) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"hazard" text NOT NULL,
	"affected_groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"harm_description" text DEFAULT '' NOT NULL,
	"initial_likelihood" integer,
	"initial_severity" integer,
	"existing_controls" text DEFAULT '' NOT NULL,
	"residual_likelihood" integer,
	"residual_severity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_hazards" ADD CONSTRAINT "ra_hazards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_hazards" ADD CONSTRAINT "ra_hazards_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ra_hazards_assessment_idx" ON "risk_assessment_hazards" ("assessment_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_assessment_controls" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"assessment_id" varchar(26) NOT NULL,
	"hazard_id" varchar(26) NOT NULL,
	"description" text NOT NULL,
	"tier" text NOT NULL,
	"status" text DEFAULT 'in_place' NOT NULL,
	"ppe_justification" text,
	"action_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_controls" ADD CONSTRAINT "ra_controls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_controls" ADD CONSTRAINT "ra_controls_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_controls" ADD CONSTRAINT "ra_controls_hazard_id_fk" FOREIGN KEY ("hazard_id") REFERENCES "risk_assessment_hazards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ra_controls_hazard_idx" ON "risk_assessment_controls" ("hazard_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_assessment_reviews" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"assessment_id" varchar(26) NOT NULL,
	"trigger" text NOT NULL,
	"outcome" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reviewed_by" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_reviews" ADD CONSTRAINT "ra_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_reviews" ADD CONSTRAINT "ra_reviews_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ra_reviews_assessment_idx" ON "risk_assessment_reviews" ("assessment_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_assessment_acknowledgements" (
	"tenant_id" varchar(26) NOT NULL,
	"assessment_id" varchar(26) NOT NULL,
	"user_id" text NOT NULL,
	"distributed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"redistributed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ra_acks_assessment_user_pk" PRIMARY KEY("assessment_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_acknowledgements" ADD CONSTRAINT "ra_acks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessment_acknowledgements" ADD CONSTRAINT "ra_acks_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ra_acks_tenant_user_idx" ON "risk_assessment_acknowledgements" ("tenant_id","user_id");
