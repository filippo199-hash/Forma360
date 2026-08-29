-- Per-investigation visibility circle: user ids named when the
-- investigation is started (or edited by the lead/an admin). NULL means
-- unrestricted — the pre-existing behaviour, so every current row keeps
-- its visibility unchanged.
ALTER TABLE "incident_investigations"
  ADD COLUMN IF NOT EXISTS "participant_user_ids" jsonb;
