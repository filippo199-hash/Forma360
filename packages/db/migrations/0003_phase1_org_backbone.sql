CREATE TABLE "custom_user_fields" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" text DEFAULT 'false' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_custom_field_values" (
	"tenant_id" varchar(26) NOT NULL,
	"user_id" text NOT NULL,
	"field_id" varchar(26) NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"tenant_id" varchar(26) NOT NULL,
	"group_id" varchar(26) NOT NULL,
	"user_id" text NOT NULL,
	"added_via" text DEFAULT 'manual' NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_membership_rules" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"group_id" varchar(26) NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"membership_mode" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "site_members" (
	"tenant_id" varchar(26) NOT NULL,
	"site_id" varchar(26) NOT NULL,
	"user_id" text NOT NULL,
	"added_via" text DEFAULT 'manual' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_membership_rules" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"site_id" varchar(26) NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"parent_id" varchar(26),
	"depth" integer DEFAULT 0 NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"membership_mode" text DEFAULT 'manual' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "sites_tenant_id_parent_id_name_unique" UNIQUE NULLS NOT DISTINCT("tenant_id","parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "access_rules" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"site_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "custom_user_fields" ADD CONSTRAINT "custom_user_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_custom_field_values" ADD CONSTRAINT "user_custom_field_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_custom_field_values" ADD CONSTRAINT "user_custom_field_values_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_custom_field_values" ADD CONSTRAINT "user_custom_field_values_field_id_custom_user_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_user_fields"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership_rules" ADD CONSTRAINT "group_membership_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership_rules" ADD CONSTRAINT "group_membership_rules_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_members" ADD CONSTRAINT "site_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_members" ADD CONSTRAINT "site_members_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_members" ADD CONSTRAINT "site_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_membership_rules" ADD CONSTRAINT "site_membership_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_membership_rules" ADD CONSTRAINT "site_membership_rules_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_parent_id_sites_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_user_fields_tenant_id_idx" ON "custom_user_fields" USING btree ("tenant_id","order");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_user_fields_tenant_id_name_unique" ON "custom_user_fields" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "user_custom_field_values_user_id_field_id_unique" ON "user_custom_field_values" USING btree ("user_id","field_id");--> statement-breakpoint
CREATE INDEX "user_custom_field_values_tenant_id_field_id_idx" ON "user_custom_field_values" USING btree ("tenant_id","field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_id_user_id_unique" ON "group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "group_members_tenant_id_user_id_idx" ON "group_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "group_membership_rules_tenant_id_group_id_idx" ON "group_membership_rules" USING btree ("tenant_id","group_id","order");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_tenant_id_name_unique" ON "groups" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "site_members_site_id_user_id_unique" ON "site_members" USING btree ("site_id","user_id");--> statement-breakpoint
CREATE INDEX "site_members_tenant_id_user_id_idx" ON "site_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "site_membership_rules_tenant_id_site_id_idx" ON "site_membership_rules" USING btree ("tenant_id","site_id","order");--> statement-breakpoint
CREATE INDEX "sites_tenant_id_parent_id_idx" ON "sites" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "sites_tenant_id_path_idx" ON "sites" USING btree ("tenant_id","path");--> statement-breakpoint
CREATE INDEX "access_rules_tenant_id_idx" ON "access_rules" USING btree ("tenant_id","invalidated_at");