/**
 * Site/Project plan upload endpoint (Phase 3).
 *
 * Accepts a floor-plan / drawing (image or PDF) and writes it to R2 (or
 * `.local-storage/<key>` in dev). The `site_plans` row is created by the
 * caller via `sitePlans.createPlan`.
 *
 * Storage key layout: `<tenantId>/site-plans/<siteId>/<filename>`.
 * Auth: session-required + `sites.manage`.
 */
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { objectKey } from '@forma360/shared/storage';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '../../../../src/server/env';
import { storage } from '../../../../src/server/storage';
import { createContext } from '../../../../src/server/trpc';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — plans can be large
const ACCEPTED_MIME = new Set<string>(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '_');
  const cleaned = trimmed.replace(FILENAME_SAFE, '_');
  const timestamp = Date.now().toString(36);
  return `${timestamp}_${cleaned || 'plan'}`.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('sites.manage')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const form = await req.formData();
  const siteId = String(form.get('siteId') ?? '');
  const file = form.get('file');
  if (siteId.length !== 26 || !(file instanceof File)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: 'EMPTY_FILE' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 400 });
  }
  if (!ACCEPTED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }

  const safeName = sanitizeFilename(file.name);
  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'site-plans',
    entityId: siteId as never,
    filename: safeName,
  });
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (env.NODE_ENV === 'production') {
    try {
      const uploadUrl = await storage.getSignedUploadUrl({
        key,
        contentType: file.type || 'application/octet-stream',
      });
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      });
      if (!res.ok) {
        ctx.logger.error({ key, status: res.status }, '[site-plan] R2 PUT failed');
        return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
      }
    } catch (err) {
      ctx.logger.error({ err }, '[site-plan] R2 PUT threw');
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  } else {
    const target = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  return NextResponse.json({
    storageKey: key,
    filename: safeName,
    mimeType: file.type,
    sizeBytes: file.size,
  });
}
