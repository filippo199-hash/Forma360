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
import { itemAcceptsEvidence } from '@forma360/shared/inspection-eval';
import { createStorage, objectKey } from '@forma360/shared/storage';
import {
  PHONE_IMAGE_MIME,
  PHONE_VIDEO_MIME,
  resolveUploadMime,
  uploadKind,
} from '@forma360/shared/upload-media';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { storageThrew } from '../../../src/server/upload-failure';
import { createContext } from '../../../src/server/trpc';
import { env } from '../../../src/server/env';
import { normalisePhoneMedia } from '../../../src/server/phone-media';

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

  // Walk the pinned content to verify the itemId is somewhere a file may
  // legitimately land: a `media` question, or a multiple-choice question
  // whose options can demand evidence (`requireEvidence`). The second
  // case used to be rejected outright while the conduct UI required
  // exactly that upload before it would let the inspection be submitted —
  // see `itemAcceptsEvidence`.
  let itemOk = itemAcceptsEvidence(inspectionData.version.content, itemId);
  if (!itemOk) {
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
  }
  if (!itemOk) {
    return NextResponse.json({ error: 'ITEM_NOT_MEDIA' }, { status: 400 });
  }

  // Phone capture formats + pdf. Notably still excludes text/html and
  // image/svg+xml, which would be stored XSS if served inline. The
  // conduct UI has always advertised video/* on media questions — the
  // route now actually accepts what the picker offers.
  const ACCEPTED_MEDIA_MIME = new Set<string>([
    ...PHONE_IMAGE_MIME,
    ...PHONE_VIDEO_MIME,
    'application/pdf',
  ]);
  // Some Android browsers report "" or octet-stream for camera files —
  // resolve via the extension before deciding anything.
  const resolvedMime = resolveUploadMime(file.name, file.type);
  if (resolvedMime === null || !ACCEPTED_MEDIA_MIME.has(resolvedMime)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }
  // This route historically had no size cap at all; phone video gets a
  // generous one rather than none.
  const maxBytes = uploadKind(resolvedMime) === 'video' ? 100 * 1024 * 1024 : 25 * 1024 * 1024;
  if (file.size > maxBytes) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 400 });
  }

  // HEIC/HEIF → JPEG so responses and PDF exports can render the photo.
  const media = await normalisePhoneMedia(
    {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: resolvedMime,
      filename: sanitizeFilename(file.name),
    },
    ctx.logger,
  );
  const safeName = media.filename;
  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'inspections',
    entityId: inspectionId as never,
    filename: safeName,
  });
  const bytes = media.bytes;

  if (env.NODE_ENV === 'production') {
    try {
      const s = getStorage();
      // The facade only exposes signed URLs — but we need a server-side
      // PUT. Build a presigned upload URL, PUT to it. This keeps the S3
      // client construction isolated inside `@forma360/shared`.
      await s.putObject({ key, contentType: media.mimeType, bytes });
    } catch (err) {
      return storageThrew(ctx.logger, 'upload', key, err);
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
