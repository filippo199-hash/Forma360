/**
 * Internal Puppeteer render target for incident reports (FreeHS module
 * B5). HMAC-gated via the `?token=` query string — see
 * `@forma360/render`'s `signRenderToken` / `verifyRenderToken`. Any
 * request without a valid token is 404ed (not 401: we don't want
 * automated scanners to learn the route exists).
 *
 * Not `[locale]`-prefixed: Puppeteer has no session — the route serves a
 * single-purpose print HTML page, not a user-facing view. Confidential
 * access is enforced upstream: the only issuer of tokens is
 * `incidents.renderPdf`, which runs the confidentiality check.
 */
import { verifyRenderToken, loadIncidentSnapshot } from '@forma360/render';
import { incidents } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { IncidentPrintLayout } from '../../../../src/components/incidents/incident-print-layout';
import { env } from '../../../../src/server/env';
import { db } from '../../../../src/server/db';

interface Props {
  params: Promise<{ incidentId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function RenderIncidentPage({ params, searchParams }: Props) {
  const [{ incidentId }, { token }] = await Promise.all([params, searchParams]);
  if (typeof token !== 'string') notFound();
  // The token signs the subject id (the field is named for its original
  // inspection use); a tampered id breaks the signature.
  const ok = verifyRenderToken({
    secret: env.RENDER_SHARED_SECRET,
    inspectionId: incidentId,
    token,
  });
  if (!ok) notFound();

  // No session on this route — trust the HMAC + id binding, mirroring
  // /render/permit. ULIDs are globally unique so the tenant lookup by id
  // alone cannot cross tenants.
  const rows = await db
    .select({ tenantId: incidents.tenantId })
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) notFound();

  const snapshot = await loadIncidentSnapshot(db, {
    tenantId: row.tenantId,
    incidentId,
  });
  if (snapshot === null) notFound();

  return <IncidentPrintLayout snapshot={snapshot} />;
}
