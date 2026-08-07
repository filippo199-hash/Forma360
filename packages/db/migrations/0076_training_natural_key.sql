-- 0076 — Training records: enforce the import natural key (TR-I06)
--
-- The CSV import deduped in memory from a SELECT taken at the top of the
-- mutation — advisory only: two imports running at once both read an empty
-- `seen` set and both insert. RAMS solved the same class with a partial
-- unique index (0070); this is the equivalent for the training record's
-- natural key.
--
-- Key: (tenant, requirement, person, achieved date) among ACTIVE records.
-- `person` is the user id when present, else the lower-cased name — exactly
-- the `personKeyOf` the router dedupes on. A renewal carries a later date and
-- a correction supersedes first, so a legitimate second record never collides.
--
-- Supersede any pre-existing active duplicate (keeping the earliest by id, a
-- time-ordered ULID) so the index can build and no history is destroyed. On a
-- re-run there are no active duplicates left, so this updates nothing.
UPDATE "training_records" t
SET "superseded_at" = now()
FROM (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "tenant_id", "requirement_id",
                        COALESCE("user_id", 'name:' || lower("person_name")),
                        "achieved_at"
           ORDER BY "id"
         ) AS rn
  FROM "training_records"
  WHERE "superseded_at" IS NULL
) d
WHERE t."id" = d."id" AND d.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "training_records_natural_key_uq"
  ON "training_records" (
    "tenant_id",
    "requirement_id",
    COALESCE("user_id", 'name:' || lower("person_name")),
    "achieved_at"
  )
  WHERE "superseded_at" IS NULL;
