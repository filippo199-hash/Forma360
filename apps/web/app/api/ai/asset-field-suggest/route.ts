/**
 * Field-suggestion endpoint for a new asset category.
 *
 * Only reached when the curated library (`lib/asset-field-library.ts`)
 * has no match — the common categories never touch the model, so this
 * costs nothing for the cases that matter most.
 *
 * Suggestions only: the UI ticks what it wants and persists through the
 * normal `assetTypes.create` mutation, so the deterministic router stays
 * the single write path.
 *
 * Auth: session + `assets.manage`; rate-limited. Not brand-gated —
 * Assets is a core module both brands ship.
 */
import { assetTypes } from '@forma360/db/schema';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { and, eq, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { suggestAssetFields } from '../../../../src/server/asset-field-ai';
import { db } from '../../../../src/server/db';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';
import { createContext } from '../../../../src/server/trpc';

const bodySchema = z.object({ categoryName: z.string().trim().min(2).max(80) });

export async function POST(request: Request) {
  const ctx = await createContext({ headers: await headers() });
  if (ctx.auth === null) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('assets.manage')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const rl = await rateLimit(`ai:asset-field-suggest:${ctx.auth.userId}`, {
    limit: 20,
    windowSec: 300,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }

  // The tenant's existing categories, so suggestions match their naming.
  const existing = await db
    .select({ name: assetTypes.name })
    .from(assetTypes)
    .where(and(eq(assetTypes.tenantId, ctx.auth.tenantId), isNull(assetTypes.archivedAt)))
    .limit(20);

  try {
    const suggestion = await suggestAssetFields({
      categoryName: parsed.data.categoryName,
      existingCategories: existing.map((e) => e.name),
    });
    return Response.json({ suggestion });
  } catch (err) {
    ctx.logger.warn({ err }, '[asset-field-suggest] failed');
    // A failed suggestion is not a failed category — the UI falls back to
    // adding fields by hand and says so.
    return Response.json({ error: 'Could not suggest fields.' }, { status: 422 });
  }
}
