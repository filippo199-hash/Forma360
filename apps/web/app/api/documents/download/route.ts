/**
 * Document preview / download endpoint.
 *
 * GET /api/documents/download?documentId=<ulid>
 *
 * - Session-required (better-auth cookie).
 * - Tenant-scoped: verifies the document belongs to the caller's tenant.
 * - Production: generates a 15-minute signed R2 GET URL and 302-redirects.
 * - Development: reads the file from .local-storage/ and streams it inline.
 *
 * Used by the document detail page to drive the inline file preview panel.
 */
import { documentVersions, documents } from '@forma360/db/schema';
import { createStorage } from '@forma360/shared/storage';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../../../../src/server/env';
import { createContext } from '../../../../src/server/trpc';

const PREVIEW_TTL_SECONDS = 15 * 60; // 15 minutes

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
  const documentId = searchParams.get('documentId');
  if (documentId === null || documentId.length === 0) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  // Verify ownership.
  const rows = await ctx.db
    .select({
      storageKey: documents.storageKey,
      filename: documents.filename,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
    })
    .from(documents)
    .where(and(eq(documents.tenantId, ctx.auth.tenantId), eq(documents.id, documentId)))
    .limit(1);

  let doc = rows[0];
  if (doc === undefined) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // `?version=N` previews/downloads a specific historical version instead of
  // the current one. Tenant ownership is already proven via the parent document.
  const versionParam = searchParams.get('version');
  if (versionParam !== null && versionParam.length > 0) {
    const versionNum = Number.parseInt(versionParam, 10);
    if (!Number.isNaN(versionNum)) {
      const vRows = await ctx.db
        .select({
          storageKey: documentVersions.storageKey,
          filename: documentVersions.filename,
          mimeType: documentVersions.mimeType,
          sizeBytes: documentVersions.sizeBytes,
        })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.version, versionNum),
          ),
        )
        .limit(1);
      const v = vRows[0];
      if (v === undefined) {
        return NextResponse.json({ error: 'VERSION_NOT_FOUND' }, { status: 404 });
      }
      doc = v;
    }
  }

  // `?disposition=inline` (preview iframe) renders in-browser; anything else
  // (or absent) downloads as an attachment. We always pin the content type so a
  // PDF stored with a generic type still previews. RFC 5987-safe filename.
  // Active-content types must never render inline (stored-XSS defense) —
  // force them to download regardless of the requested disposition.
  const dangerousInline = /html|svg|xml/i.test(doc.mimeType);
  const inline = searchParams.get('disposition') === 'inline' && !dangerousInline;
  const safeName = doc.filename.replace(/["\\\r\n]/g, '_');
  const contentDisposition = `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`;

  if (env.NODE_ENV === 'production') {
    try {
      const signedUrl = await getStorage().getSignedDownloadUrl({
        key: doc.storageKey,
        expiresInSeconds: PREVIEW_TTL_SECONDS,
        responseContentType: doc.mimeType,
        responseContentDisposition: contentDisposition,
      });
      return NextResponse.redirect(signedUrl);
    } catch {
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  }

  // Dev: serve from .local-storage/
  const filePath = join(process.cwd(), '.local-storage', doc.storageKey);
  try {
    const bytes = await readFile(filePath);
    return new Response(bytes, {
      headers: {
        'Content-Type': doc.mimeType,
        'Content-Disposition': contentDisposition,
        'Content-Length': String(doc.sizeBytes),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'FILE_NOT_FOUND' }, { status: 404 });
  }
}
