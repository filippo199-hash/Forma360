CREATE TABLE IF NOT EXISTS "site_groups" (
	"tenant_id" varchar(26) NOT NULL,
	"site_id" varchar(26) NOT NULL,
	"group_id" varchar(26) NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_groups_site_group_pk" PRIMARY KEY("site_id","group_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_groups" ADD CONSTRAINT "site_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_groups" ADD CONSTRAINT "site_groups_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_groups" ADD CONSTRAINT "site_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_groups_tenant_group_idx" ON "site_groups" ("tenant_id","group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_groups_tenant_site_idx" ON "site_groups" ("tenant_id","site_id");
