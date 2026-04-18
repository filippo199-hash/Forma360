/**
 * Postgres connection pool + Drizzle client.
 *
 * The singleton `db` exposed from this module is the only way application code
 * talks to Postgres. Do not create ad-hoc Pools or import the `pg` client
 * directly from other packages.
 *
 * The module reads `DATABASE_URL` through the validated env helper, so any
 * consumer that imports `db` gets boot-time fail-fast behaviour for free.
 */
import { parseServerEnv } from '@forma360/shared/env';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

/**
 * Build a new pool + client pair. Exported primarily so tests and scripts
 * (e.g. the backup job) can create isolated handles with their own URLs.
 */
export function createDb(databaseUrl: string): { pool: pg.Pool; db: Database } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

let cached: { pool: pg.Pool; db: Database } | undefined;

/**
 * Lazy singleton. First call parses env and opens the pool; subsequent calls
 * reuse it. Memoisation is per-process, which is the correct granularity for
 * both the Next server and the BullMQ worker.
 */
export function getDb(): Database {
  if (!cached) {
    const env = parseServerEnv();
    cached = createDb(env.DATABASE_URL);
  }
  return cached.db;
}

/**
 * Convenience re-export so call sites can write `import { db } from '@forma360/db/client'`.
 * Accessing the getter lazily also means importing this module does not open
 * a connection — the pool is created on first query.
 */
export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
