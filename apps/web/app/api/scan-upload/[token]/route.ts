/**
 * Anonymous photo upload for the public QR hazard-report page (PF-11).
 *
 * The category admin can enable "media" on the QR form; this route is the
 * upload sink for it. No session — possession of a live share token is the
 * authorisation, exactly like `issues.issues.createFromShareToken` (which
 * later binds the uploaded keys to the created issue and re-validates the
 * tenant prefix).
 *
 * Defences:
 *   - token must resolve to a live (non-archived) category with the
 *     "media" built-in field enabled;
 *   - redis rate limit per IP and per token (same budget as the submit
 *     mutation);
 *   - images only (no SVG — stored-XSS hygiene), ≤ {@link MAX_BYTES};
 *   - object key lives under the token tenant's `issues/` prefix so the
 *     submit mutation's prefix check binds it to the right tenant.
 *
 * R2 in production; `.local-storage/<key>` fallback in dev/test, same as
 * `/api/upload`.
 */
import { issueCategories } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createStorage, objectKey } from '@forma360/shared/storage';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { db } from '../../../../src/server/db';
import { env } from '../../../../src/server/env';
import { logger } from '../../../../src/server/logger';
import { rateLimit } from '../../../../src/server/rate-limit';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

let storage: ReturnType<typeof createStorage> | null = null;
function getStorage(): ReturnType<typeof createStorage> {
  storage ??= createStorage({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  });
  return storage;
}

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '_');
  const cleaned = trimmed.replace(FILENAME_SAFE, '_');
  return `${Date.now().toString(36)}_${cleaned || 'photo'}`.slice(0, 200);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  if (token.length < 1 || token.length > 64) {
    return NextResponse.json({ error: 'BAD_TOKEN' }, { status: 400 });
  }

  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0]?.trim() ?? 'unknown';
  for (const key of [`scan-upload:ip:${ip}`, `scan-upload:token:${token}`]) {
    const rl = await rateLimit(key, { limit: 20, windowSec: 60 });
    if (!rl.ok) {
      return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    }
  }

  const catRows = await db
    .select({
      tenantId: issueCategories.tenantId,
      archivedAt: issueCategories.archivedAt,
      enabledBuiltInFields: issueCategories.enabledBuiltInFields,
    })
    .from(issueCategories)
    .where(eq(issueCategories.publicShareToken, token))
    .limit(1);
  const cat = catRows[0];
  if (cat === undefined || cat.archivedAt !== null) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const fields = cat.enabledBuiltInFields as readonly string[] | null;
  if (fields === null || !fields.includes('media')) {
    return NextResponse.json({ error: 'MEDIA_DISABLED' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'TOO_LARGE' }, { status: 413 });
  }
  if (!ACCEPTED_IMAGE_MIME.has(file.type)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }

  const safeName = sanitizeFilename(file.name);
  const key = objectKey({
    tenantId: cat.tenantId as never,
    module: 'issues',
    entityId: newId() as never,
    filename: safeName,
  });
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (env.NODE_ENV === 'production') {
    try {
      const uploadUrl = await getStorage().getSignedUploadUrl({
        key,
        contentType: file.type,
      });
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': file.type },
      });
      if (!res.ok) {
        logger.error({ key, status: res.status }, '[scan-upload] R2 PUT failed');
        return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
      }
    } catch (err) {
      logger.error({ err }, '[scan-upload] R2 PUT threw');
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  } else {
    const target = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  return NextResponse.json({
    key,
    filename: safeName,
    mimeType: file.type,
    sizeBytes: file.size,
  });
}
