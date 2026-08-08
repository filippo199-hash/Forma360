/**
 * Media upload endpoint for template instruction attachments.
 *
 * Rules:
 *   - Session-required (better-auth).
 *   - Accepts multipart/form-data with `templateId` + a single `file`.
 *   - Enforces: max 25 MB per file, allowed MIME types (images, PDF, common
 *     Office docs).
 *   - Stores under: <tenantId>/templates/<templateId>/<safeName>
 *   - Returns { key, filename, mimeType, sizeBytes }.
 *
 * The caller embeds the returned descriptor in the instruction item's
 * `attachments[]` and saves the template draft. Files are served back to the
 * inspector during conduct via the session-gated `/api/files?key=` proxy.
 */
import { isId, newId } from '@forma360/shared/id';
import { createStorage, objectKey } from '@forma360/shared/storage';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '../../../../src/server/env';
import { createContext } from '../../../../src/server/trpc';

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]);

const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '_');
  const cleaned = trimmed.replace(FILENAME_SAFE, '_');
  const timestamp = Date.now().toString(36);
  return `${timestamp}_${cleaned || 'upload'}`.slice(0, 200);
}

let storage: ReturnType<typeof createStorage> | null = null;
function getStorage(): ReturnType<typeof createStorage> {
  if (storage !== null) return storage;
  storage = createStorage({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  });
  return storage;
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // DC-S02 (swept): same as the Heads-Up sibling — a session was the only
  // gate, and the route files bytes under any `templateId` the caller names.
  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('templates.manage') && !perms.includes('templates.create')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const form = await req.formData();
  const templateId = String(form.get('templateId') ?? '');
  const file = form.get('file');
  if (!isId(templateId) || !(file instanceof File)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: 'EMPTY_FILE' }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 413 });
  }
  const mimeType = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MIME_TYPE' }, { status: 415 });
  }

  // A fresh ULID per upload keeps keys unique even for same-named files; the
  // templateId lives in the module-entity segment so files group per template.
  const key = objectKey({
    tenantId: ctx.auth.tenantId,
    module: 'templates',
    entityId: templateId,
    filename: `${newId()}_${sanitizeFilename(file.name)}`.slice(0, 220),
  });

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (env.NODE_ENV === 'production') {
    try {
      const s = getStorage();
      const uploadUrl = await s.getSignedUploadUrl({ key, contentType: mimeType });
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': mimeType },
      });
      if (!res.ok) {
        return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
      }
    } catch {
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  } else {
    const target = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  return NextResponse.json({
    key,
    filename: file.name,
    mimeType,
    sizeBytes: file.size,
  });
}
