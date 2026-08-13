/**
 * Site/Project media upload endpoint.
 *
 * Mirrors apps/web/app/api/upload/observation-attachment/route.ts but targets
 * the site/project media gallery. Accepts a multipart photo/video upload,
 * writes the blob to R2 in production (or `.local-storage/<key>` in dev), and
 * returns the canonical storage key. The `site_media` metadata row is created
 * by the caller via the `siteMedia.create` tRPC mutation — this route is the
 * blob-only half.
 *
 * Storage key layout:
 *   <tenantId>/site-media/<siteId>/<filename>
 *
 * Auth: session-required + `sites.view`. Tenant scope is enforced by the
 * session.
 */
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { objectKey } from '@forma360/shared/storage';
import {
  PHONE_IMAGE_MIME,
  PHONE_VIDEO_MIME,
  resolveUploadMime,
} from '@forma360/shared/upload-media';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createContext } from '../../../../src/server/trpc';
import { env } from '../../../../src/server/env';
import { normalisePhoneMedia } from '../../../../src/server/phone-media';
import { storage } from '../../../../src/server/storage';

// 100 MB cap — videos run larger than photos; this route has always
// applied the one cap to both kinds.
const MAX_BYTES = 100 * 1024 * 1024;
// Phone capture formats (HEIC/HEIF/AVIF, 3GP/MKV/HEVC).
// NB: image/svg+xml stays excluded — SVG can carry <script>.
const ACCEPTED_MIME = new Set<string>([...PHONE_IMAGE_MIME, ...PHONE_VIDEO_MIME]);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '_');
  const cleaned = trimmed.replace(FILENAME_SAFE, '_');
  const timestamp = Date.now().toString(36);
  return `${timestamp}_${cleaned || 'media'}`.slice(0, 200);
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

  // HEIC/HEIF → JPEG so the gallery can actually render the photo.
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
    module: 'site-media',
    entityId: siteId as never,
    filename: safeName,
  });
  const bytes = media.bytes;

  if (env.NODE_ENV === 'production') {
    try {
      const uploadUrl = await storage.getSignedUploadUrl({
        key,
        contentType: media.mimeType,
      });
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        // Copy into a fresh ArrayBuffer: a Uint8Array view is not a
        // BlobPart under this lib config (same boundary as putObject).
        body: new Blob([bytes.slice().buffer as ArrayBuffer], { type: media.mimeType }),
        headers: { 'content-type': media.mimeType },
      });
      if (!res.ok) {
        ctx.logger.error({ key, status: res.status }, '[site-media] R2 PUT failed');
        return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
      }
    } catch (err) {
      ctx.logger.error({ err }, '[site-media] R2 PUT threw');
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
    mimeType: media.mimeType,
    sizeBytes: bytes.length,
  });
}
