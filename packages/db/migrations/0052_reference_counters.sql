CREATE TABLE IF NOT EXISTS "reference_counters" (
	"tenant_id" text NOT NULL,
	"series" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reference_counters_tenant_id_series_pk" PRIMARY KEY("tenant_id","series")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reference_counters" ADD CONSTRAINT "reference_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "reference_counters" ("tenant_id", "series", "value")
SELECT "tenant_id", 'issue', COALESCE(max(CAST(substring("reference_number" FROM '[0-9]+$') AS integer)), 0)
FROM "issues" GROUP BY "tenant_id"
ON CONFLICT ("tenant_id", "series") DO NOTHING;
--> statement-breakpoint
INSERT INTO "reference_counters" ("tenant_id", "series", "value")
SELECT "tenant_id", 'action', COALESCE(max(CAST(substring("reference_number" FROM '[0-9]+$') AS integer)), 0)
FROM "actions" GROUP BY "tenant_id"
ON CONFLICT ("tenant_id", "series") DO NOTHING;
