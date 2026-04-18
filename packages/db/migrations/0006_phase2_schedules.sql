CREATE TABLE "template_schedules" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"template_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"rrule" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"assignee_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignee_group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"site_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reminder_minutes_before" integer,
	"paused" boolean DEFAULT false NOT NULL,
	"last_materialised_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_inspection_occurrences" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"schedule_id" varchar(26) NOT NULL,
	"template_id" varchar(26) NOT NULL,
	"occurrence_at" timestamp with time zone NOT NULL,
	"assignee_user_id" text,
	"site_id" varchar(26),
	"inspection_id" varchar(26),
	"status" text DEFAULT 'pending' NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_schedules" ADD CONSTRAINT "template_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_schedules" ADD CONSTRAINT "template_schedules_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_inspection_occurrences" ADD CONSTRAINT "scheduled_inspection_occurrences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_inspection_occurrences" ADD CONSTRAINT "scheduled_inspection_occurrences_schedule_id_template_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."template_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_inspection_occurrences" ADD CONSTRAINT "scheduled_inspection_occurrences_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_inspection_occurrences" ADD CONSTRAINT "scheduled_inspection_occurrences_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_schedules_tenant_template_idx" ON "template_schedules" USING btree ("tenant_id","template_id");--> statement-breakpoint
CREATE INDEX "template_schedules_tenant_paused_idx" ON "template_schedules" USING btree ("tenant_id","paused");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_inspection_occurrences_unique" ON "scheduled_inspection_occurrences" USING btree ("schedule_id","assignee_user_id","occurrence_at");--> statement-breakpoint
CREATE INDEX "scheduled_inspection_occurrences_tenant_status_idx" ON "scheduled_inspection_occurrences" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "scheduled_inspection_occurrences_tenant_assignee_status_idx" ON "scheduled_inspection_occurrences" USING btree ("tenant_id","assignee_user_id","status");
