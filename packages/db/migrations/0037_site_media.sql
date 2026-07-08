CREATE TABLE IF NOT EXISTS "site_media" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "site_id" varchar(26) NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "storage_key" text NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "kind" text NOT NULL DEFAULT 'photo',
  "caption" text NOT NULL DEFAULT '',
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "captured_at" timestamptz,
  "uploaded_by" varchar(64) NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "site_media_tenant_idx" ON "site_media" ("tenant_id");
CREATE INDEX IF NOT EXISTS "site_media_site_idx" ON "site_media" ("tenant_id", "site_id");
