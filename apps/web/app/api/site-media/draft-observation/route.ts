/**
 * Draft an observation from a site-media photo (Phase 2c).
 *
 * POST { id } — loads the photo, asks Claude vision to draft a title +
 * description and pick the best-fitting existing category, and returns that
 * draft plus the resolved categoryId. The client then creates the observation
 * (issues.issues.create) + attaches the same photo (issues.attachments.create)
 * via its own tRPC hooks, so the well-tested create path stays authoritative.
 *
 * Auth: session-required + `sites.view` + `issues.report`.
 */
import { issueCategories, siteMedia } from '@forma360/db/schema';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { and, eq, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../../../../src/server/env';
import { draftObservationFromImage } from '../../../../src/server/site-media-vision';
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
  if (!perms.includes('sites.view') || !perms.includes('issues.report')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const rl = await rateLimit(`site-media:draft-observation:${ctx.auth.userId}`, {
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
      storageKey: siteMedia.storageKey,
      mimeType: siteMedia.mimeType,
      kind: siteMedia.kind,
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
    return NextResponse.json({ error: 'NOT_A_PHOTO' }, { status: 400 });
  }

  const categories = await ctx.db
    .select({ id: issueCategories.id, name: issueCategories.name })
    .from(issueCategories)
    .where(
      and(eq(issueCategories.tenantId, ctx.auth.tenantId), isNull(issueCategories.archivedAt)),
    );
  if (categories.length === 0) {
    return NextResponse.json({ error: 'NO_CATEGORY' }, { status: 409 });
  }

  const bytes = await loadBytes(row.storageKey);
  if (bytes === null) {
    return NextResponse.json({ error: 'BYTES_UNAVAILABLE' }, { status: 502 });
  }

  let draft;
  try {
    draft = await draftObservationFromImage(
      bytes.toString('base64'),
      row.mimeType,
      categories.map((c) => c.name),
    );
  } catch (err) {
    ctx.logger.warn({ err, id }, '[site-media] draft-observation failed');
    return NextResponse.json({ error: 'DRAFT_FAILED' }, { status: 502 });
  }

  // Resolve the suggested category name → id (case-insensitive), else first.
  const matched = categories.find((c) => c.name.toLowerCase() === draft.category.toLowerCase());
  const categoryId = matched?.id ?? categories[0]?.id ?? '';

  return NextResponse.json({
    title: draft.title.length > 0 ? draft.title : 'Observation from photo',
    description: draft.description,
    categoryId,
  });
}
