-- Add recipient specs for observation category notifications and critical alerts.
-- Null = fall back to all-admin broadcast (backwards-compatible default).
ALTER TABLE "issue_categories"
  ADD COLUMN IF NOT EXISTS "notification_recipient_spec" jsonb,
  ADD COLUMN IF NOT EXISTS "critical_alert_recipient_spec" jsonb;
