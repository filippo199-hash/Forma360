/**
 * Company letterhead for every printed/rendered document — permits,
 * risk assessments, FRAs, RAMS packs, incident reports, drill records,
 * night packs and inspection reports.
 *
 * The practitioners' PDFs went out with no company identity at all, so
 * a filed permit looked like it belonged to nobody. This strip renders
 * the tenant's name, logo and whatever an admin filled in on
 * settings/company (`snapshot.company`, loaded by `@forma360/render`):
 * name + logo on the left, address / contact / registration lines
 * right-aligned — the classic letterhead shape.
 *
 * Deliberately colour-neutral and inline-styled: it sits above eight
 * different print layouts (black-border permit tables, slate RAMS
 * pages, branded fire-safety records) and must fight none of them.
 * English-only like the print layouts it serves — the rendered artefact
 * is a portable document, not a localised screen.
 */
import type { TenantCompanySnapshot } from '@forma360/render';

function joinPresent(parts: ReadonlyArray<string | null>, separator: string): string {
  return parts.filter((p): p is string => p !== null && p.length > 0).join(separator);
}

export function CompanyLetterhead({
  company,
  logoUrl = null,
}: {
  company: TenantCompanySnapshot;
  /**
   * Pre-resolved signed URL for the tenant logo. The headless browser
   * has no session, so the print routes exchange
   * `company.logoStorageKey` for this via `loadTenantBrandingById`;
   * layouts whose header already shows the logo pass null to avoid
   * printing it twice.
   */
  logoUrl?: string | null;
}) {
  const address = joinPresent(
    [company.addressLine1, company.addressLine2, company.city, company.postcode, company.country],
    ', ',
  );
  const contact = joinPresent(
    [company.phone !== null ? `Tel ${company.phone}` : null, company.email, company.website],
    ' · ',
  );
  const registration = joinPresent(
    [
      company.companyNumber !== null ? `Company No. ${company.companyNumber}` : null,
      company.vatNumber !== null ? `VAT ${company.vatNumber}` : null,
    ],
    ' · ',
  );
  const hasDetails = address.length > 0 || contact.length > 0 || registration.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        borderBottom: '1px solid #bbb',
        paddingBottom: 8,
        marginBottom: 10,
        fontFamily: 'Helvetica, Arial, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {logoUrl !== null ? (
          <img
            src={logoUrl}
            alt=""
            style={{ maxHeight: 42, maxWidth: 150, objectFit: 'contain' }}
          />
        ) : null}
        <div>
          <div style={{ fontSize: '12pt', fontWeight: 700, lineHeight: 1.2, color: '#111' }}>
            {company.name}
          </div>
          {company.legalName !== null && company.legalName !== company.name ? (
            <div style={{ fontSize: '7.5pt', color: '#555' }}>{company.legalName}</div>
          ) : null}
        </div>
      </div>
      {hasDetails ? (
        <div
          style={{
            textAlign: 'right',
            fontSize: '7.5pt',
            color: '#444',
            lineHeight: 1.5,
            maxWidth: '58%',
          }}
        >
          {address.length > 0 ? <div>{address}</div> : null}
          {contact.length > 0 ? <div>{contact}</div> : null}
          {registration.length > 0 ? <div>{registration}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
