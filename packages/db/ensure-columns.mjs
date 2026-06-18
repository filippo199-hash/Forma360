/**
 * ensure-columns.mjs
 *
 * Idempotent safety-net script that runs AFTER drizzle-kit migrate as part
 * of the pre-deploy command.  It directly issues the ALTER TABLE statements
 * that were added in migrations 0024 (group_ids / site_ids on invitations)
 * and 0025 (phone on user + invitations) using IF NOT EXISTS so it is always
 * safe to execute, even if those migrations already applied correctly.
 *
 * Why this exists: drizzle-kit migrate has been observed to skip migrations
 * when its internal tracking table already contains an entry for a given hash
 * even though the actual DDL was never committed to the database.  This script
 * bypasses the tracking table entirely.
 *
 * Usage (called automatically by db:migrate):
 *   node packages/db/ensure-columns.mjs
 */

// pg is a CJS package; the default import works fine in Node ESM.
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(`
    ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "group_ids" jsonb;
    ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "site_ids" jsonb;
    ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "phone" text;
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone" text;
    -- 0032: first/last name on user (To-Do #4)
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "first_name" text;
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_name" text;
    -- 0033: document-level visibility by group / site (To-Do #5)
    ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "visible_to_group_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "visible_to_site_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
    -- 0034: maintenance programs (To-Do #3)
    CREATE TABLE IF NOT EXISTS "maintenance_programs" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "name" text NOT NULL,
      "description" text NOT NULL DEFAULT '',
      "archived_at" timestamptz,
      "created_by" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "maintenance_program_triggers" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "program_id" varchar(26) NOT NULL REFERENCES "maintenance_programs"("id") ON DELETE CASCADE,
      "title" text NOT NULL,
      "trigger_type" text NOT NULL,
      "interval_days" integer,
      "interval_value" numeric,
      "usage_field" text,
      "unit" text,
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "maintenance_program_assets" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "program_id" varchar(26) NOT NULL REFERENCES "maintenance_programs"("id") ON DELETE CASCADE,
      "asset_id" text NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "maintenance_program_assets_unique" ON "maintenance_program_assets" ("program_id", "asset_id");
  `);
  process.stdout.write('[ensure-columns] OK — columns verified / added\n');
} catch (error) {
  process.stderr.write('[ensure-columns] FAILED: ' + String(error) + '\n');
  process.exit(1);
} finally {
  await pool.end();
}
