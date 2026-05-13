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
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createContext } from '../../../../src/server/trpc';
import { env } from '../../../../src/server/env';
import { storage } from '../../../../src/server/storage';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB cap for images, video, pdf
const ACCEPTED_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'video/mp4',
  'video/quicktime',
  'video/webm',
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
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 400 });
  }
  if (!ACCEPTED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }

  const safeName = sanitizeFilename(file.name);
  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'issues',
    entityId: issueId as never,
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
        ctx.logger.error({ key, status: res.status }, '[observation-attachment] R2 PUT failed');
        return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
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
    mimeType: file.type,
    sizeBytes: file.size,
    signedUrl,
  });
}
