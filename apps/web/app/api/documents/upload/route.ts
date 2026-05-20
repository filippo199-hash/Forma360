/**
 * Document & Policy upload endpoint.
 *
 * Accepts a multipart/form-data POST with:
 *   - file: the binary payload (≤ 50 MB)
 *   - tenantId: scoping hint (validated against session)
 *
 * Returns { storageKey, filename, mimeType, sizeBytes } so the
 * client can call documents.create or documents.uploadVersion
 * with the stable storage key.
 *
 * Storage convention: <tenantId>/documents/<ulid>/<sanitised-filename>
 *
 * In development (NODE_ENV !== 'production') files are written to
 * .local-storage/<key> rather than R2, matching the inspection-upload
 * pattern.
 */
import { createStorage, objectKey } from '@forma360/shared/storage';
import { newId } from '@forma360/shared/id';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createContext } from '../../../../src/server/trpc';
import { env } from '../../../../src/server/env';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

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

const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '_');
  const cleaned = trimmed.replace(FILENAME_SAFE, '_');
  const ts = Date.now().toString(36);
  return `${ts}_${cleaned || 'upload'}`.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'INVALID_FORM_DATA' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'FILE_REQUIRED' }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE', maxBytes: MAX_BYTES }, { status: 413 });
  }

  const safeFilename = sanitizeFilename(file.name || 'upload');
  const docId = newId();
  const mimeType = file.type || 'application/octet-stream';
  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'documents',
    entityId: docId,
    filename: safeFilename,
  });

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (env.NODE_ENV === 'production') {
    const s3 = getStorage();
    const uploadUrl = await s3.getSignedUploadUrl({ key, contentType: mimeType });
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: bytes,
      headers: { 'content-type': mimeType },
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  } else {
    // Dev fallback: write to .local-storage/
    const dest = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }

  return NextResponse.json({
    storageKey: key,
    filename: file.name,
    mimeType,
    sizeBytes: file.size,
  });
}
