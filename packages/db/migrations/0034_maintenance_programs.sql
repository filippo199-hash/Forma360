-- Maintenance Programs (To-Do #3): reusable program = bundle of triggers
-- attached to assets; each trigger materialises a future-dated Action.
CREATE TABLE IF NOT EXISTS "maintenance_programs" (
  "id"          varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id"   varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "name"        text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "archived_at" timestamptz,
  "created_by"  text NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "maintenance_programs_tenant_idx" ON "maintenance_programs" ("tenant_id");

CREATE TABLE IF NOT EXISTS "maintenance_program_triggers" (
  "id"             varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id"      varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "program_id"     varchar(26) NOT NULL REFERENCES "maintenance_programs"("id") ON DELETE CASCADE,
  "title"          text NOT NULL,
  "trigger_type"   text NOT NULL,
  "interval_days"  integer,
  "interval_value" numeric,
  "usage_field"    text,
  "unit"           text,
  "sort_order"     integer NOT NULL DEFAULT 0,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "maintenance_program_triggers_program_idx" ON "maintenance_program_triggers" ("program_id");
CREATE INDEX IF NOT EXISTS "maintenance_program_triggers_tenant_idx" ON "maintenance_program_triggers" ("tenant_id");

CREATE TABLE IF NOT EXISTS "maintenance_program_assets" (
  "id"         varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id"  varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "program_id" varchar(26) NOT NULL REFERENCES "maintenance_programs"("id") ON DELETE CASCADE,
  "asset_id"   text NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "maintenance_program_assets_unique" ON "maintenance_program_assets" ("program_id", "asset_id");
CREATE INDEX IF NOT EXISTS "maintenance_program_assets_asset_idx" ON "maintenance_program_assets" ("asset_id");
CREATE INDEX IF NOT EXISTS "maintenance_program_assets_tenant_idx" ON "maintenance_program_assets" ("tenant_id");
