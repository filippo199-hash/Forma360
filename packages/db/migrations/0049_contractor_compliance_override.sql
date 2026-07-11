ALTER TABLE "contractors" ADD COLUMN IF NOT EXISTS "compliance_override" text;
--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN IF NOT EXISTS "compliance_override_reason" text;
