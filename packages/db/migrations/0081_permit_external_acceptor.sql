-- BUG-05: a permit acceptor who is not a platform user.
--
-- The acceptor of a permit to work is normally the contractor doing the
-- job. The acceptor picker only offered registered users, so the actual
-- acceptor could not be named and testers named internal colleagues
-- instead — which defeats the control, since the point is that the person
-- who will do the work signs on to the conditions.
--
-- A named external acceptor signs on glass, countersigned by a permits.issue
-- holder: what the paper permit does, with no seat, email or link required.
ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "acceptor_name" text DEFAULT '' NOT NULL;
ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "acceptor_organisation" text DEFAULT '' NOT NULL;
ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "acceptance_witnessed_by" text;
