/**
 * Internal Puppeteer render target for risk assessments (FreeHS module
 * B1). HMAC-gated via the `?token=` query string — see
 * `@forma360/render`'s `signRenderToken` / `verifyRenderToken`. Any
 * request without a valid token is 404ed (not 401: we don't want
 * automated scanners to learn the route exists).
 *
 * Not `[locale]`-prefixed: Puppeteer has no session — the route serves a
 * single-purpose print HTML page, not a user-facing view.
 */
import { verifyRenderToken, loadRiskAssessmentSnapshot } from '@forma360/render';
import { riskAssessments } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { RaPrintLayout } from '../../../../src/components/risk-assessments/ra-print-layout';
import { env } from '../../../../src/server/env';
import { db } from '../../../../src/server/db';

interface Props {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function RenderRiskAssessmentPage({ params, searchParams }: Props) {
  const [{ assessmentId }, { token }] = await Promise.all([params, searchParams]);
  if (typeof token !== 'string') notFound();
  // The token signs the subject id (the field is named for its original
  // inspection use); a tampered id breaks the signature.
  const ok = verifyRenderToken({
    secret: env.RENDER_SHARED_SECRET,
    inspectionId: assessmentId,
    token,
  });
  if (!ok) notFound();

  // No session on this route — trust the HMAC + id binding, mirroring
  // /render/inspection. ULIDs are globally unique so the tenant lookup
  // by id alone cannot cross tenants.
  const rows = await db
    .select({ tenantId: riskAssessments.tenantId })
    .from(riskAssessments)
    .where(eq(riskAssessments.id, assessmentId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) notFound();

  const snapshot = await loadRiskAssessmentSnapshot(db, {
    tenantId: row.tenantId,
    assessmentId,
  });
  if (snapshot === null) notFound();

  return <RaPrintLayout snapshot={snapshot} />;
}
