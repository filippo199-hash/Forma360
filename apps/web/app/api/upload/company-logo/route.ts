/**
 * Company logo (branding) upload endpoint.
 *
 * Mirrors apps/web/app/api/upload/template-logo/route.ts but targets the
 * tenant's own branding rather than a single template. Callers must be
 * authenticated and hold `org.settings` (the Administrator key). Accepts a
 * short list of image MIME types up to 2 MB.
 *
 * Storage key layout:
 *   <tenantId>/branding/<tenantId>/<filename>
 *
 * Dev / test fallback: when R2 credentials are absent we persist the blob
 * to `.local-storage/<key>` exactly the way the media upload route does.
 * Prod never silently falls back — `NODE_ENV==='production'` always takes
 * the R2 path.
 */
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { isObjectKey, objectKey } from '@forma360/shared/storage';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { storageFailed } from '../../../../src/server/upload-failure';
import { createContext } from '../../../../src/server/trpc';
import { env } from '../../../../src/server/env';
import { storage } from '../../../../src/server/storage';

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED_MIME = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '_');
  const cleaned = trimmed.replace(FILENAME_SAFE, '_');
  const timestamp = Date.now().toString(36);
  return `${timestamp}_${cleaned || 'logo'}`.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // Permission check — branding is an org-level setting, gated on the same
  // Administrator key (`org.settings`) as tenants.updateBranding.
  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('org.settings')) {
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
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 400 });
  }
  if (!ACCEPTED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }

  const safeName = sanitizeFilename(file.name);
  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'branding',
    entityId: ctx.auth.tenantId as never,
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
        return await storageFailed(ctx.logger, 'company-logo', key, res);
      }
    } catch (err) {
      ctx.logger.error({ err }, '[company-logo] R2 PUT threw');
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  } else {
    const target = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  let url: string | null = null;
  if (env.NODE_ENV === 'production') {
    try {
      url = await storage.getSignedDownloadUrl({ key });
    } catch (err) {
      ctx.logger.warn({ err, key }, '[company-logo] signed URL failed');
    }
  } else {
    // The local-storage fallback has no HTTP serve; clients refetch via
    // GET /signed-url which handles the dev branch identically.
    url = `/api/upload/company-logo?key=${encodeURIComponent(key)}`;
  }

  return NextResponse.json({ key, url });
}

export async function GET(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const url = new URL(req.url);
  const key = url.searchParams.get('key') ?? '';
  if (key.length === 0) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  // Key must be a well-formed `<tenantId>/<module>/<entityId>/<filename>`
  // object key. This rejects path-traversal payloads (extra `../` segments
  // fail the 4-segment shape) before the key ever reaches the filesystem.
  if (!isObjectKey(key)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  // Enforce tenant prefix on the key — prevents a caller from signing URLs
  // to another tenant's objects.
  if (!key.startsWith(`${ctx.auth.tenantId}/branding/`)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  if (env.NODE_ENV === 'production') {
    try {
      const signed = await storage.getSignedDownloadUrl({ key });
      return NextResponse.json({ url: signed });
    } catch (err) {
      ctx.logger.error({ err, key }, '[company-logo] signed URL failed');
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  }

  // Dev / test: stream the file out of .local-storage so the preview
  // works without R2 creds.
  try {
    const base = join(process.cwd(), '.local-storage');
    const path = join(base, key);
    // Belt-and-suspenders: never let a resolved path escape the storage root.
    if (!resolve(path).startsWith(resolve(base) + sep)) {
      return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
    }
    const buf = await readFile(path);
    const contentType = guessContentType(key);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { 'content-type': contentType, 'cache-control': 'private, max-age=60' },
    });
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
}

function guessContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
