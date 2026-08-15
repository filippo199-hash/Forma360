/**
 * Contractor compliance-document upload endpoint.
 *
 * Multipart upload → R2 (prod) or `.local-storage/<key>` (dev) → returns the
 * canonical storage key. The `contractor_documents` row is created by the
 * caller via the `contractors.addDocument` tRPC mutation.
 *
 * Storage key: <tenantId>/contractor-docs/<contractorId>/<filename>
 * Auth: session-required + `contractors.manage`.
 */
import { hasPermission, loadUserPermissions } from '@forma360/permissions/requirePermission';
import { objectKey } from '@forma360/shared/storage';
import { resolveUploadMime } from '@forma360/shared/upload-media';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { storageFailed } from '../../../../src/server/upload-failure';
import { env } from '../../../../src/server/env';
import { normalisePhoneMedia } from '../../../../src/server/phone-media';
import { storage } from '../../../../src/server/storage';
import { createContext } from '../../../../src/server/trpc';

const MAX_BYTES = 50 * 1024 * 1024;
// A photo of the paperwork is a phone shot — HEIC/HEIF/AVIF included
// (converted to JPEG at ingest). No video.
const ACCEPTED_MIME = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'image/avif',
]);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeFilename(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, '_').replace(FILENAME_SAFE, '_');
  return `${Date.now().toString(36)}_${cleaned || 'document'}`.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  // Admins (org.settings) implicitly hold every key — a permission set
  // snapshotted before this module existed must not lock admins out.
  if (!hasPermission(perms, 'contractors.manage')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const form = await req.formData();
  const contractorId = String(form.get('contractorId') ?? '');
  const file = form.get('file');
  if (contractorId.length !== 26 || !(file instanceof File)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (file.size <= 0) return NextResponse.json({ error: 'EMPTY_FILE' }, { status: 400 });
  // Some Android browsers report "" or octet-stream for camera files —
  // resolve via the extension before deciding anything.
  const resolvedMime = resolveUploadMime(file.name, file.type);
  if (resolvedMime === null || !ACCEPTED_MIME.has(resolvedMime)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 400 });

  // HEIC/HEIF → JPEG so the document preview can render. The raw name
  // goes in (the response echoes a display filename, extension corrected
  // when converted); the key gets the sanitised form below.
  const media = await normalisePhoneMedia(
    {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: resolvedMime,
      filename: file.name,
    },
    ctx.logger,
  );
  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'contractor-docs',
    entityId: contractorId as never,
    filename: sanitizeFilename(media.filename),
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
        return await storageFailed(ctx.logger, 'contractor-doc', key, res);
      }
    } catch (err) {
      ctx.logger.error({ err }, '[contractor-doc] R2 PUT threw');
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  } else {
    const target = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  return NextResponse.json({
    storageKey: key,
    filename: media.filename,
    mimeType: media.mimeType,
    sizeBytes: bytes.length,
  });
}
