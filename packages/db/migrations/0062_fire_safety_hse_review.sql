-- HSE practitioner review of the Fire Safety module (docs/reviews/
-- fire-safety-hse-expert-review.md) — schema for FS-1 (failed checks
-- stay visible), FS-7 (attestation staleness), FS-8 (marshal cover is
-- opt-in per building with a required minimum).
ALTER TABLE "fire_logbook_checks" ADD COLUMN IF NOT EXISTS "last_result" text;
--> statement-breakpoint
ALTER TABLE "fire_doors" ADD COLUMN IF NOT EXISTS "last_outcome" text;
--> statement-breakpoint
ALTER TABLE "fire_buildings" ADD COLUMN IF NOT EXISTS "requires_marshal_cover" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "fire_buildings" ADD COLUMN IF NOT EXISTS "marshal_target" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "fire_risk_assessments" ADD COLUMN IF NOT EXISTS "content_updated_at" timestamp with time zone;
--> statement-breakpoint
-- Backfill: surface any failure already recorded (FS-1 applies to
-- existing data, not just new entries). Latest entry per check wins.
UPDATE "fire_logbook_checks" c
SET "last_result" = sub.result
FROM (
  SELECT DISTINCT ON (check_id) check_id, result
  FROM "fire_logbook_entries"
  WHERE check_id IS NOT NULL
  ORDER BY check_id, performed_at DESC
) sub
WHERE sub.check_id = c.id AND c."last_result" IS NULL;
--> statement-breakpoint
UPDATE "fire_doors" d
SET "last_outcome" = sub.outcome
FROM (
  SELECT DISTINCT ON (door_id) door_id, outcome
  FROM "fire_door_inspections"
  ORDER BY door_id, inspected_at DESC
) sub
WHERE sub.door_id = d.id AND d."last_outcome" IS NULL;
--> statement-breakpoint
-- Published FRAs start non-stale: treat the published content as the
-- attested content (the event log keeps the true edit history).
UPDATE "fire_risk_assessments"
SET "content_updated_at" = "published_at"
WHERE "published_at" IS NOT NULL AND "content_updated_at" IS NULL;
