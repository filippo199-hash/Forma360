-- Per-user Focus rules (review round 4): deterministic boost/demote
-- preferences the My-work Focus ranking compiles in. One row per rule;
-- `note` keeps the user's own words.
CREATE TABLE IF NOT EXISTS "user_work_priorities" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "rule_type" text NOT NULL,
  "value" text NOT NULL,
  "direction" text NOT NULL,
  "note" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_work_priorities_user_idx"
  ON "user_work_priorities" ("tenant_id", "user_id");
