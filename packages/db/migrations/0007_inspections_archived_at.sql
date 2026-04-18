ALTER TABLE "inspections" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "inspections_tenant_archived_idx" ON "inspections" ("tenant_id","archived_at");
