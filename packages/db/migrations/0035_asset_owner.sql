-- Asset owner: a single responsible user per asset. Nullable so existing
-- rows keep working; the create/edit asset flows set it from a searchable
-- user picker. ON DELETE SET NULL so removing a user clears ownership
-- rather than deleting the asset (ADR 0002 — no cross-tenant cascade).
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "owner_user_id" text;
DO $$ BEGIN
  ALTER TABLE "assets"
    ADD CONSTRAINT "assets_owner_user_id_user_id_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "assets_owner_idx" ON "assets" ("owner_user_id");
