-- Fire logbook: editable checks + manager-added custom checks.
--
--   - `label`: display name for `check_type = 'custom'` rows (catalogue
--     rows keep their i18n'd type name and leave this '').
--   - `dismissed_at`: a manager removed the check from the calendar.
--     History survives (`active` already soft-deletes); the marker exists
--     so `syncAutoChecks` never resurrects a deliberately removed row.
--   - `check_id` on entries: which schedule row an entry satisfied —
--     `check_type` alone is ambiguous once several custom checks coexist.
--     (Column exists since 0060; the IF NOT EXISTS keeps this re-runnable.)
--   - the building × type unique index becomes PARTIAL so any number of
--     custom checks can coexist on one building.
ALTER TABLE "fire_logbook_checks" ADD COLUMN IF NOT EXISTS "label" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "fire_logbook_checks" ADD COLUMN IF NOT EXISTS "dismissed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "fire_logbook_entries" ADD COLUMN IF NOT EXISTS "check_id" varchar(26);
--> statement-breakpoint
DROP INDEX IF EXISTS "fire_checks_building_type_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "fire_checks_building_type_uq" ON "fire_logbook_checks" ("building_id","check_type") WHERE "check_type" <> 'custom';
