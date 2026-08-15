/**
 * The migrations must build the schema the ORM believes in (MIG-L01/L02).
 *
 * Sixteen test files used to boot pglite from a hand-written subset of the
 * migrations, for speed. The cost was a manual chore CLAUDE.md had to
 * document — "add the next migration to that list when a schema change
 * lands" — and missing it left a table half-built: Drizzle writes every
 * column it knows about, so the first insert failed with
 * `column does not exist`, in suites unrelated to the change that caused
 * it. Adding `sites.timezone` broke two that way, and this guard found
 * fourteen more lists already behind.
 *
 * The lists are gone; every harness reads the directory. These two tests
 * keep it that way and check the thing the lists were only a proxy for:
 *
 *   L01 — no test reintroduces a hardcoded subset.
 *   L02 — applying every migration produces, for each table the ORM models,
 *         all the columns it declares. This catches the more valuable case
 *         too: a column added to a Drizzle table with no migration behind
 *         it, which passes typecheck and fails in production.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@forma360/db/schema';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'db', 'migrations');
/** This file talks ABOUT the pattern; it must not be scanned for it. */
const SELF = 'migration-lists.test.ts';

/**
 * Tables the ORM models that NO migration creates — they are created only by
 * `packages/db/ensure-columns.mjs`, which runs after `drizzle-kit migrate`
 * in the Railway pre-deploy step.
 *
 * Production is therefore fine, but this is a genuine gap and not a pattern
 * to copy: `drizzle-kit migrate` alone does not produce a working schema,
 * and any harness that applies only the migrations lacks these two. They are
 * named here rather than tolerated silently, so the list can only shrink.
 */
const CREATED_ONLY_BY_ENSURE_COLUMNS = new Set(['action_saved_views', 'whatsapp_opt_outs']);

async function testFiles(): Promise<string[]> {
  const out: string[] = [];
  const roots = [
    join(REPO_ROOT, 'packages', 'api', 'src'),
    join(REPO_ROOT, 'packages', 'jobs', 'src'),
    join(REPO_ROOT, 'packages', 'render', 'src'),
  ];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        await walk(full);
      } else if (entry.name.endsWith('.test.ts') && entry.name !== SELF) {
        out.push(full);
      }
    }
  };
  for (const root of roots) await walk(root);
  return out.sort();
}

/** Every column the ORM declares, keyed by table name. */
function ormColumns(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (typeof value !== 'object' || value === null) continue;
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(value as PgTable);
    } catch {
      continue; // Not a table (enum, type, helper, …).
    }
    out.set(config.name, new Set(config.columns.map((c) => c.name)));
  }
  return out;
}

describe('migrations vs the ORM', () => {
  it('MIG-L01 — no test boots from a hardcoded subset of the migrations', async () => {
    const offenders: string[] = [];
    for (const file of await testFiles()) {
      const src = await readFile(file, 'utf-8');
      // A list of `'0001_x.sql'` literals is the shape that drifts. Reading
      // the directory is the supported way.
      const literals = [...src.matchAll(/'\d{4}_[a-z0-9_]+\.sql'/g)];
      if (literals.length > 1) {
        offenders.push(`${file.slice(REPO_ROOT.length + 1)} (${String(literals.length)} entries)`);
      }
    }
    expect({ hardcodedMigrationLists: offenders.sort() }).toEqual({
      hardcodedMigrationLists: [],
    });
  });

  it('MIG-L02 — every migration set builds every column the ORM declares', async () => {
    const orm = ormColumns();
    expect(orm.size).toBeGreaterThan(20);

    const client = new PGlite();
    try {
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
      expect(files.length).toBeGreaterThan(50);
      for (const file of files) {
        const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
        for (const stmt of sqlText.split('--> statement-breakpoint')) {
          if (stmt.trim() !== '') await client.exec(stmt);
        }
      }

      const live = await client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'public'`,
      );
      const built = new Map<string, Set<string>>();
      for (const row of live.rows) {
        const cols = built.get(row.table_name) ?? new Set<string>();
        cols.add(row.column_name);
        built.set(row.table_name, cols);
      }

      const problems: string[] = [];
      for (const [table, declared] of orm) {
        const cols = built.get(table);
        if (cols === undefined) {
          if (!CREATED_ONLY_BY_ENSURE_COLUMNS.has(table)) {
            problems.push(`${table}: the ORM models it and no migration creates it`);
          }
          continue;
        }
        const missing = [...declared].filter((c) => !cols.has(c)).sort();
        if (missing.length > 0) problems.push(`${table}: missing [${missing.join(', ')}]`);
      }
      expect({ ormColumnsWithNoMigration: problems.sort() }).toEqual({
        ormColumnsWithNoMigration: [],
      });
    } finally {
      await client.close();
    }
  }, 600_000);
});
