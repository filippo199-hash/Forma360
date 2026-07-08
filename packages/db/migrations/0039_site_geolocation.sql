ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "latitude" real;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "longitude" real;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "location_address" text;
