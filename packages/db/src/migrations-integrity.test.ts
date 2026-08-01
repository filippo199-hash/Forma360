/**
 * Migration-chain integrity (pglite integration).
 *
 * Exists because of a production incident (2026-08-01): migrations 0026–0052
 * were hand-written without journal entries, so `drizzle-kit migrate`
 * silently skipped them. A brand-new deployment (FreeHS) came up missing 27
 * migrations' worth of schema while every existing environment kept working.
 *
 * Three invariants, permanently enforced:
 *   1. Every migrations/NNNN_*.sql file is registered in meta/_journal.json,
 *      in filename order, with contiguous idx values — a file without a
 *      journal entry is a migration that will never run in production.
 *   2. The full chain applies cleanly to an empty database (fresh-install
 *      path — what a new brand deployment runs).
 *   3. Re-applying every migration after the last snapshot-backed one
 *      (0026+) onto an already-migrated database is a no-op — the
 *      journal-repair scenario, where an existing production database
 *      (Forma360) sees those files "for the first time" even though its DDL
 *      already exists. Requires every statement in those files to be
 *      idempotent (IF NOT EXISTS / DO-block guards / ON CONFLICT).
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

/** First migration that exists only as hand-written SQL (no snapshot). */
const FIRST_HANDWRITTEN = '0026';

async function listMigrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
}

async function applyFile(client: PGlite, file: string): Promise<void> {
  const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
  for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
    if (stmt.length > 0) await client.exec(stmt);
  }
}

describe('migration chain integrity', () => {
  it('registers every .sql file in the drizzle journal, in order', async () => {
    const files = await listMigrationFiles();
    const journalRaw = await readFile(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8');
    const journal = JSON.parse(journalRaw) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    const journalTags = journal.entries
      .slice()
      .sort((a, b) => a.idx - b.idx)
      .map((e) => e.tag);
    const fileTags = files.map((f) => f.replace(/\.sql$/, ''));

    // Exact 1:1 match — a missing entry means drizzle-kit migrate will
    // silently skip that file on every database forever.
    expect(journalTags).toEqual(fileTags);

    // idx values must be contiguous from 0 so ordering is unambiguous.
    journal.entries
      .slice()
      .sort((a, b) => a.idx - b.idx)
      .forEach((entry, i) => {
        expect(entry.idx).toBe(i);
      });
  });

  it('applies the full chain on a fresh database, then re-applies 0026+ as a no-op', async () => {
    const client = new PGlite();
    const files = await listMigrationFiles();

    // Fresh-install path (new brand deployment).
    for (const file of files) {
      await applyFile(client, file);
    }

    // Journal-repair path (existing production database): the hand-written
    // tail must tolerate running against DDL that already exists.
    const handWritten = files.filter((f) => f >= FIRST_HANDWRITTEN);
    expect(handWritten.length).toBeGreaterThan(0);
    for (const file of handWritten) {
      await applyFile(client, file);
    }

    // Smoke-check a column from migration 0028 — the one whose absence
    // broke FreeHS sign-up.
    const res = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'issue_categories' AND column_name = 'notification_recipient_spec'`,
    );
    expect(res.rows.length).toBe(1);

    await client.close();
  }, 120_000);
});
