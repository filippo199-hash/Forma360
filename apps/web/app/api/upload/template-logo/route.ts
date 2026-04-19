/**
 * Template logo upload endpoint.
 *
 * Mirrors apps/web/app/api/upload/route.ts but targets a template instead
 * of an in-progress inspection. Callers must be authenticated, scoped to
 * the template's tenant, and hold `templates.manage`. Accepts a short
 * list of image MIME types up to 2 MB.
 *
 * Storage key layout:
 *   <tenantId>/templates/<templateId>/<filename>
 *
 * Dev / test fallback: when R2 credentials are absent we persist the blob
 * to `.local-storage/<key>` exactly the way the media upload route does.
 * Prod never silently falls back — `NODE_ENV==='production'` always takes
 * the R2 path.
 */
import { appRouter } from '@forma360/api';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { objectKey } from '@forma360/shared/storage';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

async function ensureTemplateAccess(
  ctx: Awaited<ReturnType<typeof createContext>>,
  templateId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (ctx.auth === null) return { ok: false, status: 401, error: 'UNAUTHORIZED' };

  // Permission check — same key the tRPC templates.manage procedure uses.
  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('templates.manage')) {
    return { ok: false, status: 403, error: 'FORBIDDEN' };
  }

  // Tenant / existence check via the tRPC caller.
  const caller = appRouter.createCaller(ctx);
  try {
    await caller.templates.get({ templateId });
  } catch {
    return { ok: false, status: 404, error: 'NOT_FOUND' };
  }
  return { ok: true };
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const form = await req.formData();
  const templateId = String(form.get('templateId') ?? '');
  const file = form.get('file');
  if (templateId.length !== 26 || !(file instanceof File)) {
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

  const access = await ensureTemplateAccess(ctx, templateId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const safeName = sanitizeFilename(file.name);
  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'templates',
    entityId: templateId as never,
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
        ctx.logger.error({ key, status: res.status }, '[template-logo] R2 PUT failed');
        return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
      }
    } catch (err) {
      ctx.logger.error({ err }, '[template-logo] R2 PUT threw');
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
      ctx.logger.warn({ err, key }, '[template-logo] signed URL failed');
    }
  } else {
    // The local-storage fallback has no HTTP serve; clients refetch via
    // GET /signed-url which handles the dev branch identically.
    url = `/api/upload/template-logo/signed-url?key=${encodeURIComponent(key)}`;
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

  // Enforce tenant prefix on the key — prevents a caller from signing URLs
  // to another tenant's objects.
  if (!key.startsWith(`${ctx.auth.tenantId}/templates/`)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  if (env.NODE_ENV === 'production') {
    try {
      const signed = await storage.getSignedDownloadUrl({ key });
      return NextResponse.json({ url: signed });
    } catch (err) {
      ctx.logger.error({ err, key }, '[template-logo] signed URL failed');
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  }

  // Dev / test: stream the file out of .local-storage so the preview
  // works without R2 creds.
  try {
    const path = join(process.cwd(), '.local-storage', key);
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
