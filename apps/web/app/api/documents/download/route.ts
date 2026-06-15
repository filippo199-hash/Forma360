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
import { documents } from '@forma360/db/schema';
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
    .where(
      and(eq(documents.tenantId, ctx.auth.tenantId), eq(documents.id, documentId)),
    )
    .limit(1);

  const doc = rows[0];
  if (doc === undefined) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  if (env.NODE_ENV === 'production') {
    try {
      const signedUrl = await getStorage().getSignedDownloadUrl({
        key: doc.storageKey,
        expiresInSeconds: PREVIEW_TTL_SECONDS,
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
        'Content-Disposition': `inline; filename="${doc.filename}"`,
        'Content-Length': String(doc.sizeBytes),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'FILE_NOT_FOUND' }, { status: 404 });
  }
}
