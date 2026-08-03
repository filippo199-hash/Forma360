-- 0069 — RAMS: Risk Assessment & Method Statement (FreeHS module B6).
-- Method statements (+ immutable published versions) as the reusable
-- "how"; RAMS packs (+ immutable issued versions) as the job-specific
-- issuable artefact that snapshots the bound RA versions, COSHH
-- assessments and documents; append-only briefings anchored to a pack
-- version; client share links with an acceptance decision; the
-- third-party review workflow over contractor documents; and the
-- append-only event log.
-- Also extends permits with the `requires_rams_pack` type flag and the
-- two links that satisfy it (own issued pack version / accepted
-- third-party review) — RAMS spec §10.2.
-- Tail: backfills the rams.* permission keys onto existing tenants'
-- system permission sets (PF-8 — new modules must not strand old
-- tenants).
CREATE TABLE IF NOT EXISTS "method_statements" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"reference_number" text,
	"title" text NOT NULL,
	"trade" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"owner_user_id" text,
	"draft_content" jsonb NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "method_statements" ADD CONSTRAINT "method_statements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "method_statements_tenant_status_idx" ON "method_statements" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "method_statements_tenant_template_idx" ON "method_statements" ("tenant_id","is_template");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "method_statement_versions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"method_statement_id" varchar(26) NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"published_by" text NOT NULL,
	"published_by_name" text,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "method_statement_versions" ADD CONSTRAINT "method_statement_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "method_statement_versions" ADD CONSTRAINT "method_statement_versions_method_statement_id_method_statements_id_fk" FOREIGN KEY ("method_statement_id") REFERENCES "method_statements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ms_versions_statement_version_idx" ON "method_statement_versions" ("method_statement_id","version_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ms_versions_tenant_idx" ON "method_statement_versions" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rams_packs" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"reference_number" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"client_name" text DEFAULT '' NOT NULL,
	"site_id" varchar(26),
	"location_text" text DEFAULT '' NOT NULL,
	"planned_from" timestamp with time zone,
	"planned_to" timestamp with time zone,
	"author_user_id" text,
	"supervisor_user_id" text,
	"supervisor_name" text DEFAULT '' NOT NULL,
	"method_statement_id" varchar(26),
	"draft_content" jsonb NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	"withdrawn_reason" text DEFAULT '' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_packs" ADD CONSTRAINT "rams_packs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_packs" ADD CONSTRAINT "rams_packs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_packs" ADD CONSTRAINT "rams_packs_method_statement_id_method_statements_id_fk" FOREIGN KEY ("method_statement_id") REFERENCES "method_statements"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_packs_tenant_status_idx" ON "rams_packs" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_packs_tenant_site_idx" ON "rams_packs" ("tenant_id","site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_packs_tenant_planned_idx" ON "rams_packs" ("tenant_id","planned_from");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rams_pack_versions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"pack_id" varchar(26) NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"issued_by" text NOT NULL,
	"issued_by_name" text,
	"issued_at" timestamp with time zone NOT NULL,
	"attestation_text" text DEFAULT '' NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_versions" ADD CONSTRAINT "rams_pack_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_versions" ADD CONSTRAINT "rams_pack_versions_pack_id_rams_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "rams_packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rams_pack_versions_pack_version_idx" ON "rams_pack_versions" ("pack_id","version_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_pack_versions_tenant_idx" ON "rams_pack_versions" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rams_pack_risk_assessments" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"pack_id" varchar(26) NOT NULL,
	"assessment_id" varchar(26) NOT NULL,
	"ra_version_id" varchar(26),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_risk_assessments" ADD CONSTRAINT "rams_pack_risk_assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_risk_assessments" ADD CONSTRAINT "rams_pack_risk_assessments_pack_id_rams_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "rams_packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_risk_assessments" ADD CONSTRAINT "rams_pack_risk_assessments_assessment_id_risk_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_risk_assessments" ADD CONSTRAINT "rams_pack_risk_assessments_ra_version_id_risk_assessment_versions_id_fk" FOREIGN KEY ("ra_version_id") REFERENCES "risk_assessment_versions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rams_pack_ra_unique_idx" ON "rams_pack_risk_assessments" ("pack_id","assessment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_pack_ra_assessment_idx" ON "rams_pack_risk_assessments" ("tenant_id","assessment_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rams_pack_coshh" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"pack_id" varchar(26) NOT NULL,
	"coshh_assessment_id" varchar(26) NOT NULL,
	"substance_id" varchar(26),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_coshh" ADD CONSTRAINT "rams_pack_coshh_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_coshh" ADD CONSTRAINT "rams_pack_coshh_pack_id_rams_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "rams_packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_coshh" ADD CONSTRAINT "rams_pack_coshh_coshh_assessment_id_coshh_assessments_id_fk" FOREIGN KEY ("coshh_assessment_id") REFERENCES "coshh_assessments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_coshh" ADD CONSTRAINT "rams_pack_coshh_substance_id_coshh_substances_id_fk" FOREIGN KEY ("substance_id") REFERENCES "coshh_substances"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rams_pack_coshh_unique_idx" ON "rams_pack_coshh" ("pack_id","coshh_assessment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_pack_coshh_tenant_idx" ON "rams_pack_coshh" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rams_pack_documents" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"pack_id" varchar(26) NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"document_id" varchar(26),
	"storage_key" text,
	"filename" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_documents" ADD CONSTRAINT "rams_pack_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_documents" ADD CONSTRAINT "rams_pack_documents_pack_id_rams_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "rams_packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_pack_documents" ADD CONSTRAINT "rams_pack_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_pack_documents_pack_idx" ON "rams_pack_documents" ("pack_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rams_briefings" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"pack_id" varchar(26) NOT NULL,
	"pack_version_id" varchar(26) NOT NULL,
	"version_number" integer NOT NULL,
	"briefee_kind" text DEFAULT 'user' NOT NULL,
	"briefee_user_id" text,
	"briefee_name" text NOT NULL,
	"briefee_category" text DEFAULT 'employee' NOT NULL,
	"briefee_organisation" text DEFAULT '' NOT NULL,
	"briefed_by" text NOT NULL,
	"briefed_by_name" text DEFAULT '' NOT NULL,
	"briefed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_data" text,
	"questions_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_briefings" ADD CONSTRAINT "rams_briefings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_briefings" ADD CONSTRAINT "rams_briefings_pack_id_rams_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "rams_packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_briefings" ADD CONSTRAINT "rams_briefings_pack_version_id_rams_pack_versions_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "rams_pack_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_briefings_tenant_version_idx" ON "rams_briefings" ("tenant_id","pack_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_briefings_pack_idx" ON "rams_briefings" ("pack_id","briefed_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rams_client_links" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"pack_id" varchar(26) NOT NULL,
	"pack_version_id" varchar(26) NOT NULL,
	"version_number" integer NOT NULL,
	"token" text NOT NULL,
	"issued_to_name" text DEFAULT '' NOT NULL,
	"issued_to_email" text,
	"issued_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"accepted_by_name" text DEFAULT '' NOT NULL,
	"accepted_by_organisation" text DEFAULT '' NOT NULL,
	"decision_comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_client_links" ADD CONSTRAINT "rams_client_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_client_links" ADD CONSTRAINT "rams_client_links_pack_id_rams_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "rams_packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_client_links" ADD CONSTRAINT "rams_client_links_pack_version_id_rams_pack_versions_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "rams_pack_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rams_client_links_token_idx" ON "rams_client_links" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_client_links_pack_idx" ON "rams_client_links" ("tenant_id","pack_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rams_reviews" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"contractor_id" varchar(26) NOT NULL,
	"contractor_document_id" varchar(26),
	"title" text NOT NULL,
	"work_description" text DEFAULT '' NOT NULL,
	"site_id" varchar(26),
	"outcome" text DEFAULT 'pending' NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" text DEFAULT '' NOT NULL,
	"comments" text DEFAULT '' NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"reviewer_user_id" text,
	"reviewed_at" timestamp with time zone,
	"submitted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_reviews" ADD CONSTRAINT "rams_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_reviews" ADD CONSTRAINT "rams_reviews_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_reviews" ADD CONSTRAINT "rams_reviews_contractor_document_id_contractor_documents_id_fk" FOREIGN KEY ("contractor_document_id") REFERENCES "contractor_documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_reviews" ADD CONSTRAINT "rams_reviews_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_reviews_tenant_outcome_idx" ON "rams_reviews" ("tenant_id","outcome","valid_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_reviews_contractor_idx" ON "rams_reviews" ("tenant_id","contractor_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rams_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"pack_id" varchar(26),
	"method_statement_id" varchar(26),
	"review_id" varchar(26),
	"actor_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_events" ADD CONSTRAINT "rams_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_events" ADD CONSTRAINT "rams_events_pack_id_rams_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "rams_packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_events" ADD CONSTRAINT "rams_events_method_statement_id_method_statements_id_fk" FOREIGN KEY ("method_statement_id") REFERENCES "method_statements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rams_events" ADD CONSTRAINT "rams_events_review_id_rams_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "rams_reviews"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_events_tenant_pack_idx" ON "rams_events" ("tenant_id","pack_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rams_events_ms_idx" ON "rams_events" ("method_statement_id","created_at");
--> statement-breakpoint
-- Permits integration (RAMS spec §10.2): a per-type requirement flag
-- alongside the existing requires_* family, plus the two links that can
-- satisfy it — an own issued pack version, or an accepted third-party
-- review. Defaults keep every existing type and permit unaffected.
ALTER TABLE "permit_types" ADD COLUMN IF NOT EXISTS "requires_rams_pack" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "rams_pack_version_id" varchar(26);
--> statement-breakpoint
ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "rams_review_id" varchar(26);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permits" ADD CONSTRAINT "permits_rams_pack_version_id_rams_pack_versions_id_fk" FOREIGN KEY ("rams_pack_version_id") REFERENCES "rams_pack_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permits" ADD CONSTRAINT "permits_rams_review_id_rams_reviews_id_fk" FOREIGN KEY ("rams_review_id") REFERENCES "rams_reviews"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- PF-8 backfill: existing tenants' system permission sets gain the new
-- rams.* keys (new tenants get them from the seed). Guarded so the
-- statement is idempotent and never duplicates keys.
UPDATE "permission_sets" SET "permissions" = "permissions" || '["rams.view","rams.create","rams.issue","rams.brief","rams.review","rams.manage"]'::jsonb
WHERE "is_system" = true AND "name" IN ('Administrator','Manager') AND NOT "permissions" @> '["rams.manage"]'::jsonb;
--> statement-breakpoint
UPDATE "permission_sets" SET "permissions" = "permissions" || '["rams.view","rams.brief"]'::jsonb
WHERE "is_system" = true AND "name" = 'Standard' AND NOT "permissions" @> '["rams.view"]'::jsonb;
