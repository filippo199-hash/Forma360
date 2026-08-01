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
} from '@forma360/render';
import {
  documents,
  headsUpAttachments,
  headsUpDocuments,
  headsUps,
  user,
} from '@forma360/db/schema';
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { PrintLayout } from '../../../src/components/print-layout';
import { HeadsUpPublicView } from '../../../src/components/heads-up/public-view';
import { db } from '../../../src/server/db';
import { fetchLogoUrl } from '../../../src/server/storage';

interface Props {
  params: Promise<{ token: string }>;
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

    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <PrintLayout snapshot={snapshot} logoUrl={logoUrl} />
      </div>
    );
  }

  // Not an inspection link — try heads-ups (only published resolve).
  const headsUp = await validateHeadsUpShareToken(db, token);
  if (headsUp === null) notFound();

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
    db
      .select({ name: documents.name })
      .from(headsUpDocuments)
      .innerJoin(documents, eq(headsUpDocuments.documentId, documents.id))
      .where(
        and(
          eq(headsUpDocuments.tenantId, headsUp.tenantId),
          eq(headsUpDocuments.headsUpId, headsUp.headsUpId),
        ),
      ),
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
