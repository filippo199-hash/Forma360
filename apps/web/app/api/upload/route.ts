/**
 * Media upload endpoint for the inspection conduct UI.
 *
 * Rules:
 *   - Session-required (better-auth).
 *   - Uses the tRPC server-side caller to fetch the inspection + pinned
 *     template version, which enforces `inspections.view` and tenant
 *     scoping for free.
 *   - Rejects uploads unless the itemId points at a `media` item on the
 *     pinned version and the inspection is still in_progress.
 *   - Stores the object under the Forma360 key convention:
 *       <tenantId>/inspections/<inspectionId>/<filename>
 *
 * R2 is the production sink. In development / test we fall back to
 * writing to `.local-storage/<key>` so the UI can be exercised without
 * R2 creds. The fallback is gated on NODE_ENV !== 'production' to make
 * sure a misconfigured prod never silently stores to disk.
 *
 * Future work (not this PR):
 *   - signed download URL endpoint for rendering uploaded media in
 *     responses + PDF export (PR 31).
 *   - image processing / thumbnail generation.
 */
import { appRouter } from '@forma360/api';
import { createStorage, objectKey } from '@forma360/shared/storage';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createContext } from '../../../src/server/trpc';
import { env } from '../../../src/server/env';

// Lazily-constructed storage client.
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
  const timestamp = Date.now().toString(36);
  return `${timestamp}_${cleaned || 'upload'}`.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const form = await req.formData();
  const inspectionId = String(form.get('inspectionId') ?? '');
  const itemId = String(form.get('itemId') ?? '');
  const file = form.get('file');
  if (inspectionId.length !== 26 || itemId.length !== 26 || !(file instanceof File)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: 'EMPTY_FILE' }, { status: 400 });
  }

  // Authoritative fetch via the tRPC caller — this enforces
  // `inspections.view` (which a conductor must have) and tenant scope.
  const caller = appRouter.createCaller(ctx);
  let inspectionData: Awaited<ReturnType<typeof caller.inspections.get>>;
  try {
    inspectionData = await caller.inspections.get({ inspectionId });
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  if (inspectionData.inspection.status !== 'in_progress') {
    return NextResponse.json({ error: 'NOT_IN_PROGRESS' }, { status: 409 });
  }

  // Walk the pinned content to verify the itemId is a media item.
  let itemOk = false;
  for (const page of inspectionData.version.content.pages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        if (item.id === itemId && item.type === 'media') {
          itemOk = true;
          break;
        }
      }
    }
  }
  if (!itemOk) {
    return NextResponse.json({ error: 'ITEM_NOT_MEDIA' }, { status: 400 });
  }

  const safeName = sanitizeFilename(file.name);
  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'inspections',
    entityId: inspectionId as never,
    filename: safeName,
  });
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (env.NODE_ENV === 'production') {
    try {
      const s = getStorage();
      // The facade only exposes signed URLs — but we need a server-side
      // PUT. Build a presigned upload URL, PUT to it. This keeps the S3
      // client construction isolated inside `@forma360/shared`.
      const uploadUrl = await s.getSignedUploadUrl({
        key,
        contentType: file.type || 'application/octet-stream',
      });
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      });
      if (!res.ok) {
        ctx.logger.error({ key, status: res.status }, '[upload] R2 PUT failed');
        return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
      }
    } catch (err) {
      ctx.logger.error({ err }, '[upload] R2 PUT threw');
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  } else {
    // Dev / test fallback — write to .local-storage/<key>. Gated on
    // NODE_ENV !== 'production' so a misconfigured prod never silently
    // stores to disk.
    const target = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  return NextResponse.json({ key });
}
