-- 0024_invite_group_site.sql
-- Stores the groups and sites the admin pre-selected when inviting a user so
-- that acceptInvite can automatically apply those memberships the moment the
-- new user activates their account. No backfill needed — existing rows simply
-- get NULL, meaning no pre-assigned memberships.

ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "group_ids" jsonb;
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "site_ids" jsonb;
