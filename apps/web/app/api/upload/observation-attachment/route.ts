/**
 * Observation attachment upload endpoint.
 *
 * Mirrors apps/web/app/api/upload/template-logo/route.ts but targets the
 * `issues` (observations) module. Accepts a multipart upload, writes the
 * blob to R2 in production (or `.local-storage/<key>` in dev), and
 * returns the canonical storage key + a short-lived signed download URL.
 *
 * The metadata row in `issue_attachments` is created by the caller via
 * the `issues.attachments.create` tRPC mutation — this route is the
 * blob-only half of that flow.
 *
 * Storage key layout:
 *   <tenantId>/issues/<issueId>/<filename>
 *
 * Auth: session-required + `issues.view`. Tenant scope is enforced by
 * the session.
 */
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { objectKey } from '@forma360/shared/storage';
import {
  PHONE_IMAGE_MIME,
  PHONE_VIDEO_MIME,
  resolveUploadMime,
  uploadKind,
} from '@forma360/shared/upload-media';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { storageFailed } from '../../../../src/server/upload-failure';
import { createContext } from '../../../../src/server/trpc';
import { env } from '../../../../src/server/env';
import { normalisePhoneMedia } from '../../../../src/server/phone-media';
import { storage } from '../../../../src/server/storage';

// Phone video outgrows a stills-sized cap within seconds of footage.
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
// Phone capture formats (HEIC/HEIF/AVIF, 3GP/MKV/HEVC) + paperwork.
// NB: image/svg+xml stays excluded — SVG can carry <script> and would be
// stored XSS if ever served inline.
const ACCEPTED_MIME = new Set<string>([
  ...PHONE_IMAGE_MIME,
  ...PHONE_VIDEO_MIME,
  'application/pdf',
]);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '_');
  const cleaned = trimmed.replace(FILENAME_SAFE, '_');
  const timestamp = Date.now().toString(36);
  return `${timestamp}_${cleaned || 'attachment'}`.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('issues.view')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const form = await req.formData();
  const issueId = String(form.get('issueId') ?? '');
  const file = form.get('file');
  if (issueId.length !== 26 || !(file instanceof File)) {
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
  const maxBytes = uploadKind(resolvedMime) === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
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
    module: 'issues',
    entityId: issueId as never,
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
        return await storageFailed(ctx.logger, 'observation-attachment', key, res);
      }
    } catch (err) {
      ctx.logger.error({ err }, '[observation-attachment] R2 PUT threw');
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  } else {
    const target = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  let signedUrl: string | null = null;
  if (env.NODE_ENV === 'production') {
    try {
      signedUrl = await storage.getSignedDownloadUrl({ key });
    } catch (err) {
      ctx.logger.warn({ err, key }, '[observation-attachment] signed URL failed');
    }
  }

  return NextResponse.json({
    storageKey: key,
    filename: safeName,
    mimeType: media.mimeType,
    sizeBytes: bytes.length,
    signedUrl,
  });
}
