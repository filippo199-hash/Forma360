/**
 * Media upload endpoint for Heads Up attachments.
 *
 * Rules:
 *   - Session-required (better-auth).
 *   - Accepts multipart/form-data with a single `file` field.
 *   - Enforces: max 50 MB per file, allowed MIME types (image/jpeg,
 *     image/png, application/pdf, video/quicktime, video/mp4).
 *   - Stores under: <tenantId>/heads-up/<timestamp>/<safeName>
 *   - Returns { key, filename, mimeType, sizeBytes }.
 *
 * The caller is responsible for registering the returned key via
 * trpc.headsUps.attachments.add (or embedding it in the create payload)
 * after the upload succeeds.
 */
import { newId } from '@forma360/shared/id';
import { createStorage, objectKey } from '@forma360/shared/storage';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createContext } from '../../../../src/server/trpc';
import { env } from '../../../../src/server/env';

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/quicktime',
  'video/mp4',
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

  // DC-S02 (swept): session-only, no permission check — so any authenticated
  // user could write unbounded 50 MB objects into the tenant's R2 bucket with
  // no row to show for it and nothing to ever clean it up. Same hole the
  // documents upload route had; found by walking the routes rather than
  // reading them.
  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('headsUp.publish') && !perms.includes('headsUp.manage')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
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

  const safeName = sanitizeFilename(file.name);
  // Each draft upload gets a fresh ULID as its entity-id segment so the
  // key is valid (<tenantId>/heads-up/<uploadId>/<filename>). The upload
  // is stored as a draft and the caller embeds the returned key in the
  // create-heads-up payload; no entity record is needed at this point.
  const key = objectKey({
    tenantId: ctx.auth.tenantId,
    module: 'heads-up',
    entityId: newId(),
    filename: safeName,
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
