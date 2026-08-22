import { createDb } from '@forma360/db/client';
import { env } from './env';
import { logger } from './logger';

/**
 * The web server's own pool, separate from the worker's so the two cannot
 * exhaust one another's connection budget.
 *
 * The `onPoolError` sink is load-bearing, not decoration: a `pg.Pool` with
 * no `'error'` listener takes the whole Next server down when an idle
 * connection dies (STAB-01). See the docstring on `createDb`.
 */
const { pool, db } = createDb(env.DATABASE_URL, {
  max: env.DB_POOL_MAX,
  statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
  applicationName: 'forma360-web',
  onPoolError: (err) => {
    logger.error({ err }, '[db] idle pool client error');
  },
});

export { db, pool };
