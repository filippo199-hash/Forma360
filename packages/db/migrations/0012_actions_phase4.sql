-- Phase 4 — Actions module build.
--
-- Extends the Phase 2 PR 28 `actions` stub with the columns SafetyCulture
-- parity needs (reference number, site link, label, terminal-status
-- audit columns, soft-delete pointer) and lands two sibling tables for
-- per-action activity log and comment thread.

ALTER TABLE "actions" ADD COLUMN "reference_number" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "site_id" varchar(26);--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "closed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_tenant_assignee_idx" ON "actions" USING btree ("tenant_id","assignee_user_id");--> statement-breakpoint

CREATE TABLE "action_activity" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"action_id" varchar(26) NOT NULL,
	"actor_user_id" text,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_activity" ADD CONSTRAINT "action_activity_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_activity" ADD CONSTRAINT "action_activity_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_activity" ADD CONSTRAINT "action_activity_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_activity_action_created_idx" ON "action_activity" USING btree ("action_id","created_at");--> statement-breakpoint

CREATE TABLE "action_comments" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"action_id" varchar(26) NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_comments_action_idx" ON "action_comments" USING btree ("action_id","created_at");
