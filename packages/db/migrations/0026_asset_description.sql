-- Add description field to assets table for editable asset overview.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
