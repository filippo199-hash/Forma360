-- 0051 — site FK integrity.
-- assets.site_id / documents.site_id / contractor_visits.site_id were loose
-- text columns with no FK to sites(id). Null out any orphaned references,
-- then add ON DELETE SET NULL FKs (idempotent via pg_constraint checks so the
-- same DDL can run from ensure-columns.mjs in prod).

UPDATE "assets" a
SET "site_id" = NULL
WHERE a."site_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "sites" s WHERE s."id" = a."site_id");
--> statement-breakpoint
UPDATE "documents" d
SET "site_id" = NULL
WHERE d."site_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "sites" s WHERE s."id" = d."site_id");
--> statement-breakpoint
UPDATE "contractor_visits" v
SET "site_id" = NULL
WHERE v."site_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "sites" s WHERE s."id" = v."site_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_site_id_fk') THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_site_id_fk"
      FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_site_id_fk') THEN
    ALTER TABLE "documents"
      ADD CONSTRAINT "documents_site_id_fk"
      FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_visits_site_id_fk') THEN
    ALTER TABLE "contractor_visits"
      ADD CONSTRAINT "contractor_visits_site_id_fk"
      FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;
  END IF;
END $$;
