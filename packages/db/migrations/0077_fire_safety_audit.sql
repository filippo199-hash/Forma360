-- Fire Safety module audit: the two High findings.
--
-- FS-G05 — a published fire risk assessment could be edited in place.
--
-- The FRA is the statutory artefact under Article 9 of the Fire Safety
-- Order: the document a Responsible Person signs as "suitable and
-- sufficient", that a fire officer reads and a coroner may read afterwards.
-- `publish` flipped a status flag on a single mutable row, and four
-- procedures then rewrote that row's content — including its taken-together
-- risk rating, and including HARD-DELETING a significant finding — under a
-- LOWER permission tier (`fireSafety.create`) than the one that could
-- publish it (`fireSafety.manage`).
--
-- `content_updated_at` exists specifically to DETECT this (the FS-7 amber
-- banner) while still permitting it, so the module built the display signal
-- for the defect and skipped the substrate that makes the signal safe. In
-- risk assessments, editing a live assessment is harmless because the signed
-- version row still exists and is what the audit chain points at. Here the
-- working row was the only copy there was: the person who signed could not
-- demonstrate what they signed.
--
-- This is the model ADR 0011 §1 already settled for `risk_assessment_versions`
-- and ADR 0015 repeated for `rams_pack_versions`. Fire safety was the
-- outlier, on the one document a coroner reads.
CREATE TABLE IF NOT EXISTS "fire_fra_versions" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "fra_id" varchar(26) NOT NULL,
  "version_number" integer NOT NULL,
  "content" jsonb NOT NULL,
  "signed_off_by" text NOT NULL,
  "signed_off_by_name" text,
  "signed_off_at" timestamp with time zone NOT NULL,
  "actions_created" integer DEFAULT 0 NOT NULL,
  "superseded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "fire_fra_versions" ADD CONSTRAINT "fire_fra_versions_tenant_id_tenants_id_fk"
   FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fire_fra_versions" ADD CONSTRAINT "fire_fra_versions_fra_id_fire_risk_assessments_id_fk"
   FOREIGN KEY ("fra_id") REFERENCES "public"."fire_risk_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "fire_fra_versions_fra_version_idx"
  ON "fire_fra_versions" ("fra_id", "version_number");
--> statement-breakpoint
-- "Exactly one current signed version" as a database fact rather than a
-- router convention — the deliberate improvement on RA and RAMS, which both
-- leave this invariant in application code. It forces the publish
-- transaction to stamp `superseded_at` on n BEFORE inserting n+1, because
-- unique indexes are checked per statement rather than at commit.
CREATE UNIQUE INDEX IF NOT EXISTS "fire_fra_versions_current_idx"
  ON "fire_fra_versions" ("fra_id") WHERE "superseded_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_fra_versions_tenant_idx"
  ON "fire_fra_versions" ("tenant_id");
--> statement-breakpoint

-- The parent's pointer at its current signed version. 0 = never published,
-- which is what every existing row is until its next publish.
ALTER TABLE "fire_risk_assessments"
  ADD COLUMN IF NOT EXISTS "current_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- No backfill. An FRA published before this migration has no snapshot and
-- cannot have one — the content it was signed against is unknowable, since
-- it may already have been edited. Synthesising a version row from today's
-- working content would manufacture evidence: it would assert "this is what
-- was signed on that date" about text nobody can vouch for. The honest
-- state is `current_version = 0`, which the UI reads as "signed before
-- versioning; no frozen copy exists", and the next publish cuts version 1.
--> statement-breakpoint

-- FS-X01 — marshal competence was tracked in two registers that disagreed.
--
-- `fire_marshals` carried its own `trained_at` / `training_expires_at` and
-- the fire register read only that row, while `training_records` — the
-- module built to answer "are these people trained", with the certificates,
-- the verification status and the evidence in it — was never consulted.
-- The module comment still said "training dates are carried locally until
-- Phase 10"; Training (B7) shipped in migration 0071.
--
-- Both directions were live. A marshal who renewed their ticket stayed
-- `expired` on the fire register, kept counting as no cover, and kept
-- getting chased by the daily digest. And — the worse one — anybody could
-- type a future date into the fire register and the marshal read as
-- competent, satisfying the building's marshal target and closing the
-- coverage gap that exists to force the training, with no record, no
-- certificate and no verification behind it. Nothing in the product would
-- ever contradict it.
--
-- A table rather than a key in `tenants.settings`, following
-- `tenant_risk_matrix_settings`: `tenants.updateSettings` does a
-- non-atomic read-modify-write merge of that jsonb column, so a second
-- writer widens a real lost-update window against branding and terminology
-- — and a fire-safety key has no business in the tenants router.
CREATE TABLE IF NOT EXISTS "fire_safety_settings" (
  "tenant_id" varchar(26) PRIMARY KEY NOT NULL,
  -- A SET, not one id, mirroring `permit_types.required_training_ids`.
  -- Tenants routinely run two qualifying tickets (a 3-year certificate plus
  -- an annual refresher), and with a single id a catalogue reorganisation
  -- flips every marshal to unbacked in the interval between retiring the old
  -- requirement and pointing at the new one. Semantics are ANY-OF: one
  -- competence, several possible evidences.
  --
  -- Empty is the default, and empty means no designation — so this ships
  -- inert and no tenant's marshals change state until an administrator
  -- deliberately says which requirement is the ticket.
  "marshal_requirement_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "fire_safety_settings" ADD CONSTRAINT "fire_safety_settings_tenant_id_tenants_id_fk"
   FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
