/**
 * Session-gated inspection preview endpoint.
 *
 * Mints a short-lived HMAC render token server-side and issues a 302
 * redirect to `/render/inspection/<id>?token=…`. The render route
 * returns the exact HTML that Puppeteer would capture for the PDF, so
 * embedding it in an `<iframe>` gives users a pixel-accurate preview
 * without exposing RENDER_SHARED_SECRET to the browser.
 *
 * Why a redirect instead of streaming the HTML: the token is embedded
 * in the URL so the browser can cache it within the 5-minute TTL.
 * Streaming would require reading the response in JS, preventing the
 * iframe from rendering natively.
 */
import { inspections } from '@forma360/db/schema';
import { hasPermission, loadUserPermissions } from '@forma360/permissions/requirePermission';
import { signRenderToken } from '@forma360/render/hmac';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { auth } from '../../../../src/server/auth';
import { db } from '../../../../src/server/db';
import { env } from '../../../../src/server/env';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const inspectionId = url.searchParams.get('inspectionId') ?? '';
  if (inspectionId.length !== 26) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  // ── Auth ─────────────────────────────────────────────────────────────
  const session = await auth.api.getSession({ headers: req.headers }).catch(() => null);
  if (session === null || session.user.tenantId == null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // ── Permission ───────────────────────────────────────────────────────
  // This route hand-rolled its auth and checked only "is there a session
  // for this tenant", while all ten sibling export routes delegate to a
  // `requirePermission`-guarded procedure. The token it mints unlocks the
  // full print view — every answer, signature, conductor name and
  // attachment photo — so any signed-in member, including a
  // zero-permission or contractor-portal account, could read every
  // inspection in the tenant by iterating ids. It requires the same key as
  // the PDF route it previews, because it exposes the identical content.
  //
  // `loadUserPermissions` returns [] for a deactivated user, so this is
  // also the revocation check for a route that resolves its own session
  // rather than going through `createContext`.
  const permissions = await loadUserPermissions(
    db,
    session.user.tenantId as string,
    session.user.id,
  );
  if (!hasPermission(permissions, 'inspections.export')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // ── Tenant-scoped ownership check ────────────────────────────────────
  const rows = await db
    .select({ id: inspections.id })
    .from(inspections)
    .where(
      and(
        eq(inspections.id, inspectionId),
        eq(inspections.tenantId, session.user.tenantId as string),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // ── Mint token + redirect ────────────────────────────────────────────
  const token = signRenderToken({
    secret: env.RENDER_SHARED_SECRET,
    inspectionId,
  });
  const renderPath = `/render/inspection/${inspectionId}?token=${encodeURIComponent(token)}`;
  return NextResponse.redirect(new URL(renderPath, req.url), 302);
}
