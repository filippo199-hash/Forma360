import { tenants } from '@forma360/db/schema';
import { getBrand } from '@forma360/shared/brand';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { auth } from './auth';
import { db } from './db';
import { env } from './env';

/**
 * Is the caller sitting in an unclaimed try-it-now workspace? (ADR 0017)
 *
 * Resolved in the server shell rather than by a client query, so the
 * save prompt costs a normal user nothing at all: on a brand without
 * the sandbox this returns without touching the database, and on FreeHS
 * it is one indexed read already on the critical path for the layout.
 * The banner component then renders only when there is something to
 * say.
 */
export async function loadSandboxState(): Promise<{ isUnclaimedSandbox: boolean }> {
  if (!getBrand(env.BRAND).offersSandbox) return { isUnclaimedSandbox: false };

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const tenantId = session?.user.tenantId;
  if (typeof tenantId !== 'string') return { isUnclaimedSandbox: false };

  const rows = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const sandbox = rows[0]?.settings.sandbox;
  return { isUnclaimedSandbox: sandbox !== undefined && sandbox.claimedAt === undefined };
}
