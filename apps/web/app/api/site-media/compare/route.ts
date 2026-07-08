/**
 * Compare two site-media photos and describe what changed (Phase 2d).
 *
 * POST { ids: [id, id] } — loads both photos (tenant-scoped), orders them
 * earliest→latest by capture time, runs Claude vision, and returns a markdown
 * comparison. Read-only; nothing is written.
 *
 * Auth: session-required + `sites.view`.
 */
import { siteMedia } from '@forma360/db/schema';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../../../../src/server/env';
import { compareMediaImages } from '../../../../src/server/site-media-vision';
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

function labelFor(capturedAt: Date | null, createdAt: Date): string {
  return (capturedAt ?? createdAt).toISOString().slice(0, 10);
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

  const bodyRaw: unknown = await req.json().catch(() => null);
  const ids =
    typeof bodyRaw === 'object' &&
    bodyRaw !== null &&
    Array.isArray((bodyRaw as { ids?: unknown }).ids)
      ? (bodyRaw as { ids: unknown[] }).ids.filter((x): x is string => typeof x === 'string')
      : [];
  if (ids.length !== 2 || ids[0] === ids[1] || ids.some((x) => x.length !== 26)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const rows = await ctx.db
    .select({
      id: siteMedia.id,
      storageKey: siteMedia.storageKey,
      mimeType: siteMedia.mimeType,
      kind: siteMedia.kind,
      capturedAt: siteMedia.capturedAt,
      createdAt: siteMedia.createdAt,
    })
    .from(siteMedia)
    .where(
      and(
        eq(siteMedia.tenantId, ctx.auth.tenantId),
        inArray(siteMedia.id, ids),
        isNull(siteMedia.archivedAt),
      ),
    );
  if (rows.length !== 2) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (rows.some((r) => r.kind !== 'photo')) {
    return NextResponse.json({ error: 'PHOTOS_ONLY' }, { status: 400 });
  }

  // Order earliest → latest.
  const sorted = [...rows].sort(
    (a, b) => (a.capturedAt ?? a.createdAt).getTime() - (b.capturedAt ?? b.createdAt).getTime(),
  );
  const [before, after] = sorted;
  if (before === undefined || after === undefined) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const [beforeBytes, afterBytes] = await Promise.all([
    loadBytes(before.storageKey),
    loadBytes(after.storageKey),
  ]);
  if (beforeBytes === null || afterBytes === null) {
    return NextResponse.json({ error: 'BYTES_UNAVAILABLE' }, { status: 502 });
  }

  let comparison: string;
  try {
    comparison = await compareMediaImages(
      {
        base64: beforeBytes.toString('base64'),
        mediaType: before.mimeType,
        label: labelFor(before.capturedAt, before.createdAt),
      },
      {
        base64: afterBytes.toString('base64'),
        mediaType: after.mimeType,
        label: labelFor(after.capturedAt, after.createdAt),
      },
    );
  } catch (err) {
    ctx.logger.warn({ err }, '[site-media] compare failed');
    return NextResponse.json({ error: 'COMPARE_FAILED' }, { status: 502 });
  }

  return NextResponse.json({
    comparison,
    beforeId: before.id,
    afterId: after.id,
  });
}
