-- 0022_action_type_labels.sql
-- Adds a `labels` JSONB column to `action_types` so admins can define a
-- preset list of label options for each action type. The create-action
-- form renders these as a dropdown instead of a free-text input when
-- the selected type has at least one label configured.

ALTER TABLE "action_types"
  ADD COLUMN IF NOT EXISTS "labels" jsonb NOT NULL DEFAULT '[]'::jsonb;
