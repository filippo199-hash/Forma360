/**
 * STAB-01 — an idle pooled connection dying must not kill the process.
 *
 * The real-world trigger is a Postgres restart, a failover, or a
 * `pg_terminate_backend` landing on a connection that is sitting idle in
 * the pool. `pg-pool` re-emits that as an `'error'` event on the Pool, and
 * Node's EventEmitter contract turns an `'error'` with no listener into a
 * thrown exception at the top of the stack — `Unhandled 'error' event` —
 * which ends the process. Not the request: the whole web server, or the
 * whole worker mid-job.
 *
 * That was reproduced end to end against a real Postgres before this fix:
 *
 *     const pool = new pg.Pool({ connectionString: url, max: 2 });
 *     const { rows } = await pool.query('select pg_backend_pid() as pid');
 *     // …let the connection go idle, then from another pool:
 *     await admin.query('select pg_terminate_backend($1)', [rows[0].pid]);
 *     // → node:events:497  throw er;  Unhandled 'error' event   exit(1)
 *
 * These tests pin the *mechanism* rather than re-run that, so they need no
 * database and can live in the ordinary `verify` job: the first shows the
 * unguarded pool throwing, the second shows ours absorbing it. If someone
 * deletes the `pool.on('error', …)` line, the second test fails.
 */
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createDb, DB_POOL_DEFAULTS } from './client';

// Never connected to — every assertion here is about listener wiring and
// pool configuration, both of which are set at construction time.
const UNREACHABLE = 'postgres://u:p@127.0.0.1:1/none';

describe('pg pool error handling (STAB-01)', () => {
  it('an unguarded pool throws on an error event — the bug being fixed', () => {
    const pool = new pg.Pool({ connectionString: UNREACHABLE });
    expect(pool.listenerCount('error')).toBe(0);
    // This is precisely what killed the process in production: no listener,
    // so EventEmitter rethrows.
    expect(() => pool.emit('error', new Error('terminating connection'))).toThrow(
      'terminating connection',
    );
    void pool.end().catch(() => undefined);
  });

  it('createDb attaches a listener, so the same event is absorbed', () => {
    const seen: Error[] = [];
    const { pool } = createDb(UNREACHABLE, { onPoolError: (err) => seen.push(err) });

    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    expect(() => pool.emit('error', new Error('terminating connection'))).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toBe('terminating connection');

    void pool.end().catch(() => undefined);
  });

  it('falls back to a sink of its own when no logger is injected', () => {
    // `packages/db` is imported by scripts that never build a pino logger.
    // Those must still not be able to crash on a dead connection.
    const { pool } = createDb(UNREACHABLE);
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    void pool.end().catch(() => undefined);
  });

  it('bounds a checkout, a statement and an abandoned transaction', () => {
    const { pool } = createDb(UNREACHABLE);
    const options = pool.options as unknown as Record<string, unknown>;

    // Without these, a brief outage wedges request handlers forever and one
    // runaway query holds a pool slot until it finishes on its own.
    expect(options['connectionTimeoutMillis']).toBe(DB_POOL_DEFAULTS.connectionTimeoutMillis);
    expect(options['statement_timeout']).toBe(DB_POOL_DEFAULTS.statementTimeoutMs);
    expect(options['idle_in_transaction_session_timeout']).toBe(
      DB_POOL_DEFAULTS.idleInTransactionTimeoutMs,
    );
    expect(options['max']).toBe(DB_POOL_DEFAULTS.max);
    expect(options['keepAlive']).toBe(true);

    void pool.end().catch(() => undefined);
  });

  it('lets a caller widen the statement timeout — the worker needs to', () => {
    // Reconcile fans out over a whole tenant; a web-shaped 30s budget would
    // fail it. `0` is Postgres for "no timeout" and is the opt-out.
    const { pool } = createDb(UNREACHABLE, { statementTimeoutMs: 300_000, max: 4 });
    const options = pool.options as unknown as Record<string, unknown>;
    expect(options['statement_timeout']).toBe(300_000);
    expect(options['max']).toBe(4);
    void pool.end().catch(() => undefined);
  });
});
