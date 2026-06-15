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
  `);
  process.stdout.write('[ensure-columns] OK — columns verified / added\n');
} catch (error) {
  process.stderr.write('[ensure-columns] FAILED: ' + String(error) + '\n');
  process.exit(1);
} finally {
  await pool.end();
}
