/**
 * Dependency readiness (STAB-03).
 *
 * Liveness already existed before this route: `health.ping` on the tRPC
 * router, which is what `apps/web/railway.toml` points `healthcheckPath`
 * at. What did not exist was any way to ask whether the process can reach
 * Postgres and Redis — so a web service that was up, serving, and unable
 * to read a single row looked identical to a healthy one from outside.
 *
 * Two questions, deliberately kept apart:
 *
 * - **Liveness** (`GET /api/health`) — can this process serve a request at
 *   all? No dependencies touched. Railway's restart policy must stay
 *   pointed at a check of this shape: if a Postgres blip made every replica
 *   fail its healthcheck, the platform would restart all of them on top of
 *   the outage, which turns a recoverable database incident into a
 *   restart storm.
 * - **Readiness** (`GET /api/health?deep=1`) — can it also reach Postgres
 *   and Redis? This is for uptime monitoring and for answering "which
 *   dependency is down" at 3am. It is deliberately NOT wired to the
 *   restart policy.
 *
 * Anonymous callers get a status and per-dependency booleans and nothing
 * else — no versions, no hostnames, no error strings. A connection error
 * message is a free map of the internal topology, so it goes to the log,
 * which is where an operator is looking anyway and which carries the
 * request id.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../../src/server/db';
import { redis } from '../../../src/server/redis';
import { logger } from '../../../src/server/logger';

/** Never prerender, never cache: a cached health check is not a health check. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * A dependency that does not answer quickly is down as far as this endpoint
 * is concerned. Without a bound, a hung socket makes the health check itself
 * hang, and a monitor waiting on it learns nothing.
 */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * `Promise.race` attaches a reaction to every input, so a probe that
 * rejects *after* the timeout already won is still counted as handled —
 * verified, because the alternative would be an unhandled rejection, and
 * in Node that is a process exit. The connection timeout on the pool is
 * 10s and this bound is 3s, so a losing probe is the normal case, not an
 * edge one. If this is ever rewritten without `race`, the loser needs its
 * own `.catch`.
 */
async function withTimeout<T>(label: string, probe: Promise<T>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} probe timed out`)), PROBE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch (err) {
    logger.warn({ err, dependency: label }, '[health] dependency probe failed');
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function GET(request: Request): Promise<Response> {
  const deep = new URL(request.url).searchParams.get('deep') !== null;

  if (!deep) {
    return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
  }

  const [database, cache] = await Promise.all([
    withTimeout('postgres', db.execute(sql`select 1`)),
    withTimeout('redis', redis.ping()),
  ]);

  const healthy = database && cache;
  return Response.json(
    { status: healthy ? 'ok' : 'degraded', database, cache },
    { status: healthy ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
