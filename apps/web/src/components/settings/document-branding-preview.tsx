'use client';

/**
 * "On your documents" — live mock documents inside the Branding card.
 *
 * An admin picking a logo and colours had nothing to judge them against
 * except a swatch row; the place the branding actually lands is the
 * generated PDFs. These two miniature papers show exactly that, driven
 * by the branding form's LIVE state (an uploaded-but-unsaved logo
 * included) plus the saved company details from the card above:
 *
 *   - a formal record (permit / assessment / report style) headed by the
 *     REAL `CompanyLetterhead` component the print layouts mount, so the
 *     preview cannot drift from what the renderer prints;
 *   - an inspection report cover, the surface where the primary and
 *     accent colours actually appear (cover bar + section rule).
 *
 * The text INSIDE the papers is fixed English on purpose — the rendered
 * documents themselves are English-only (same stance as the print
 * layouts), so an English mock is the honest preview. The chrome around
 * the papers (title, help, captions) is translated. Paper backgrounds
 * are locked white with dark ink: a document is white in dark mode too.
 */
import { useTranslations } from 'next-intl';
import type { TenantCompanySnapshot } from '@forma360/render';
import { CompanyLetterhead } from '../company-letterhead';
import { Label } from '../ui/label';
import { sampleForeground } from './company-branding';
import type { CompanyDetailsValue } from './company-details-form';

/** Muted placeholder bar standing in for document body text. */
function Line({ width }: { width: string }) {
  return <div style={{ height: 6, borderRadius: 2, background: '#e4e4e4', width }} />;
}

function toCompanySnapshot(
  name: string,
  details: CompanyDetailsValue | null,
): TenantCompanySnapshot {
  const str = (v: string | undefined): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;
  return {
    name,
    legalName: str(details?.legalName),
    addressLine1: str(details?.addressLine1),
    addressLine2: str(details?.addressLine2),
    city: str(details?.city),
    postcode: str(details?.postcode),
    country: str(details?.country),
    phone: str(details?.phone),
    email: str(details?.email),
    website: str(details?.website),
    companyNumber: str(details?.companyNumber),
    vatNumber: str(details?.vatNumber),
    logoStorageKey: null,
  };
}

const PAPER: React.CSSProperties = {
  background: '#ffffff',
  color: '#111111',
  padding: '14px 16px 12px',
  fontFamily: 'Helvetica, Arial, sans-serif',
};

export function DocumentBrandingPreview({
  companyName,
  details,
  logoUrl,
  primaryColor,
  accentColor,
}: {
  companyName: string;
  /** Saved company details from the card above (letterhead content). */
  details: CompanyDetailsValue | null;
  /** LIVE logo preview URL from the branding form, unsaved uploads included. */
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
}) {
  const t = useTranslations('settings.company.branding.docPreview');
  const company = toCompanySnapshot(companyName, details);
  const noDetails =
    details === null || Object.values(details).every((v) => v === undefined || v === '');

  return (
    <div className="space-y-1.5">
      <Label>{t('title')}</Label>
      <p className="text-xs text-muted-foreground">{t('help')}</p>
      <div className="space-y-3">
        {/* Formal record — permit / assessment / incident style. */}
        <figure className="m-0">
          <div className="overflow-hidden rounded-md border shadow-sm" aria-hidden="true">
            <div style={PAPER}>
              <CompanyLetterhead company={company} logoUrl={logoUrl} />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  borderBottom: '2px solid #000',
                  paddingBottom: 3,
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700 }}>PERMIT TO WORK — Hot work</span>
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>PTW-000123</span>
              </div>
              <div style={{ display: 'grid', gap: 5, marginBottom: 10 }}>
                <Line width="72%" />
                <Line width="48%" />
              </div>
              <table
                style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #000' }}
              >
                <thead>
                  <tr>
                    {['OK', 'Precondition', 'Confirmed by'].map((h, i) => (
                      <th
                        key={h}
                        style={{
                          border: '1px solid #000',
                          background: '#f0f0f0',
                          padding: '3px 6px',
                          fontSize: 9,
                          textAlign: 'left',
                          width: i === 0 ? '8%' : i === 2 ? '30%' : undefined,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ border: '1px solid #000', padding: '4px 6px', fontSize: 9 }}>
                      ☑
                    </td>
                    <td style={{ border: '1px solid #000', padding: '6px' }}>
                      <Line width="80%" />
                    </td>
                    <td style={{ border: '1px solid #000', padding: '6px' }}>
                      <Line width="60%" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <figcaption className="mt-1 text-xs text-muted-foreground">
            {t('recordCaption')}
          </figcaption>
        </figure>

        {/* Inspection report cover — where the palette does real work. */}
        <figure className="m-0">
          <div className="overflow-hidden rounded-md border shadow-sm" aria-hidden="true">
            <div style={PAPER}>
              <CompanyLetterhead company={company} />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 4,
                  marginBottom: 10,
                  backgroundColor: primaryColor,
                  color: sampleForeground(primaryColor),
                }}
              >
                {logoUrl !== null ? (
                  <img
                    src={logoUrl}
                    alt=""
                    style={{
                      height: 26,
                      width: 'auto',
                      objectFit: 'contain',
                      background: 'rgba(255,255,255,0.15)',
                      padding: 2,
                      borderRadius: 3,
                    }}
                  />
                ) : null}
                <span style={{ fontSize: 13, fontWeight: 700 }}>Weekly site inspection</span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  borderBottom: `2px solid ${accentColor}`,
                  paddingBottom: 2,
                  marginBottom: 7,
                }}
              >
                Site conditions
              </div>
              <div style={{ display: 'grid', gap: 5 }}>
                <Line width="85%" />
                <Line width="64%" />
                <Line width="40%" />
              </div>
            </div>
          </div>
          <figcaption className="mt-1 text-xs text-muted-foreground">
            {t('inspectionCaption')}
          </figcaption>
        </figure>
      </div>
      {noDetails ? <p className="text-xs text-muted-foreground">{t('emptyHint')}</p> : null}
    </div>
  );
}
