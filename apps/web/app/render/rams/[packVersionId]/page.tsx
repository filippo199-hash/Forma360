/**
 * Internal Puppeteer render target for RAMS packs (FreeHS module B6).
 * HMAC-gated via the `?token=` query string — see `@forma360/render`'s
 * `signRenderToken` / `verifyRenderToken`. Any request without a valid
 * token is 404ed (not 401: we don't want automated scanners to learn the
 * route exists).
 *
 * Keyed on the pack VERSION, not the pack: the PDF prints the frozen
 * artefact as issued, so re-rendering an old version reproduces exactly
 * what the client received (RS-E07).
 *
 * Not `[locale]`-prefixed: Puppeteer has no session — the route serves a
 * single-purpose print HTML page, not a user-facing view.
 */
import { verifyRenderToken, loadRamsSnapshot } from '@forma360/render';
import { ramsPackVersions } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { RamsPrintLayout } from '../../../../src/components/rams/rams-print-layout';
import { env } from '../../../../src/server/env';
import { db } from '../../../../src/server/db';

interface Props {
  params: Promise<{ packVersionId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function RenderRamsPage({ params, searchParams }: Props) {
  const [{ packVersionId }, { token }] = await Promise.all([params, searchParams]);
  if (typeof token !== 'string') notFound();
  // The token signs the subject id (the field is named for its original
  // inspection use); a tampered id breaks the signature.
  const ok = verifyRenderToken({
    secret: env.RENDER_SHARED_SECRET,
    inspectionId: packVersionId,
    token,
  });
  if (!ok) notFound();

  // No session on this route — trust the HMAC + id binding, mirroring
  // /render/permit. ULIDs are globally unique so the tenant lookup by id
  // alone cannot cross tenants.
  const rows = await db
    .select({ tenantId: ramsPackVersions.tenantId })
    .from(ramsPackVersions)
    .where(eq(ramsPackVersions.id, packVersionId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) notFound();

  const snapshot = await loadRamsSnapshot(db, { tenantId: row.tenantId, packVersionId });
  if (snapshot === null) notFound();

  return <RamsPrintLayout snapshot={snapshot} />;
}
