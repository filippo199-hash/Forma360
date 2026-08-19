/**
 * migrate-verify.mjs
 *
 * Post-migrate parity check: proves the migration history that exists on
 * disk is the history the database actually recorded. Run it AFTER
 * `drizzle-kit migrate` against a database migrated from zero (CI's
 * deploy-smoke job does exactly that).
 *
 * Why this exists: drizzle-kit only applies migrations it finds in
 * `meta/_journal.json`. Five migrations once sat on disk with no journal
 * entry and were silently skipped for weeks — production survived on
 * ensure-columns.mjs. `migrations-integrity.test.ts` now pins
 * file ↔ journal parity statically; this script closes the remaining
 * gap by checking the DATABASE side: every journal entry must have a
 * corresponding row in drizzle's tracking table, so "migrate ran green
 * but applied nothing" can never pass CI again.
 *
 * Checks, in order:
 *   1. Every `.sql` file has a journal entry and vice versa (names
 *      printed on mismatch — this is the static check re-asserted at the
 *      deploy boundary, where it is cheap).
 *   2. The count of rows in drizzle's tracking table equals the journal
 *      entry count.
 *
 * Usage:
 *   DATABASE_URL=postgres://… node packages/db/migrate-verify.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// pg is a CJS package; the default import works fine in Node ESM.
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'));
const journalTags = journal.entries.map((e) => e.tag);

const sqlFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.replace(/\.sql$/, ''));

const journalSet = new Set(journalTags);
const fileSet = new Set(sqlFiles);
const unjournaled = sqlFiles.filter((f) => !journalSet.has(f));
const missingFiles = journalTags.filter((t) => !fileSet.has(t));

if (unjournaled.length > 0 || missingFiles.length > 0) {
  if (unjournaled.length > 0) {
    console.error(
      `[migrate-verify] FAIL — migration files with NO journal entry (drizzle-kit silently skips these):\n  ${unjournaled.join('\n  ')}`,
    );
  }
  if (missingFiles.length > 0) {
    console.error(
      `[migrate-verify] FAIL — journal entries with no .sql file:\n  ${missingFiles.join('\n  ')}`,
    );
  }
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
  const applied = rows[0].n;
  if (applied !== journalTags.length) {
    console.error(
      `[migrate-verify] FAIL — journal has ${journalTags.length} entries but the database recorded ${applied} applied migrations. ` +
        'drizzle-kit migrate did not apply the full history.',
    );
    process.exit(1);
  }
  console.log(
    `[migrate-verify] OK — ${sqlFiles.length} files ↔ ${journalTags.length} journal entries ↔ ${applied} applied`,
  );
} finally {
  await pool.end();
}
