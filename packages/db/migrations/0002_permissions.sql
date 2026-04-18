CREATE TABLE "permission_sets" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "permission_set_id" varchar(26) NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "permission_sets" ADD CONSTRAINT "permission_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permission_sets_tenant_id_name_idx" ON "permission_sets" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_permission_set_id_permission_sets_id_fk" FOREIGN KEY ("permission_set_id") REFERENCES "public"."permission_sets"("id") ON DELETE restrict ON UPDATE no action;