CREATE TABLE "issue_categories" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"access_rule_id" varchar(26),
	"custom_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notification_rule" varchar(20) DEFAULT 'summary' NOT NULL,
	"critical_alerts" boolean DEFAULT false NOT NULL,
	"linked_template_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_share_token" varchar(64),
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "issue_categories_public_share_token_unique" UNIQUE("public_share_token"),
	CONSTRAINT "issue_categories_notification_rule_chk" CHECK ("notification_rule" IN ('private','summary','detailed'))
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"category_id" varchar(26) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"reported_by_user_id" text,
	"reported_by_name" text,
	"reported_via" varchar(20) DEFAULT 'app' NOT NULL,
	"site_id" varchar(26),
	"location_gps" jsonb,
	"location_address" text,
	"date_occurred" timestamp with time zone DEFAULT now() NOT NULL,
	"custom_field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_question_responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"category_snapshot" jsonb NOT NULL,
	"reference_number" text NOT NULL,
	"access_snapshot" jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"closed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "issues_status_chk" CHECK ("status" IN ('open','investigation','closed')),
	CONSTRAINT "issues_reported_via_chk" CHECK ("reported_via" IN ('app','qr'))
);
--> statement-breakpoint
CREATE TABLE "issue_comments" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"issue_id" varchar(26) NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_categories" ADD CONSTRAINT "issue_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_categories" ADD CONSTRAINT "issue_categories_access_rule_id_access_rules_id_fk" FOREIGN KEY ("access_rule_id") REFERENCES "public"."access_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_categories" ADD CONSTRAINT "issue_categories_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_category_id_issue_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."issue_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_reported_by_user_id_user_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_closed_by_user_id_user_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_categories_tenant_idx" ON "issue_categories" USING btree ("tenant_id") WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "issue_categories_tenant_archived_idx" ON "issue_categories" USING btree ("tenant_id","archived_at");--> statement-breakpoint
CREATE INDEX "issues_tenant_status_idx" ON "issues" USING btree ("tenant_id","status") WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "issues_tenant_category_idx" ON "issues" USING btree ("tenant_id","category_id") WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "issues_tenant_site_idx" ON "issues" USING btree ("tenant_id","site_id") WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "issues_tenant_created_idx" ON "issues" USING btree ("tenant_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "issue_comments_issue_idx" ON "issue_comments" USING btree ("issue_id","created_at");
