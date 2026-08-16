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
import { resolveUploadMime } from '@forma360/shared/upload-media';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { storageThrew } from '../../../../src/server/upload-failure';
import { env } from '../../../../src/server/env';
import { normalisePhoneMedia } from '../../../../src/server/phone-media';
import { storage } from '../../../../src/server/storage';
import { createContext } from '../../../../src/server/trpc';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — plans can be large
// A photo of the paper plan is a phone shot — HEIC/HEIF/AVIF included
// (converted to JPEG at ingest). No video.
const ACCEPTED_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'image/avif',
  'application/pdf',
]);
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
  // Some Android browsers report "" or octet-stream for camera files —
  // resolve via the extension before deciding anything.
  const resolvedMime = resolveUploadMime(file.name, file.type);
  if (resolvedMime === null || !ACCEPTED_MIME.has(resolvedMime)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 400 });
  }

  // HEIC/HEIF → JPEG so the plan viewer can render the image.
  const media = await normalisePhoneMedia(
    {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: resolvedMime,
      filename: sanitizeFilename(file.name),
    },
    ctx.logger,
  );
  const safeName = media.filename;
  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'site-plans',
    entityId: siteId as never,
    filename: safeName,
  });
  const bytes = media.bytes;

  if (env.NODE_ENV === 'production') {
    try {
      await storage.putObject({ key, contentType: media.mimeType, bytes });
    } catch (err) {
      return storageThrew(ctx.logger, 'site-plan', key, err);
    }
  } else {
    const target = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  return NextResponse.json({
    storageKey: key,
    filename: safeName,
    mimeType: media.mimeType,
    sizeBytes: bytes.length,
  });
}
