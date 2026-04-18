CREATE TABLE "template_versions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"template_id" varchar(26) NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" varchar(26),
	"access_rule_id" varchar(26),
	"title_format" text DEFAULT '{date}' NOT NULL,
	"document_number_counter" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "global_response_sets" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"multi_select" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_access_rule_id_access_rules_id_fk" FOREIGN KEY ("access_rule_id") REFERENCES "public"."access_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_response_sets" ADD CONSTRAINT "global_response_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_template_version_unique" ON "template_versions" USING btree ("template_id","version_number");--> statement-breakpoint
CREATE INDEX "template_versions_tenant_template_idx" ON "template_versions" USING btree ("tenant_id","template_id");--> statement-breakpoint
CREATE INDEX "templates_tenant_id_status_idx" ON "templates" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "templates_tenant_id_archived_at_idx" ON "templates" USING btree ("tenant_id","archived_at");--> statement-breakpoint
CREATE INDEX "global_response_sets_tenant_id_idx" ON "global_response_sets" USING btree ("tenant_id","name");