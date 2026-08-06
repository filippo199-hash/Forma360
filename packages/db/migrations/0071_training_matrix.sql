-- Training & competence matrix (FreeHS module B7).
--
-- Three tables and no matrix table: the grid is computed from
-- assignments × records on read, exactly as fire safety, permits and
-- COSHH compute their statuses.
--
-- Records are append-only. A renewal inserts a new row; nothing
-- overwrites an expiry, so "was this person competent on the day" stays
-- answerable. The FK to "user" is ON DELETE SET NULL and person_name is
-- NOT NULL, so anonymising a user detaches the identity while leaving the
-- evidence that the training happened.

CREATE TABLE IF NOT EXISTS "training_requirements" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "name" text NOT NULL,
  "category" text,
  "obligation" text DEFAULT 'mandatory' NOT NULL,
  "validity_months" integer,
  "renewal_lead_days" integer DEFAULT 60 NOT NULL,
  "evidence_note" text,
  "description" text,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_requirement_assignments" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "requirement_id" varchar(26) NOT NULL,
  "scope" text NOT NULL,
  "role_name" text,
  "group_id" varchar(26),
  "site_id" varchar(26),
  "user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_records" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "requirement_id" varchar(26) NOT NULL,
  "user_id" text,
  "person_name" text NOT NULL,
  "person_category" text DEFAULT 'employee' NOT NULL,
  "contractor_id" varchar(26),
  "achieved_at" date NOT NULL,
  "expires_at" date,
  "awarding_body" text,
  "certificate_number" text,
  "evidence_key" text,
  "evidence_filename" text,
  "source" text DEFAULT 'external' NOT NULL,
  "verification_status" text DEFAULT 'unverified' NOT NULL,
  "verified_by_user_id" text,
  "verified_at" timestamp with time zone,
  "verification_note" text,
  "notes" text,
  "reminder_sent_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "recorded_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_requirements" ADD CONSTRAINT "training_requirements_tenant_id_tenants_id_fk"
   FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_requirement_assignments" ADD CONSTRAINT "training_assignments_tenant_id_tenants_id_fk"
   FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_requirement_assignments" ADD CONSTRAINT "training_assignments_requirement_id_fk"
   FOREIGN KEY ("requirement_id") REFERENCES "public"."training_requirements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_requirement_assignments" ADD CONSTRAINT "training_assignments_group_id_fk"
   FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_requirement_assignments" ADD CONSTRAINT "training_assignments_site_id_fk"
   FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_requirement_assignments" ADD CONSTRAINT "training_assignments_user_id_fk"
   FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_records" ADD CONSTRAINT "training_records_tenant_id_tenants_id_fk"
   FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_records" ADD CONSTRAINT "training_records_requirement_id_fk"
   FOREIGN KEY ("requirement_id") REFERENCES "public"."training_requirements"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_records" ADD CONSTRAINT "training_records_user_id_fk"
   FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_records" ADD CONSTRAINT "training_records_verified_by_user_id_fk"
   FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_records" ADD CONSTRAINT "training_records_recorded_by_user_id_fk"
   FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_requirements_tenant_idx" ON "training_requirements" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "training_requirements_tenant_name_key" ON "training_requirements" ("tenant_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_assignments_tenant_idx" ON "training_requirement_assignments" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_assignments_requirement_idx" ON "training_requirement_assignments" ("tenant_id","requirement_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_records_tenant_idx" ON "training_records" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_records_person_idx" ON "training_records" ("tenant_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_records_requirement_idx" ON "training_records" ("tenant_id","requirement_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_records_expiry_idx" ON "training_records" ("tenant_id","expires_at");
--> statement-breakpoint
-- The permits competence gate (FreeHS B7). Empty by default, so every
-- existing permit type keeps its current behaviour until an admin opts in.
ALTER TABLE "permit_types" ADD COLUMN IF NOT EXISTS "required_training_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
-- Revised permission keys: the reserved set encoded an LMS (`training.take`,
-- `training.courses.manage`). Swap them for the matrix's real verbs on the
-- system sets. Idempotent, mirroring 0065.
UPDATE "permission_sets"
SET "permissions" = ("permissions" - 'training.take') - 'training.courses.manage'
WHERE "is_system" = true;
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["training.record"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["training.record"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["training.verify"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["training.verify"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["training.manage"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["training.manage"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["training.view"]'::jsonb
WHERE "is_system" = true
  AND NOT ("permissions" @> '["training.view"]'::jsonb);
