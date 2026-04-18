/**
 * Public share viewer.
 *
 * Resolves the opaque token against `public_inspection_links` via
 * `@forma360/render`'s `validateShareToken`, 404s for any unknown,
 * expired, or revoked token, and renders the shared inspection with
 * the same `<PrintLayout />` the internal render route uses.
 *
 * No session, no cookie: possession of the token IS the permission
 * check. See ADR 0008.
 */
import { validateShareToken, loadInspectionSnapshot } from '@forma360/render';
import { notFound } from 'next/navigation';
import { PrintLayout } from '../../../src/components/print-layout';
import { db } from '../../../src/server/db';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function SharedInspectionPage({ params }: Props) {
  const { token } = await params;
  const claims = await validateShareToken(db, token);
  if (claims === null) notFound();

  const snapshot = await loadInspectionSnapshot(db, {
    tenantId: claims.tenantId,
    inspectionId: claims.inspectionId,
  });
  if (snapshot === null) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PrintLayout snapshot={snapshot} />
    </div>
  );
}
