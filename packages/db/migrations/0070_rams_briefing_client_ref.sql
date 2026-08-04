-- 0070 — RAMS briefing idempotency key (review finding RS-A7)
--
-- The briefings router always accepted a `clientRef` "so an offline
-- replay is idempotent" and then discarded it: there was no column. A
-- flush that retried — or one that re-sent the whole queue while an
-- earlier entry was still in flight — recorded the same operative twice
-- in the briefing register.
--
-- The unique index is partial so every row written before this (and any
-- future non-queued path) is unaffected.
ALTER TABLE "rams_briefings" ADD COLUMN IF NOT EXISTS "client_ref" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rams_briefings_client_ref_uq"
  ON "rams_briefings" ("pack_id", "client_ref")
  WHERE "client_ref" IS NOT NULL;
