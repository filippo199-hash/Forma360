/**
 * Internal Puppeteer render target for fire risk assessments (FreeHS
 * module B4, HSE review FS-5). HMAC-gated via the `?token=` query
 * string — see `@forma360/render`'s `signRenderToken` /
 * `verifyRenderToken`. Any request without a valid token is 404ed (not
 * 401: we don't want automated scanners to learn the route exists).
 *
 * Not `[locale]`-prefixed: Puppeteer has no session — the route serves a
 * single-purpose print HTML page, not a user-facing view.
 */
import { verifyRenderToken, loadFraSnapshot } from '@forma360/render';
import { fireRiskAssessments } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { FraPrintLayout } from '../../../../src/components/fire-safety/fra-print-layout';
import { env } from '../../../../src/server/env';
import { db } from '../../../../src/server/db';
import { loadTenantBrandingById } from '../../../../src/server/load-branding';

interface Props {
  params: Promise<{ fraId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function RenderFraPage({ params, searchParams }: Props) {
  const [{ fraId }, { token }] = await Promise.all([params, searchParams]);
  if (typeof token !== 'string') notFound();
  // The token signs the subject id (the field is named for its original
  // inspection use); a tampered id breaks the signature.
  const ok = verifyRenderToken({
    secret: env.RENDER_SHARED_SECRET,
    inspectionId: fraId,
    token,
  });
  if (!ok) notFound();

  // No session on this route — trust the HMAC + id binding, mirroring
  // /render/permit. ULIDs are globally unique so the tenant lookup by id
  // alone cannot cross tenants.
  const rows = await db
    .select({ tenantId: fireRiskAssessments.tenantId })
    .from(fireRiskAssessments)
    .where(eq(fireRiskAssessments.id, fraId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) notFound();

  const snapshot = await loadFraSnapshot(db, { tenantId: row.tenantId, fraId });
  if (snapshot === null) notFound();

  // Company letterhead logo — the headless browser has no session, so
  // the route exchanges the R2 key for a signed URL (ADR 0018 pattern).
  const tenant = await loadTenantBrandingById(row.tenantId);

  return <FraPrintLayout snapshot={snapshot} companyLogoUrl={tenant.logoUrl} />;
}
