/**
 * Site-media AI auto-tag endpoint (Phase 2b).
 *
 * POST { id } — loads the media row, fetches the photo bytes from R2 (or
 * `.local-storage/<key>` in dev), runs Claude vision to derive tags + a
 * caption, and writes them back. Best-effort: any failure returns a soft
 * error and leaves the row untouched so a flaky model call never blocks the
 * gallery. The client calls this fire-and-forget after upload.
 *
 * Auth: session-required + `sites.view`. The media row is tenant-scoped.
 */
import { siteMedia } from '@forma360/db/schema';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { and, eq, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../../../../src/server/env';
import { analyzeMediaImage } from '../../../../src/server/site-media-vision';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';
import { storage } from '../../../../src/server/storage';
import { createContext } from '../../../../src/server/trpc';

async function loadBytes(storageKey: string): Promise<Buffer | null> {
  if (env.NODE_ENV === 'production') {
    try {
      const url = await storage.getSignedDownloadUrl({ key: storageKey });
      const res = await fetch(url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  try {
    return await readFile(join(process.cwd(), '.local-storage', storageKey));
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('sites.view')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // Every `/api/ai/*` route carries a throttle; these three vision routes
  // were the ones that escaped that pass, so a Claude vision call was
  // loopable by anyone holding a read permission as broad as `sites.view`.
  const rl = await rateLimit(`site-media:analyze:${ctx.auth.userId}`, {
    limit: 20,
    windowSec: 300,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const bodyRaw: unknown = await req.json().catch(() => null);
  const id =
    typeof bodyRaw === 'object' &&
    bodyRaw !== null &&
    typeof (bodyRaw as { id?: unknown }).id === 'string'
      ? (bodyRaw as { id: string }).id
      : '';
  if (id.length !== 26) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const rows = await ctx.db
    .select({
      id: siteMedia.id,
      storageKey: siteMedia.storageKey,
      mimeType: siteMedia.mimeType,
      kind: siteMedia.kind,
      caption: siteMedia.caption,
    })
    .from(siteMedia)
    .where(
      and(
        eq(siteMedia.tenantId, ctx.auth.tenantId),
        eq(siteMedia.id, id),
        isNull(siteMedia.archivedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (row.kind !== 'photo') {
    return NextResponse.json({ skipped: true, reason: 'not-a-photo' });
  }

  const bytes = await loadBytes(row.storageKey);
  if (bytes === null) {
    return NextResponse.json({ error: 'BYTES_UNAVAILABLE' }, { status: 502 });
  }

  let result;
  try {
    result = await analyzeMediaImage(bytes.toString('base64'), row.mimeType);
  } catch (err) {
    ctx.logger.warn({ err, id }, '[site-media] analyze failed');
    return NextResponse.json({ error: 'ANALYZE_FAILED' }, { status: 502 });
  }

  if (result.tags.length === 0 && result.caption.length === 0) {
    return NextResponse.json({ tags: [], caption: '' });
  }

  const nextCaption = row.caption.length > 0 ? row.caption : result.caption;
  await ctx.db
    .update(siteMedia)
    .set({ tags: result.tags, caption: nextCaption })
    .where(and(eq(siteMedia.tenantId, ctx.auth.tenantId), eq(siteMedia.id, id)));

  ctx.logger.info({ id, tagCount: result.tags.length }, '[site-media] auto-tagged');
  return NextResponse.json({ tags: result.tags, caption: nextCaption });
}
