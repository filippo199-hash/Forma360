/**
 * SDS → hazard profile extraction endpoint.
 *
 * Takes an uploaded safety data sheet PDF and returns the validated
 * `SdsExtraction` the Add-substance form pre-fills from. Blob storage is
 * separate (`/api/upload/coshh-doc`) — this route only reads the bytes.
 *
 * Auth: session + `coshh.create` or `coshh.manage`; brand-gated;
 * rate-limited (a 20 MB PDF fed to Opus — cap per user).
 */
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { brandHasModule } from '@forma360/shared/brand';
import { headers } from 'next/headers';
import { activeBrand } from '../../../../src/lib/brand';
import { knowledgeSuffix, loadAgentOverlay } from '../../../../src/server/agent-overlay';
import { extractSdsFromPdf } from '../../../../src/server/coshh-ai';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';
import { createContext } from '../../../../src/server/trpc';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(request: Request) {
  if (!brandHasModule(activeBrand.id, 'coshh')) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const ctx = await createContext({ headers: await headers() });
  if (ctx.auth === null) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('coshh.create') && !perms.includes('coshh.manage')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rl = await rateLimit(`ai:coshh-sds:${ctx.auth.userId}`, { limit: 10, windowSec: 300 });
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
  if (file.type !== 'application/pdf') {
    return Response.json({ error: 'Upload the safety data sheet as a PDF.' }, { status: 415 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const overlay = await loadAgentOverlay(ctx.db, ctx.auth.tenantId, 'sds-importer');
    if (!overlay.enabled) {
      return Response.json({ error: 'agent-disabled' }, { status: 403 });
    }
    const extraction = await extractSdsFromPdf({
      filename: file.name,
      bytes,
      systemSuffix: knowledgeSuffix(overlay, ''),
    });
    return Response.json({ extraction });
  } catch (err) {
    ctx.logger.warn({ err }, '[coshh-sds-import] extraction failed');
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not read the safety data sheet.' },
      { status: 422 },
    );
  }
}
