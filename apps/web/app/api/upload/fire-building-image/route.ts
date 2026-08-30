/**
 * Fire-building photo upload (review round 4).
 *
 * Mirrors apps/web/app/api/upload/site-media/route.ts — the blob-only
 * half; the caller stores the returned key on the building via
 * `fireSafety.buildings.update({ imageKey })`. Images only (a building
 * photo, not a media gallery), 10 MB cap, HEIC/HEIF → JPEG so the
 * register thumbnail can actually render.
 *
 * Storage key layout:
 *   <tenantId>/fire-safety/<buildingId>/<filename>
 *
 * Auth: session-required + `fireSafety.manage` (the same permission the
 * update mutation demands). Tenant scope is enforced by the session and
 * again by `/api/files`'s tenant-prefix check on the way back out.
 */
import { fireBuildings } from '@forma360/db/schema';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { objectKey } from '@forma360/shared/storage';
import { and, eq } from 'drizzle-orm';
import { PHONE_IMAGE_MIME, resolveUploadMime } from '@forma360/shared/upload-media';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { storageThrew } from '../../../../src/server/upload-failure';
import { createContext } from '../../../../src/server/trpc';
import { env } from '../../../../src/server/env';
import { normalisePhoneMedia } from '../../../../src/server/phone-media';
import { storage } from '../../../../src/server/storage';

// 10 MB — one photo of a building, not a video gallery.
const MAX_BYTES = 10 * 1024 * 1024;
// NB: image/svg+xml stays excluded — SVG can carry <script>.
const ACCEPTED_MIME = new Set<string>([...PHONE_IMAGE_MIME]);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '_');
  const cleaned = trimmed.replace(FILENAME_SAFE, '_');
  const timestamp = Date.now().toString(36);
  return `${timestamp}_${cleaned || 'building'}`.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('fireSafety.manage')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const form = await req.formData();
  const buildingId = String(form.get('buildingId') ?? '');
  const file = form.get('file');
  if (buildingId.length !== 26 || !(file instanceof File)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  // The key embeds the buildingId — prove it names a real building of
  // THIS tenant before writing a blob under it.
  const building = await ctx.db
    .select({ id: fireBuildings.id })
    .from(fireBuildings)
    .where(and(eq(fireBuildings.tenantId, ctx.auth.tenantId), eq(fireBuildings.id, buildingId)))
    .limit(1);
  if (building[0] === undefined) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: 'EMPTY_FILE' }, { status: 400 });
  }
  // Some Android browsers report "" or octet-stream for camera files —
  // resolve via the extension before deciding anything.
  const resolvedMime = resolveUploadMime(file.name, file.type);
  if (resolvedMime === null || !ACCEPTED_MIME.has(resolvedMime)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 400 });
  }

  const media = await normalisePhoneMedia(
    {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: resolvedMime,
      filename: sanitizeFilename(file.name),
    },
    ctx.logger,
  );
  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'fire-safety',
    entityId: buildingId as never,
    filename: media.filename,
  });

  if (env.NODE_ENV === 'production') {
    try {
      await storage.putObject({ key, contentType: media.mimeType, bytes: media.bytes });
    } catch (err) {
      return storageThrew(ctx.logger, 'fire-building-image', key, err);
    }
  } else {
    const target = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, media.bytes);
  }

  return NextResponse.json({
    storageKey: key,
    filename: media.filename,
    mimeType: media.mimeType,
    sizeBytes: media.bytes.length,
  });
}
