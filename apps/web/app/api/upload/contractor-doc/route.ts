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
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { objectKey } from '@forma360/shared/storage';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '../../../../src/server/env';
import { storage } from '../../../../src/server/storage';
import { createContext } from '../../../../src/server/trpc';

const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPTED_MIME = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
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
  if (!perms.includes('contractors.manage')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const form = await req.formData();
  const contractorId = String(form.get('contractorId') ?? '');
  const file = form.get('file');
  if (contractorId.length !== 26 || !(file instanceof File)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (file.size <= 0) return NextResponse.json({ error: 'EMPTY_FILE' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 400 });
  if (!ACCEPTED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }

  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'contractor-docs',
    entityId: contractorId as never,
    filename: sanitizeFilename(file.name),
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
        ctx.logger.error({ key, status: res.status }, '[contractor-doc] R2 PUT failed');
        return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
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
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  });
}
