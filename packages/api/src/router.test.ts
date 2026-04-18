/**
 * Integration test for the root tRPC router.
 *
 * Exercises health.ping (public) and health.me (authed) through the
 * createCallerFactory path — no real HTTP, but the full middleware chain
 * + context plumbing. The db is a live pglite instance so future procedures
 * that issue real queries can slot into this harness.
 */
import { PGlite } from '@electric-sql/pglite';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from './context';
import { appRouter } from './router';
import { createCallerFactory } from './trpc';
import * as schema from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';

const createCaller = createCallerFactory(appRouter);

function silentLogger() {
  return createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
}

describe('health router', () => {
  let client: PGlite;
  let pgliteDb: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    client = new PGlite();
    pgliteDb = drizzle(client, { schema });
  });

  afterEach(async () => {
    await client.close();
  });

  function ctx(auth: Context['auth'] = null): Context {
    return createTestContext({
      db: pgliteDb as unknown as Database,
      logger: silentLogger(),
      auth,
    });
  }

  it('health.ping returns { ok: true, time }', async () => {
    const caller = createCaller(ctx());
    const result = await caller.health.ping();
    expect(result.ok).toBe(true);
    expect(typeof result.time).toBe('string');
    expect(new Date(result.time).toString()).not.toBe('Invalid Date');
  });

  it('health.me throws UNAUTHORIZED without a session', async () => {
    const caller = createCaller(ctx());
    await expect(caller.health.me()).rejects.toThrow(/Authentication required|UNAUTHORIZED/);
  });

  it('health.me returns { userId, email, tenantId } with a session', async () => {
    const caller = createCaller(
      ctx({
        userId: 'usr_abc',
        email: 'alice@acme.test',
        tenantId: '01KPEXAMPLE00000000000TENANT' as never,
      }),
    );
    const me = await caller.health.me();
    expect(me.userId).toBe('usr_abc');
    expect(me.email).toBe('alice@acme.test');
    expect(me.tenantId).toBe('01KPEXAMPLE00000000000TENANT');
  });

  it('context carries a pre-supplied requestId through the procedure', async () => {
    const presetId = '01KPFAKERQSTIDAAAAAAAAAAAA' as never;
    const context = createTestContext({
      db: pgliteDb as unknown as Database,
      logger: silentLogger(),
      requestId: presetId,
    });
    expect(context.requestId).toBe(presetId);

    const caller = createCaller(context);
    const result = await caller.health.ping();
    expect(result.ok).toBe(true);
  });

  it('context generates a fresh ULID when no requestId is supplied', () => {
    const context = createTestContext({
      db: pgliteDb as unknown as Database,
      logger: silentLogger(),
    });
    expect(context.requestId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
