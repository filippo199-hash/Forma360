-- BUG-07: a drill with a bad outcome must raise a follow-up action, the way a
-- failed logbook check already does. The drill row needs to remember which
-- action it raised so the link is one-to-one and the action is not duplicated
-- when the same drill is corrected.
ALTER TABLE "fire_drills" ADD COLUMN IF NOT EXISTS "action_id" varchar(26);
--> statement-breakpoint
-- The per-drill evacuation target the outcome is judged against. Nullable:
-- an organisation that has not set one simply has no time-based concern.
ALTER TABLE "fire_drills" ADD COLUMN IF NOT EXISTS "evacuation_target_seconds" integer;
