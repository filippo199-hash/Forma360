-- Documents v2 — Phase 5D.
--
-- 1. Folder visibility: group / site access lists (JSONB arrays).
-- 2. Document lifecycle: start_date, expires_at, responsible party,
--    reminder_days before expiry (JSONB int array).
-- 3. Structured labels: new document_labels table; documents store
--    label_ids as a JSONB array.

-- ── Folder visibility ────────────────────────────────────────────────

ALTER TABLE "document_folders"
  ADD COLUMN "visible_to_group_ids" jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN "visible_to_site_ids"  jsonb NOT NULL DEFAULT '[]';

--> statement-breakpoint

-- ── Document lifecycle ───────────────────────────────────────────────

ALTER TABLE "documents"
  ADD COLUMN "start_date"             timestamp with time zone,
  ADD COLUMN "expires_at"             timestamp with time zone,
  ADD COLUMN "responsible_user_id"    text,
  ADD COLUMN "responsible_group_id"   text,
  ADD COLUMN "reminder_days"          jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN "label_ids"              jsonb NOT NULL DEFAULT '[]';

--> statement-breakpoint

-- ── Document labels ──────────────────────────────────────────────────

CREATE TABLE "document_labels" (
  "id"                  text PRIMARY KEY NOT NULL,
  "tenant_id"           text NOT NULL,
  "name"                text NOT NULL,
  "color"               text NOT NULL DEFAULT '#6366f1',
  "created_by_user_id"  text NOT NULL,
  "created_at"          timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "document_labels_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "document_labels_created_by_user_id_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

--> statement-breakpoint

CREATE INDEX "document_labels_tenant_idx" ON "document_labels" ("tenant_id");

--> statement-breakpoint

CREATE UNIQUE INDEX "document_labels_tenant_name_unique"
  ON "document_labels" ("tenant_id", "name");
