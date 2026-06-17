-- First/last name on user (To-Do #4). Nullable so existing rows keep
-- working; profile + invite flows populate both and write name = "First Last".
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "first_name" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_name" text;
