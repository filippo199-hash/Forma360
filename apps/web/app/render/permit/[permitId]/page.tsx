/**
 * Internal Puppeteer render target for permits (FreeHS module B3,
 * HSE review PW-6). HMAC-gated via the `?token=` query string — see
 * `@forma360/render`'s `signRenderToken` / `verifyRenderToken`. Any
 * request without a valid token is 404ed (not 401: we don't want
 * automated scanners to learn the route exists).
 *
 * Not `[locale]`-prefixed: Puppeteer has no session — the route serves a
 * single-purpose print HTML page, not a user-facing view.
 */
import { verifyRenderToken, loadPermitSnapshot } from '@forma360/render';
import { permits } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { PermitPrintLayout } from '../../../../src/components/permits/permit-print-layout';
import { env } from '../../../../src/server/env';
import { db } from '../../../../src/server/db';

interface Props {
  params: Promise<{ permitId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function RenderPermitPage({ params, searchParams }: Props) {
  const [{ permitId }, { token }] = await Promise.all([params, searchParams]);
  if (typeof token !== 'string') notFound();
  // The token signs the subject id (the field is named for its original
  // inspection use); a tampered id breaks the signature.
  const ok = verifyRenderToken({
    secret: env.RENDER_SHARED_SECRET,
    inspectionId: permitId,
    token,
  });
  if (!ok) notFound();

  // No session on this route — trust the HMAC + id binding, mirroring
  // /render/inspection. ULIDs are globally unique so the tenant lookup
  // by id alone cannot cross tenants.
  const rows = await db
    .select({ tenantId: permits.tenantId })
    .from(permits)
    .where(eq(permits.id, permitId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) notFound();

  const snapshot = await loadPermitSnapshot(db, {
    tenantId: row.tenantId,
    permitId,
  });
  if (snapshot === null) notFound();

  // BUG-14: the site's clock wins, then the tenant's default; the env
  // var is only the last resort. Both levels ride on the snapshot.
  return <PermitPrintLayout snapshot={snapshot} fallbackTimeZone={env.APP_TIMEZONE} />;
}
