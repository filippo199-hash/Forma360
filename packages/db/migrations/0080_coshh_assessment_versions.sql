-- BUG-03: COSHH assessments had no signed copy.
--
-- Risk assessments (risk_assessment_versions) and fire risk assessments
-- (fire_fra_versions) both freeze an immutable version on publish. COSHH did
-- not, so editing an Active, signed assessment overwrote the only record of
-- what an assessor had attested as suitable and sufficient. This is the
-- missing third table, shaped like the other two.
CREATE TABLE IF NOT EXISTS "coshh_assessment_versions" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "assessment_id" varchar(26) NOT NULL,
  "version_number" integer NOT NULL,
  "content" jsonb NOT NULL,
  "signed_off_by" text NOT NULL,
  "signed_off_by_name" text,
  "signed_off_at" timestamp with time zone NOT NULL,
  "actions_created" integer DEFAULT 0 NOT NULL,
  "superseded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "coshh_assessment_versions_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict,
  CONSTRAINT "coshh_assessment_versions_assessment_id_fk"
    FOREIGN KEY ("assessment_id") REFERENCES "coshh_assessments"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS "coshh_assessment_versions_version_idx"
  ON "coshh_assessment_versions" ("assessment_id", "version_number");

-- Exactly one current signed version, as a database fact rather than a
-- router convention. Forces the publish transaction to stamp superseded_at
-- on n before inserting n+1.
CREATE UNIQUE INDEX IF NOT EXISTS "coshh_assessment_versions_current_idx"
  ON "coshh_assessment_versions" ("assessment_id")
  WHERE "superseded_at" IS NULL;

CREATE INDEX IF NOT EXISTS "coshh_assessment_versions_tenant_idx"
  ON "coshh_assessment_versions" ("tenant_id");
