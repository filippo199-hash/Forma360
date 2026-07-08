CREATE TABLE IF NOT EXISTS "site_plans" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "site_id" varchar(26) NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "storage_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'image',
  "sort_order" integer NOT NULL DEFAULT 0,
  "uploaded_by" varchar(64) NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "site_plans_tenant_idx" ON "site_plans" ("tenant_id");
CREATE INDEX IF NOT EXISTS "site_plans_site_idx" ON "site_plans" ("tenant_id", "site_id");

CREATE TABLE IF NOT EXISTS "site_plan_pins" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "plan_id" varchar(26) NOT NULL REFERENCES "site_plans"("id") ON DELETE CASCADE,
  "site_id" varchar(26) NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "x" real NOT NULL,
  "y" real NOT NULL,
  "entity_type" text NOT NULL DEFAULT 'note',
  "entity_id" varchar(26),
  "label" text NOT NULL DEFAULT '',
  "created_by" varchar(64) NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "site_plan_pins_tenant_idx" ON "site_plan_pins" ("tenant_id");
CREATE INDEX IF NOT EXISTS "site_plan_pins_plan_idx" ON "site_plan_pins" ("tenant_id", "plan_id");
