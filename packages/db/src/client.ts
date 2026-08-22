/**
 * Postgres connection pool + Drizzle client.
 *
 * The singleton `db` exposed from this module is the only way application code
 * talks to Postgres. Do not create ad-hoc Pools or import the `pg` client
 * directly from other packages.
 *
 * The module reads `DATABASE_URL` through the validated env helper, so any
 * consumer that imports `db` gets boot-time fail-fast behaviour for free.
 *
 * ## Why this file has an error handler (STAB-01)
 *
 * A `pg.Pool` is an EventEmitter, and it emits `'error'` when a connection
 * **sitting idle in the pool** dies — a Postgres restart, a failover, a
 * `pg_terminate_backend`, an idle-connection reaper on the network path.
 * With no listener attached, Node's EventEmitter contract turns that into
 * `Unhandled 'error' event` and the **process exits(1)**. Not the request:
 * the whole web server, or the whole worker.
 *
 * That was this pool's behaviour. `client.pool.test.ts` pins the mechanism
 * (an unguarded pool throws on the event; ours absorbs it), and it was
 * reproduced end to end against a real Postgres by terminating an idle
 * backend. So: any restart, failover or reset landing while a connection
 * sat idle in the pool took the service down with it. It had not fired in
 * production when this was found — Sentry was clean and traffic is near
 * zero, so the pool is usually empty — which is the good time to fix it.
 *
 * The handler does not need to repair anything: pg-pool has already
 * discarded the broken client by the time it emits. Its whole job is to
 * exist, and to say what happened in a line that reaches the log drain.
 *
 * ## Why the timeouts are here too
 *
 * With `max: 10` and no `connectionTimeoutMillis`, a checkout against an
 * unreachable database waits forever, so a brief outage converts into
 * permanently wedged request handlers rather than fast failures. And with
 * no `statement_timeout`, one runaway query holds a pool slot until it
 * finishes; ten of those is the whole pool, and the service is down while
 * every health signal still reads green.
 *
 * Migrations and backups do NOT run through this pool — drizzle-kit and
 * `pg_dump` open their own connections — so the statement timeout here
 * cannot interrupt a long DDL or a nightly dump.
 */
import { parseServerEnv } from '@forma360/shared/env';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

export type Database = NodePgDatabase<typeof schema>;

/** Defaults chosen for a request-serving process. See the module docstring. */
export const DB_POOL_DEFAULTS = {
  max: 10,
  /**
   * A tRPC request that has been waiting 10s for a *connection* has already
   * failed as far as the person holding the phone is concerned. Failing
   * fast frees the handler; waiting forever does not.
   */
  connectionTimeoutMillis: 10_000,
  /**
   * Generous on purpose — this is a runaway-query backstop, not a latency
   * budget. Exports and dashboard aggregates are the slowest legitimate
   * readers and they are nowhere near this.
   */
  statementTimeoutMs: 30_000,
  /**
   * A transaction left open by a crashed handler holds its locks until the
   * connection dies. This bounds that to a minute.
   *
   * Note what Postgres actually measures: time spent **idle between
   * statements** inside a transaction, not the transaction's total
   * duration. So a genuinely long transaction that keeps working is never
   * touched. It would only bite a transaction that awaits something slow
   * and non-database between statements — and no transaction in this
   * codebase does (checked: zero `db.transaction` bodies await storage,
   * email, `fetch` or a render). Keep it that way; if one ever needs to,
   * do the I/O outside the transaction rather than raising this.
   */
  idleInTransactionTimeoutMs: 60_000,
} as const;

export interface DbPoolOptions {
  /** Pool size. Keep the sum across all services under Postgres `max_connections`. */
  max?: number | undefined;
  /** How long a checkout waits for a free connection before rejecting. */
  connectionTimeoutMillis?: number | undefined;
  /** Server-side `statement_timeout`. 0 disables it. */
  statementTimeoutMs?: number | undefined;
  /** Server-side `idle_in_transaction_session_timeout`. 0 disables it. */
  idleInTransactionTimeoutMs?: number | undefined;
  /** Shows up in `pg_stat_activity.application_name` — worth setting per service. */
  applicationName?: string | undefined;
  /**
   * Where pool-level errors go. Defaults to a `console.error` shim only
   * because `packages/db` must stay importable from scripts that never
   * build a logger; every long-lived service passes its pino child in.
   */
  onPoolError?: ((err: Error) => void) | undefined;
}

/**
 * Where a pool error goes when nobody injected a logger.
 *
 * Writes to stderr directly rather than through `console` — ground rule
 * #7 bans the console API, and `packages/db` happens not to have
 * `no-console` enabled, which is not a reason to use it. It also must not
 * depend on pino: this module is imported by scripts that never build a
 * logger, and those must still be unable to die on a dead connection.
 */
const defaultPoolErrorSink = (err: Error): void => {
  process.stderr.write(`[db] idle pool client error: ${err.stack ?? err.message}\n`);
};

/**
 * Build a new pool + client pair. Exported primarily so tests and scripts
 * (e.g. the backup job) can create isolated handles with their own URLs.
 */
export function createDb(
  databaseUrl: string,
  options: DbPoolOptions = {},
): { pool: pg.Pool; db: Database } {
  const statementTimeoutMs = options.statementTimeoutMs ?? DB_POOL_DEFAULTS.statementTimeoutMs;
  const idleInTransactionTimeoutMs =
    options.idleInTransactionTimeoutMs ?? DB_POOL_DEFAULTS.idleInTransactionTimeoutMs;

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? DB_POOL_DEFAULTS.max,
    connectionTimeoutMillis:
      options.connectionTimeoutMillis ?? DB_POOL_DEFAULTS.connectionTimeoutMillis,
    // 0 means "no timeout" to Postgres, which is also how a caller opts out.
    statement_timeout: statementTimeoutMs,
    idle_in_transaction_session_timeout: idleInTransactionTimeoutMs,
    // Managed Postgres sits behind a proxy that drops silent connections.
    // Keepalives make the socket's death visible to us rather than
    // surfacing as a mystery ECONNRESET on the next real query.
    keepAlive: true,
    ...(options.applicationName === undefined ? {} : { application_name: options.applicationName }),
  });

  // THE crash fix. See the module docstring — without this listener an idle
  // client dying takes the process with it.
  pool.on('error', options.onPoolError ?? defaultPoolErrorSink);

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
    cached = createDb(env.DATABASE_URL, {
      max: env.DB_POOL_MAX,
      statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
      applicationName: 'forma360',
    });
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
