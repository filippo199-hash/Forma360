-- Fire buildings get a photo (review round 4): the R2 object key of the
-- image shown as the register thumbnail and record header. Nullable —
-- every existing building simply has none.
ALTER TABLE "fire_buildings"
  ADD COLUMN IF NOT EXISTS "image_key" text;
