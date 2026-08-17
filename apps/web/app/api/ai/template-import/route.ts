import { hasPermission, loadUserPermissions } from '@forma360/permissions/requirePermission';
import { headers } from 'next/headers';
import { auth } from '../../../../src/server/auth';
import { db } from '../../../../src/server/db';
import { convertFileToSpec } from '../../../../src/server/template-import';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = (session.user as Record<string, unknown>)['tenantId'];
  if (typeof tenantId !== 'string') {
    return Response.json({ error: 'No tenant' }, { status: 403 });
  }

  // This route had no permission gate at all — a session was enough. Two
  // reasons that mattered more here than the missing check suggests: the
  // uploaded bytes are parsed by `XLSX.read`, and `xlsx@0.18.5` carries
  // prototype-pollution and ReDoS advisories with no patched release on npm;
  // and the file is then handed to the most expensive model path in the
  // product. An anonymous `/try` sandbox visitor who supplied no email held
  // a session, so both were reachable without an account.
  const permissions = await loadUserPermissions(db, tenantId, session.user.id);
  if (
    !hasPermission(permissions, 'templates.create') &&
    !hasPermission(permissions, 'templates.manage')
  ) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  // A 20 MB file fed to Opus — cap per user.
  const rl = await rateLimit(`ai:template-import:${session.user.id}`, { limit: 5, windowSec: 300 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get('file');
    if (value instanceof File) file = value;
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  if (file === null) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'File too large (max 20 MB).' }, { status: 413 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const spec = await convertFileToSpec({
      filename: file.name,
      mimeType: file.type,
      bytes,
    });
    return Response.json({ spec });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not convert the file.' },
      { status: 422 },
    );
  }
}
