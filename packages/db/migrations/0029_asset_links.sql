-- inspection_asset_selections: one row per (inspection, question, asset).
-- Populated by inspections.saveProgress whenever an "asset" question
-- response is saved. Enables efficient reverse lookup so an asset's
-- detail page can show every inspection that explicitly tagged it.
CREATE TABLE IF NOT EXISTS "inspection_asset_selections" (
  "id"            text         PRIMARY KEY NOT NULL,
  "tenant_id"     varchar(26)  NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "inspection_id" varchar(26)  NOT NULL REFERENCES "inspections"("id") ON DELETE CASCADE,
  "question_id"   text         NOT NULL,
  "asset_id"      text         NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ias_insp_q_asset_uniq"
  ON "inspection_asset_selections" ("inspection_id", "question_id", "asset_id");
CREATE INDEX IF NOT EXISTS "ias_asset_tenant_idx"
  ON "inspection_asset_selections" ("tenant_id", "asset_id");
CREATE INDEX IF NOT EXISTS "ias_inspection_idx"
  ON "inspection_asset_selections" ("inspection_id");

-- action_assets: assets explicitly linked to an action.
CREATE TABLE IF NOT EXISTS "action_assets" (
  "id"        text         PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26)  NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "action_id" varchar(26)  NOT NULL REFERENCES "actions"("id") ON DELETE CASCADE,
  "asset_id"  text         NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "aa_action_asset_uniq"
  ON "action_assets" ("action_id", "asset_id");
CREATE INDEX IF NOT EXISTS "aa_asset_tenant_idx"
  ON "action_assets" ("tenant_id", "asset_id");

-- issue_assets: assets explicitly linked to an observation/issue.
CREATE TABLE IF NOT EXISTS "issue_assets" (
  "id"        text         PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26)  NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "issue_id"  varchar(26)  NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "asset_id"  text         NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ia_issue_asset_uniq"
  ON "issue_assets" ("issue_id", "asset_id");
CREATE INDEX IF NOT EXISTS "ia_asset_tenant_idx"
  ON "issue_assets" ("tenant_id", "asset_id");
