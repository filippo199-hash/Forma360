-- Platform HSE review PF-16: reminderDays were stored and displayed but
-- read by no worker. The stamp dedupes the new document-expiry worker.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "last_expiry_reminder_at" timestamp with time zone;
