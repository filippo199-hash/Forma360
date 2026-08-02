-- Point-of-work COSHH assessments (C-6) + stale-publish detection (C-15):
-- `kind` distinguishes the mobile at-the-task flow; `last_published_at`
-- is stamped on every publish so "changed since publish" is computable.
ALTER TABLE "coshh_assessments" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'standing' NOT NULL;--> statement-breakpoint
ALTER TABLE "coshh_assessments" ADD COLUMN IF NOT EXISTS "last_published_at" timestamp with time zone;
