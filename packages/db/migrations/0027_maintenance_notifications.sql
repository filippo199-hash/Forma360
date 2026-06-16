-- Track which maintenance notifications have been sent to prevent duplicates.
-- notifications_log: { [dueDateISO]: number[] } — maps due-date to the
-- notificationDaysBefore values already dispatched for that cycle.
ALTER TABLE maintenance_plan_assets
  ADD COLUMN IF NOT EXISTS notifications_log jsonb NOT NULL DEFAULT '{}';
