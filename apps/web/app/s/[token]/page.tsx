/**
 * Public share viewer.
 *
 * Resolves the opaque token first against `public_inspection_links` via
 * `@forma360/render`'s `validateShareToken`, then — if that misses —
 * against published heads-ups via `validateHeadsUpShareToken`. 404s for
 * any unknown, expired, or revoked token. Renders the shared inspection
 * with the same `<PrintLayout />` the internal render route uses, or a
 * read-only `<HeadsUpPublicView />` for a heads-up.
 *
 * No session, no cookie: possession of the token IS the permission
 * check. See ADR 0008.
 */
import {
  validateShareToken,
  validateHeadsUpShareToken,
  loadInspectionSnapshot,
  loadRamsSnapshot,
} from '@forma360/render';
import { loadHeadsUpLibraryDocuments } from '@forma360/api/heads-up-documents';
import { headsUpAttachments, headsUps, ramsClientLinks, user } from '@forma360/db/schema';
import { DEFAULT_LOCALE, isLocale } from '@forma360/i18n/config';
import { and, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { activeBrand } from '../../../src/lib/brand';
import { PrintLayout, type PrintTenantBranding } from '../../../src/components/print-layout';
import { ShareLinkDeadEnd } from '../../../src/components/share-link-dead-end';
import { HeadsUpPublicView } from '../../../src/components/heads-up/public-view';
import { RamsClientAcceptanceView } from '../../../src/components/rams/client-acceptance-view';
import { db } from '../../../src/server/db';
import { env } from '../../../src/server/env';
import { loadTenantBrandingById } from '../../../src/server/load-branding';
import { fetchLogoUrl } from '../../../src/server/storage';

interface Props {
  params: Promise<{ token: string }>;
}

/** Pick the best supported locale from an Accept-Language header. */
function negotiateLocale(acceptLanguage: string | null): string {
  if (acceptLanguage === null) return DEFAULT_LOCALE;
  for (const part of acceptLanguage.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    const primary = tag.split('-')[0] ?? '';
    if (isLocale(tag)) return tag;
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/**
 * UXW3-03: a revoked, expired or unknown token gets a designed dead-end,
 * never the bare framework 404 — the person holding a dead link may have
 * signed the document behind it, and "page not found" reads as "the
 * evidence is gone". The refusal itself is unchanged.
 */
async function shareLinkDeadEnd() {
  const locale = negotiateLocale((await headers()).get('accept-language'));
  const t = await getTranslations({ locale, namespace: 'shareLink' });
  return (
    <ShareLinkDeadEnd
      brandName={activeBrand.name}
      title={t('inactiveTitle')}
      body={t('inactiveBody')}
    />
  );
}

export default async function SharedInspectionPage({ params }: Props) {
  const { token } = await params;
  const claims = await validateShareToken(db, token);
  if (claims !== null) {
    const snapshot = await loadInspectionSnapshot(db, {
      tenantId: claims.tenantId,
      inspectionId: claims.inspectionId,
    });
    if (snapshot === null) notFound();

    const brandingKey = (
      snapshot.template.content as
        | { settings?: { branding?: { logoStorageKey?: string } } }
        | undefined
    )?.settings?.branding?.logoStorageKey;
    const logoUrl = await fetchLogoUrl(brandingKey);

    // ADR 0018: tenant branding backs up the template's own (per-field).
    const tenant = await loadTenantBrandingById(claims.tenantId);
    const tenantBranding: PrintTenantBranding = {
      logoUrl: tenant.logoUrl,
      ...(tenant.branding?.primaryColor !== undefined
        ? { primaryColor: tenant.branding.primaryColor }
        : {}),
      ...(tenant.branding?.accentColor !== undefined
        ? { accentColor: tenant.branding.accentColor }
        : {}),
    };

    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <PrintLayout snapshot={snapshot} logoUrl={logoUrl} tenantBranding={tenantBranding} />
      </div>
    );
  }

  // Not an inspection link — try a RAMS client link. Revoked and expired
  // links dead-end rather than rendering a stale pack: a client must never
  // be shown a version that has been withdrawn or superseded out from
  // under them (RS-E12).
  const ramsLinkRows = await db
    .select({
      tenantId: ramsClientLinks.tenantId,
      packVersionId: ramsClientLinks.packVersionId,
      expiresAt: ramsClientLinks.expiresAt,
      revokedAt: ramsClientLinks.revokedAt,
      decision: ramsClientLinks.decision,
      acceptedByName: ramsClientLinks.acceptedByName,
    })
    .from(ramsClientLinks)
    .where(eq(ramsClientLinks.token, token))
    .limit(1);
  const ramsLink = ramsLinkRows[0];
  if (ramsLink !== undefined) {
    if (ramsLink.revokedAt !== null) return shareLinkDeadEnd();
    if (ramsLink.expiresAt !== null && ramsLink.expiresAt.getTime() < Date.now())
      return shareLinkDeadEnd();
    const ramsSnapshot = await loadRamsSnapshot(db, {
      tenantId: ramsLink.tenantId,
      packVersionId: ramsLink.packVersionId,
    });
    if (ramsSnapshot === null) notFound();
    // Issuer's letterhead logo — the client sees who sent the pack.
    const issuerBranding = await loadTenantBrandingById(ramsLink.tenantId);
    // RS-A14: drop the tenant id before it crosses to the client bundle.
    const { tenantId: _packTenantId, ...publicPack } = ramsSnapshot.pack;
    return (
      <RamsClientAcceptanceView
        snapshot={{ ...ramsSnapshot, pack: publicPack }}
        token={token}
        alreadyDecided={
          ramsLink.decision === 'pending'
            ? null
            : { decision: ramsLink.decision, acceptedByName: ramsLink.acceptedByName }
        }
        companyLogoUrl={issuerBranding.logoUrl}
        fallbackTimeZone={env.APP_TIMEZONE}
      />
    );
  }

  // Not a RAMS link either — try heads-ups (only published resolve).
  const headsUp = await validateHeadsUpShareToken(db, token);
  if (headsUp === null) return shareLinkDeadEnd();

  // Load attachments + linked-document names + the created-at / creator,
  // all tenant-scoped by the resolved tenantId + headsUpId. Mirrors the
  // authed `headsUps.get` query shape.
  const [headsUpRows, creatorRows, attachmentRows, documentRows] = await Promise.all([
    db
      .select({ createdAt: headsUps.createdAt })
      .from(headsUps)
      .where(and(eq(headsUps.tenantId, headsUp.tenantId), eq(headsUps.id, headsUp.headsUpId)))
      .limit(1),
    db
      .select({ name: user.name })
      .from(user)
      .where(and(eq(user.tenantId, headsUp.tenantId), eq(user.id, headsUp.createdByUserId)))
      .limit(1),
    db
      .select({
        id: headsUpAttachments.id,
        storageKey: headsUpAttachments.storageKey,
        filename: headsUpAttachments.filename,
        mimeType: headsUpAttachments.mimeType,
      })
      .from(headsUpAttachments)
      .where(
        and(
          eq(headsUpAttachments.tenantId, headsUp.tenantId),
          eq(headsUpAttachments.headsUpId, headsUp.headsUpId),
        ),
      ),
    // HU-D04: this route has no viewer, so there is nobody to check a
    // restriction against — and it is reachable by anyone holding the URL.
    // Passing `userId: null` asks the honest question instead: is this
    // document restricted at all? A document scoped to any group or site
    // (or sitting under a folder that is) is dropped, so a title like
    // "Redundancy consultation — night shift" cannot escape to the open
    // internet. Evaluated per render, so restricting a document *after* the
    // link was minted takes effect immediately.
    loadHeadsUpLibraryDocuments(db, headsUp.tenantId, headsUp.headsUpId, { userId: null }),
  ]);

  const createdAt = headsUpRows[0]?.createdAt ?? new Date();

  // Mint signed URLs for image/file attachments (the public viewer has no
  // session, so it can't hit the authed file proxy). Same signing helper
  // the render route uses for instruction media.
  const attachments = await Promise.all(
    attachmentRows.map(async (a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      url: await fetchLogoUrl(a.storageKey),
    })),
  );

  return (
    <HeadsUpPublicView
      title={headsUp.title}
      description={headsUp.description}
      creatorName={creatorRows[0]?.name ?? null}
      createdAt={createdAt}
      attachments={attachments}
      documents={documentRows}
      engagementLevel={headsUp.engagementLevel}
    />
  );
}
