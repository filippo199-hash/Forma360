-- 0025_user_phone.sql
-- Adds an optional phone number field to both the user table (permanent
-- profile data) and the invitations table (so admins can pre-fill the
-- phone at invite time and it is applied automatically on acceptance).
-- Stored in E.164-ish format: "+{countryCode}{number}", e.g. "+15551234567".

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "phone" text;
