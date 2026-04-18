CREATE TABLE "inspection_approvals" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"inspection_id" varchar(26) NOT NULL,
	"approver_user_id" text NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_signatures" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"inspection_id" varchar(26) NOT NULL,
	"slot_index" integer NOT NULL,
	"slot_id" text NOT NULL,
	"signer_user_id" text NOT NULL,
	"signer_name" text NOT NULL,
	"signer_role" text,
	"signature_data" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"template_id" varchar(26) NOT NULL,
	"template_version_id" varchar(26) NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"title" text NOT NULL,
	"document_number" text,
	"conducted_by" text,
	"site_id" varchar(26),
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" jsonb,
	"access_snapshot" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejected_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_inspection_links" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"inspection_id" varchar(26) NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_inspection_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "actions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"source_type" text NOT NULL,
	"source_id" varchar(26),
	"source_item_id" text,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text,
	"assignee_user_id" text,
	"due_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_approvals" ADD CONSTRAINT "inspection_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_approvals" ADD CONSTRAINT "inspection_approvals_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_signatures" ADD CONSTRAINT "inspection_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_signatures" ADD CONSTRAINT "inspection_signatures_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_inspection_links" ADD CONSTRAINT "public_inspection_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_inspection_links" ADD CONSTRAINT "public_inspection_links_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspection_approvals_tenant_inspection_idx" ON "inspection_approvals" USING btree ("tenant_id","inspection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_signatures_unique_slot" ON "inspection_signatures" USING btree ("inspection_id","slot_index");--> statement-breakpoint
CREATE INDEX "inspection_signatures_tenant_inspection_idx" ON "inspection_signatures" USING btree ("tenant_id","inspection_id");--> statement-breakpoint
CREATE INDEX "inspections_tenant_status_idx" ON "inspections" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "inspections_tenant_template_idx" ON "inspections" USING btree ("tenant_id","template_id");--> statement-breakpoint
CREATE INDEX "inspections_tenant_version_idx" ON "inspections" USING btree ("tenant_id","template_version_id");--> statement-breakpoint
CREATE INDEX "inspections_tenant_createdby_idx" ON "inspections" USING btree ("tenant_id","created_by");--> statement-breakpoint
CREATE INDEX "inspections_tenant_site_idx" ON "inspections" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "public_inspection_links_tenant_inspection_idx" ON "public_inspection_links" USING btree ("tenant_id","inspection_id");--> statement-breakpoint
CREATE INDEX "actions_tenant_status_idx" ON "actions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "actions_tenant_source_idx" ON "actions" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "actions_source_item_unique" ON "actions" USING btree ("source_type","source_id","source_item_id");