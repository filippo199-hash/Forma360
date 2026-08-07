/**
 * Training certificate / card upload (FreeHS B7 — TR-A11b).
 *
 * The photograph of the physical card *is* the evidence: it is how a
 * contractor already works, and it is the answer to the auditor's third
 * question — *can you show me the certificate*. Without it the module
 * records that a card exists and cannot show it, which also makes the
 * verification step meaningless because there is nothing to verify
 * against.
 *
 * Mirrors `upload/coshh-doc/route.ts`: multipart upload, blob to R2 in
 * production (`.local-storage/<key>` in dev), returns the canonical
 * storage key. The `training_records` row is written by the caller via
 * tRPC — this route is the blob-only half.
 *
 * Storage key layout: <tenantId>/training/<entityId>/<filename>
 *
 * Auth: session + `training.record` or `training.manage` (uploads feed
 * mutations, so viewers are refused). Brand-gated like the rest.
 */
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { brandHasModule } from '@forma360/shared/brand';
import { objectKey } from '@forma360/shared/storage';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { activeBrand } from '../../../../src/lib/brand';
import { createContext } from '../../../../src/server/trpc';
import { env } from '../../../../src/server/env';
import { storage } from '../../../../src/server/storage';

// A phone photo of a CSCS card, or a scanned certificate.
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED_MIME = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/webp',
]);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '_');
  const cleaned = trimmed.replace(FILENAME_SAFE, '_');
  const timestamp = Date.now().toString(36);
  return `${timestamp}_${cleaned || 'certificate'}`.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  if (!brandHasModule(activeBrand.id, 'training')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('training.record') && !perms.includes('training.manage')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const form = await req.formData();
  // A staging ULID from the dialog: the record row does not exist yet
  // when the photo is taken (same convention as observation uploads).
  const entityId = String(form.get('entityId') ?? '');
  const file = form.get('file');
  if (entityId.length !== 26 || !(file instanceof File)) {
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
    module: 'training',
    entityId: entityId as never,
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
        ctx.logger.error({ key, status: res.status }, '[training-certificate] R2 PUT failed');
        return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
      }
    } catch (err) {
      ctx.logger.error({ err }, '[training-certificate] R2 PUT threw');
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
