-- Phase 4b — Action types (categories), custom questions, priority-
-- based auto due dates, recurrence, and per-type transition rules.
--
-- See packages/db/src/schema/actions.ts + packages/shared/src/actions-schema.ts
-- for the full doc comments.

CREATE TABLE "action_types" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"custom_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text DEFAULT 'all_users' NOT NULL,
	"transition_rules" jsonb DEFAULT '{"completed":{"allowedGroupIds":[]},"cancelled":{"allowedGroupIds":[]}}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "action_types" ADD CONSTRAINT "action_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict;
ALTER TABLE "action_types" ADD CONSTRAINT "action_types_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;
CREATE INDEX "action_types_tenant_idx" ON "action_types" USING btree ("tenant_id");
CREATE UNIQUE INDEX "action_types_tenant_name_active_uniq" ON "action_types" USING btree ("tenant_id","name") WHERE archived_at IS NULL;

CREATE TABLE "tenant_action_settings" (
	"tenant_id" varchar(26) PRIMARY KEY NOT NULL,
	"priority_due_date_days" jsonb DEFAULT '{"low":30,"medium":7,"high":1,"critical":1}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "tenant_action_settings" ADD CONSTRAINT "tenant_action_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict;

ALTER TABLE "actions" ADD COLUMN "action_type_id" varchar(26);
ALTER TABLE "actions" ADD COLUMN "custom_question_responses" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "actions" ADD COLUMN "recurrence" jsonb;
ALTER TABLE "actions" ADD COLUMN "recurrence_parent_id" varchar(26);

ALTER TABLE "actions" ADD CONSTRAINT "actions_action_type_id_action_types_id_fk" FOREIGN KEY ("action_type_id") REFERENCES "public"."action_types"("id") ON DELETE set null;
CREATE INDEX "actions_tenant_type_idx" ON "actions" USING btree ("tenant_id","action_type_id");
