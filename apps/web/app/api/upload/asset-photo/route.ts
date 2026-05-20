/**
 * Asset profile-photo upload endpoint.
 *
 * Accepts image/jpeg, image/png, image/webp up to 2 MB.
 * Returns `{ key }` — the R2 storage key — so the caller can pass it as
 * `photoKey` to `assets.create` or `assets.update`.
 *
 * Because the photo may be uploaded *before* the asset row exists (new-asset
 * flow), no assetId is required. The key is scoped to the tenant and the
 * current user so collisions are practically impossible:
 *   <tenantId>/assets/photos/<userId>/<timestamp>_<filename>
 *
 * Permission: assets.manage (same as create/update).
 */
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createContext } from '../../../../src/server/trpc';
import { env } from '../../../../src/server/env';
import { storage } from '../../../../src/server/storage';

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '_');
  const cleaned = trimmed.replace(FILENAME_SAFE, '_');
  const timestamp = Date.now().toString(36);
  return `${timestamp}_${cleaned || 'photo'}`.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('assets.manage')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

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
  const key = `${ctx.auth.tenantId}/assets/photos/${ctx.auth.userId}/${safeName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (env.NODE_ENV === 'production') {
    try {
      const uploadUrl = await storage.getSignedUploadUrl({
        key,
        contentType: file.type,
      });
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': file.type },
      });
      if (!res.ok) {
        ctx.logger.error({ key, status: res.status }, '[asset-photo] R2 PUT failed');
        return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
      }
    } catch (err) {
      ctx.logger.error({ err }, '[asset-photo] R2 PUT threw');
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  } else {
    // Dev/test fallback: write to .local-storage/
    try {
      const localPath = join(process.cwd(), '.local-storage', key);
      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, bytes);
    } catch (err) {
      ctx.logger.error({ err }, '[asset-photo] local write failed');
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  }

  return NextResponse.json({ key });
}
