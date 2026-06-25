/**
 * Internal Puppeteer render target. HMAC-gated via the `?token=`
 * query string — see `@forma360/render`'s `signRenderToken` /
 * `verifyRenderToken`. Any request without a valid token is 404ed
 * (not 401: we don't want automated scanners to learn the route
 * exists).
 *
 * This route is NOT prefixed by `[locale]` because Puppeteer has no
 * session — the route serves a single-purpose print HTML page, not a
 * user-facing view.
 */
import { verifyRenderToken, loadInspectionSnapshot } from '@forma360/render';
import { inspections } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { PrintLayout } from '../../../../src/components/print-layout';
import { env } from '../../../../src/server/env';
import { db } from '../../../../src/server/db';
import { fetchLogoUrl } from '../../../../src/server/storage';

interface Props {
  params: Promise<{ inspectionId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function RenderInspectionPage({ params, searchParams }: Props) {
  const [{ inspectionId }, { token }] = await Promise.all([params, searchParams]);
  if (typeof token !== 'string') notFound();
  const ok = verifyRenderToken({
    secret: env.RENDER_SHARED_SECRET,
    inspectionId,
    token,
  });
  if (!ok) notFound();

  // The render route does not have a session, so we have to trust the
  // HMAC + URL-embedded inspection id entirely. The token is signed
  // against the inspection id, so if the id is tampered with the
  // signature breaks. We look up across all tenants — the ACL check
  // already happened at the tRPC layer when the render was kicked off.
  // The snapshot function returns `null` for unknown inspections; we
  // 404 to avoid leaking the distinction.
  //
  // Cross-tenant: impossible in practice because every inspection id
  // is globally unique (ULID) and the snapshot fetch matches by id.
  // We pass a dummy tenantId of the row we find by a direct lookup.
  const rows = await db
    .select({ tenantId: inspections.tenantId })
    .from(inspections)
    .where(eq(inspections.id, inspectionId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) notFound();

  const snapshot = await loadInspectionSnapshot(db, {
    tenantId: row.tenantId,
    inspectionId,
  });
  if (snapshot === null) notFound();

  const brandingKey = (
    snapshot.template.content as
      | { settings?: { branding?: { logoStorageKey?: string } } }
      | undefined
  )?.settings?.branding?.logoStorageKey;
  const logoUrl = await fetchLogoUrl(brandingKey);

  // Pre-resolve signed URLs for instruction image attachments (the headless
  // browser has no session, so it can't hit the /api/files proxy). Only
  // instructions that show in the report, and only images, need a URL.
  const mediaUrls: Record<string, string> = {};
  const contentForMedia = snapshot.template.content as
    | {
        pages?: ReadonlyArray<{
          sections?: ReadonlyArray<{
            items?: ReadonlyArray<{
              type?: string;
              showInReport?: boolean;
              attachments?: ReadonlyArray<{ key: string; mimeType: string }>;
            }>;
          }>;
        }>;
      }
    | undefined;
  for (const page of contentForMedia?.pages ?? []) {
    for (const section of page.sections ?? []) {
      for (const item of section.items ?? []) {
        if (item.type !== 'instruction' || item.showInReport === false) continue;
        for (const a of item.attachments ?? []) {
          if (!a.mimeType.startsWith('image/')) continue;
          const u = await fetchLogoUrl(a.key);
          if (u !== null) mediaUrls[a.key] = u;
        }
      }
    }
  }

  return <PrintLayout snapshot={snapshot} logoUrl={logoUrl} mediaUrls={mediaUrls} />;
}
