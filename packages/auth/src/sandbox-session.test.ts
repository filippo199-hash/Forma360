/**
 * Round-trip proof for the sandbox session minter.
 *
 * `createSandboxSession` reproduces better-auth's cookie signing rather
 * than calling `setSessionCookie` (which needs an endpoint context we do
 * not have outside a better-auth route). That makes it a proven
 * boundary, and this file is the proof: a minted cookie is fed straight
 * back into `auth.api.getSession()`. If better-auth ever changes its
 * signing scheme, cookie name, or session-token shape, this fails
 * instead of the sandbox handing visitors dead sessions in production.
 *
 * Edge-case IDs:
 *   SB-E01 — a minted cookie resolves to the same user via getSession.
 *   SB-E02 — a cookie signed with the wrong secret is rejected.
 *   SB-E03 — a tampered token is rejected.
 *   SB-E04 — the minted cookie carries the hardening attributes
 *            (HttpOnly / SameSite / Secure-in-production).
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth } from './server';
import { createSandboxSession, signCookieValue } from './sandbox-session';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const OTHER_SECRET = 'a-different-secret-also-32-characters-long!!';

/**
 * Minimal in-memory stand-in for the ioredis client better-auth's
 * secondary storage drives. Only the five methods `redisStorage` calls
 * are implemented.
 */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
    setex: (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
    del: (...keys: string[]) => {
      for (const k of keys) store.delete(k);
      return Promise.resolve(keys.length);
    },
    keys: (pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      return Promise.resolve([...store.keys()].filter((k) => k.startsWith(prefix)));
    },
  };
}

/** Cookie header value from a `Set-Cookie` string. */
function cookieHeaderFrom(setCookie: string): string {
  return setCookie.split(';')[0] ?? '';
}

describe('createSandboxSession', () => {
  let auth: Auth;
  let userId: string;

  beforeAll(async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
      for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
        if (stmt.length > 0) await client.exec(stmt);
      }
    }

    // A tenant + user for the session to point at. Inserted directly —
    // this test is about the cookie, not about provisioning.
    const tenantId = '01JQSANDBOXTESTTENANT00000';
    const permissionSetId = '01JQSANDBOXTESTPERMSET0000';
    userId = 'usr_01JQSANDBOXTESTUSER000000';
    await db
      .insert(schema.tenants)
      .values({ id: tenantId, name: 'Sandbox test', slug: 'sbx-test' });
    await db
      .insert(schema.permissionSets)
      .values({ id: permissionSetId, tenantId, name: 'Administrator' });
    await db.insert(schema.user).values({
      id: userId,
      name: 'Sandbox visitor',
      email: 'sandbox-test@freehs.invalid',
      emailVerified: false,
      tenantId,
      permissionSetId,
    });

    // pglite's drizzle instance is structurally compatible with the
    // node-postgres one the adapter is typed against; the tests in
    // packages/api do the same.
    auth = createAuth({
      db: db as never,
      redis: fakeRedis() as never,
      sendEmail: () => Promise.resolve(),
      sendTemplatedEmail: () => Promise.resolve(),
      secret: SECRET,
      baseUrl: 'http://localhost:3000',
      nodeEnv: 'test',
    });
  });

  it('SB-E01 — mints a cookie better-auth resolves back to the same user', async () => {
    const minted = await createSandboxSession(auth, userId, SECRET);

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeaderFrom(minted.setCookie) }),
    });

    expect(session).not.toBeNull();
    expect(session?.user.id).toBe(userId);
    expect(minted.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('SB-E02 — a cookie signed with the wrong secret is rejected', async () => {
    const minted = await createSandboxSession(auth, userId, OTHER_SECRET);

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeaderFrom(minted.setCookie) }),
    });

    expect(session).toBeNull();
  });

  it('SB-E03 — a tampered token is rejected', async () => {
    const minted = await createSandboxSession(auth, userId, SECRET);
    const forged = await signCookieValue(`${minted.token}x`, SECRET);
    const name = cookieHeaderFrom(minted.setCookie).split('=')[0] ?? '';

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: `${name}=${forged}` }),
    });

    expect(session).toBeNull();
  });

  it('SB-E04 — the cookie carries the hardening attributes', async () => {
    const minted = await createSandboxSession(auth, userId, SECRET);

    expect(minted.setCookie).toContain('HttpOnly');
    expect(minted.setCookie).toContain('SameSite=lax');
    expect(minted.setCookie).toContain('Path=/');
    // nodeEnv=test → cookies are not forced Secure, so localhost works.
    expect(minted.setCookie).not.toContain('Secure');
  });
});
