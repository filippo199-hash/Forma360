-- Platform HSE review PF-8: tenants created before the FreeHS modules
-- landed have system permission sets frozen without the 14 module keys
-- (seeding is first-time-only and system sets are read-only in the UI).
-- Backfill mirrors the seeder; each statement is idempotent.
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["riskAssessments.view"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["riskAssessments.view"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["riskAssessments.create"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["riskAssessments.create"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["riskAssessments.manage"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["riskAssessments.manage"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["coshh.view"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["coshh.view"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["coshh.create"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["coshh.create"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["coshh.manage"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["coshh.manage"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["permits.view"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["permits.view"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["permits.create"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["permits.create"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["permits.issue"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["permits.issue"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["permits.manage"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["permits.manage"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["fireSafety.view"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["fireSafety.view"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["fireSafety.record"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["fireSafety.record"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["fireSafety.create"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["fireSafety.create"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["fireSafety.manage"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Administrator', 'Manager')
  AND NOT ("permissions" @> '["fireSafety.manage"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["riskAssessments.view"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Standard')
  AND NOT ("permissions" @> '["riskAssessments.view"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["coshh.view"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Standard')
  AND NOT ("permissions" @> '["coshh.view"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["permits.view"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Standard')
  AND NOT ("permissions" @> '["permits.view"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["fireSafety.view"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Standard')
  AND NOT ("permissions" @> '["fireSafety.view"]'::jsonb);
--> statement-breakpoint
UPDATE "permission_sets"
SET "permissions" = "permissions" || '["fireSafety.record"]'::jsonb
WHERE "is_system" = true
  AND "name" IN ('Standard')
  AND NOT ("permissions" @> '["fireSafety.record"]'::jsonb);
