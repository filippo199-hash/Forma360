/**
 * Heads-Up attachment preview / download endpoint.
 *
 * GET /api/heads-up/attachment?attachmentId=<id>&disposition=inline
 *
 * Session-required, tenant-scoped. Used by the Heads-Up overview to render
 * image/video thumbnails and to download document attachments. Mirrors the
 * documents download route: signed R2 URL in prod, local stream in dev.
 */
import { headsUpAttachments } from '@forma360/db/schema';
import { createStorage } from '@forma360/shared/storage';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../../../../src/server/env';
import { createContext } from '../../../../src/server/trpc';

const PREVIEW_TTL_SECONDS = 15 * 60;

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

export async function GET(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const attachmentId = searchParams.get('attachmentId');
  if (attachmentId === null || attachmentId.length === 0) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const rows = await ctx.db
    .select({
      storageKey: headsUpAttachments.storageKey,
      filename: headsUpAttachments.filename,
      mimeType: headsUpAttachments.mimeType,
      sizeBytes: headsUpAttachments.sizeBytes,
    })
    .from(headsUpAttachments)
    .where(
      and(
        eq(headsUpAttachments.tenantId, ctx.auth.tenantId),
        eq(headsUpAttachments.id, attachmentId),
      ),
    )
    .limit(1);

  const att = rows[0];
  if (att === undefined) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // Active-content types never render inline (stored-XSS defense).
  const dangerousInline = /html|svg|xml/i.test(att.mimeType);
  const inline = searchParams.get('disposition') === 'inline' && !dangerousInline;
  const safeName = att.filename.replace(/["\\\r\n]/g, '_');
  const contentDisposition = `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`;

  if (env.NODE_ENV === 'production') {
    try {
      const signedUrl = await getStorage().getSignedDownloadUrl({
        key: att.storageKey,
        expiresInSeconds: PREVIEW_TTL_SECONDS,
        responseContentType: att.mimeType,
        responseContentDisposition: contentDisposition,
      });
      return NextResponse.redirect(signedUrl);
    } catch {
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  }

  const filePath = join(process.cwd(), '.local-storage', att.storageKey);
  try {
    const bytes = await readFile(filePath);
    return new Response(bytes, {
      headers: {
        'Content-Type': att.mimeType,
        'Content-Disposition': contentDisposition,
        'Content-Length': String(att.sizeBytes),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'FILE_NOT_FOUND' }, { status: 404 });
  }
}
