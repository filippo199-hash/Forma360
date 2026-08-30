-- Dashboards, review round 4:
--   dashboard_share_groups — group grants for visibility='selected';
--     access resolves through live group_members rows at read time.
--   dashboard_favourites   — per-user stars pinning dashboards to the
--     top of the home page. Preference only, no access semantics.
CREATE TABLE IF NOT EXISTS "dashboard_share_groups" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "dashboard_id" varchar(26) NOT NULL REFERENCES "dashboards"("id") ON DELETE CASCADE,
  "group_id" varchar(26) NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_share_groups_unique"
  ON "dashboard_share_groups" ("dashboard_id", "group_id");
CREATE INDEX IF NOT EXISTS "dashboard_share_groups_tenant_group_idx"
  ON "dashboard_share_groups" ("tenant_id", "group_id");

CREATE TABLE IF NOT EXISTS "dashboard_favourites" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "dashboard_id" varchar(26) NOT NULL REFERENCES "dashboards"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_favourites_unique"
  ON "dashboard_favourites" ("dashboard_id", "user_id");
CREATE INDEX IF NOT EXISTS "dashboard_favourites_tenant_user_idx"
  ON "dashboard_favourites" ("tenant_id", "user_id");
