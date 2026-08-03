-- Platform HSE review PF-4: the Actions hub sent no notifications at
-- all. The reminder worker stamps per-action so due-soon fires once and
-- overdue re-pings weekly without spamming daily.
ALTER TABLE "actions" ADD COLUMN IF NOT EXISTS "due_soon_reminded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN IF NOT EXISTS "overdue_reminded_at" timestamp with time zone;
