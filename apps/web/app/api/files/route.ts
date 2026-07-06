/**
 * Session-gated inspection file download.
 *
 * GET /api/files?key=<r2-key>
 *
 * Validates that the R2 key belongs to the authenticated user's tenant
 * (the key must start with `<tenantId>/`) then either:
 *   - prod: redirects to a 15-minute pre-signed R2 GET URL
 *   - dev:  streams the file from `.local-storage/<key>` so the
 *           conduct UI can be exercised without real R2 credentials.
 *
 * The tenant-prefix check prevents any authenticated user from accessing
 * files belonging to a different tenant — the R2 bucket is shared across
 * all tenants.
 */
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { isObjectKey } from '@forma360/shared/storage';
import { auth } from '../../../src/server/auth';
import { env } from '../../../src/server/env';
import { storage } from '../../../src/server/storage';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') ?? '';
  if (key.length === 0) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const session = await auth.api.getSession({ headers: req.headers }).catch(() => null);
  if (session === null || session.user.tenantId == null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // Key must be a well-formed `<tenantId>/<module>/<entityId>/<filename>`
  // object key. This rejects path-traversal payloads (extra `../` segments
  // fail the 4-segment shape) before the key ever reaches the filesystem.
  if (!isObjectKey(key)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  // Key must start with the caller's tenantId — cross-tenant access denied.
  if (!key.startsWith(`${session.user.tenantId}/`)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  if (env.NODE_ENV !== 'production') {
    // Dev: serve directly from the local filesystem fallback.
    const base = join(process.cwd(), '.local-storage');
    const localPath = join(base, key);
    // Belt-and-suspenders: never let a resolved path escape the storage root.
    if (!resolve(localPath).startsWith(resolve(base) + sep)) {
      return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
    }
    try {
      const bytes = await readFile(localPath);
      const filename = key.split('/').at(-1) ?? 'file';
      return new Response(bytes, {
        headers: {
          'Content-Disposition': `inline; filename="${filename}"`,
          // Prevent the browser from MIME-sniffing an uploaded file into
          // active content (stored-XSS defense).
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=300',
        },
      });
    } catch {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
  }

  // Prod: redirect to a short-lived R2 pre-signed URL.
  try {
    const signedUrl = await storage.getSignedDownloadUrl({
      key,
      expiresInSeconds: 60 * 15,
    });
    return NextResponse.redirect(signedUrl, 302);
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
}
