CREATE TABLE IF NOT EXISTS "contractor_assets" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"contractor_id" varchar(26) NOT NULL,
	"asset_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_assets" ADD CONSTRAINT "contractor_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_assets" ADD CONSTRAINT "contractor_assets_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contractor_assets" ADD CONSTRAINT "contractor_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractor_assets_unique" ON "contractor_assets" ("contractor_id","asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractor_assets_asset_idx" ON "contractor_assets" ("tenant_id","asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractor_assets_contractor_idx" ON "contractor_assets" ("tenant_id","contractor_id");
