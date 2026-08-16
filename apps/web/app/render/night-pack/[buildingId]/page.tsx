/**
 * Internal Puppeteer render target for building PEEP night packs
 * (FreeHS module B4). HMAC-gated via the `?token=` query string — see
 * `@forma360/render`'s `signRenderToken` / `verifyRenderToken`. Any
 * request without a valid token is 404ed (not 401: we don't want
 * automated scanners to learn the route exists).
 *
 * Not `[locale]`-prefixed: Puppeteer has no session — the route serves a
 * single-purpose print HTML page, not a user-facing view.
 */
import { verifyRenderToken, loadNightPackSnapshot } from '@forma360/render';
import { fireBuildings } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import {
  NightPackPrintLayout,
  type NightPackPrintBranding,
} from '../../../../src/components/fire-safety/night-pack-print-layout';
import { env } from '../../../../src/server/env';
import { db } from '../../../../src/server/db';
import { loadTenantBrandingById } from '../../../../src/server/load-branding';

interface Props {
  params: Promise<{ buildingId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function RenderNightPackPage({ params, searchParams }: Props) {
  const [{ buildingId }, { token }] = await Promise.all([params, searchParams]);
  if (typeof token !== 'string') notFound();
  // The token signs the subject id (the field is named for its original
  // inspection use); a tampered id breaks the signature.
  const ok = verifyRenderToken({
    secret: env.RENDER_SHARED_SECRET,
    inspectionId: buildingId,
    token,
  });
  if (!ok) notFound();

  // No session on this route — trust the HMAC + id binding, mirroring
  // /render/drill. ULIDs are globally unique so the tenant lookup by id
  // alone cannot cross tenants.
  const rows = await db
    .select({ tenantId: fireBuildings.tenantId })
    .from(fireBuildings)
    .where(eq(fireBuildings.id, buildingId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) notFound();

  const snapshot = await loadNightPackSnapshot(db, { tenantId: row.tenantId, buildingId });
  if (snapshot === null) notFound();

  // ADR 0018: tenant branding — company logo + palette in the header.
  const tenant = await loadTenantBrandingById(row.tenantId);
  const branding: NightPackPrintBranding = {
    logoUrl: tenant.logoUrl,
    ...(tenant.branding?.primaryColor !== undefined
      ? { primaryColor: tenant.branding.primaryColor }
      : {}),
    ...(tenant.branding?.accentColor !== undefined
      ? { accentColor: tenant.branding.accentColor }
      : {}),
  };

  return (
    <NightPackPrintLayout
      snapshot={snapshot}
      branding={branding}
      fallbackTimeZone={env.APP_TIMEZONE}
    />
  );
}
