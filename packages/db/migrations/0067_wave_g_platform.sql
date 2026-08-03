-- Platform HSE review, Wave G (platform services).
-- PF-20: per-user language — emails and the UI switcher persist it.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "locale" text;
--> statement-breakpoint
-- PF-23: per-user notification preferences (jsonb map of toggles).
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "notification_prefs" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
-- PF-23: the in-app notification centre.
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" varchar(26) PRIMARY KEY,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "user_id" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "href" text,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx" ON "notifications" ("tenant_id","user_id","read_at","created_at");
--> statement-breakpoint
-- PF-31: retention policy v1 — applies to notifications + event/audit rows
-- only (never statutory safety records).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "retention_months" integer;
