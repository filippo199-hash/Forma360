-- 0021_compliance_features.sql
-- Adds support for:
--   - compliance_attestations: manual "I confirm this was done" records
--   - compliance_certifications: formal certification tracking per framework
--   - compliance_evaluations.next_due_at: pre-computed next-due date column
--   - compliance_evaluations.previous_status: prior status for notification diffing

-- Next-due date on evaluations (computed by the worker from rule frequency)
ALTER TABLE "compliance_evaluations"
  ADD COLUMN "next_due_at" date,
  ADD COLUMN "previous_status" text;

-- ── compliance_attestations ───────────────────────────────────────────────────
-- A manual attestation: a user confirms that a compliance requirement was met.

CREATE TABLE "compliance_attestations" (
  "id"              text        PRIMARY KEY,
  "rule_id"         text        NOT NULL REFERENCES "compliance_rules"("id") ON DELETE CASCADE,
  "tenant_id"       text        NOT NULL REFERENCES "tenants"("id"),
  "attested_by"     text        NOT NULL REFERENCES "user"("id"),
  "attested_at"     date        NOT NULL,
  "notes"           text        NOT NULL DEFAULT '',
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "compliance_attestations_rule_idx"   ON "compliance_attestations" ("rule_id");
CREATE INDEX "compliance_attestations_tenant_idx" ON "compliance_attestations" ("tenant_id");

-- ── compliance_certifications ─────────────────────────────────────────────────
-- Records a formal certification (e.g. ISO 45001 cert from BSI).
-- One-per-framework (upsert semantics in the router).

CREATE TABLE "compliance_certifications" (
  "id"                   text        PRIMARY KEY,
  "framework_id"         text        NOT NULL REFERENCES "compliance_frameworks"("id") ON DELETE CASCADE,
  "tenant_id"            text        NOT NULL REFERENCES "tenants"("id"),
  "certifying_body"      text        NOT NULL DEFAULT '',
  "certification_number" text        NOT NULL DEFAULT '',
  "certified_at"         date,
  "expires_at"           date,
  "next_audit_at"        date,
  "notes"                text        NOT NULL DEFAULT '',
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "compliance_certifications_framework_idx" ON "compliance_certifications" ("framework_id");
CREATE INDEX "compliance_certifications_tenant_idx"           ON "compliance_certifications" ("tenant_id");
