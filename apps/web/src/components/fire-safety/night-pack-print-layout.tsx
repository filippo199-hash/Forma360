/**
 * Print layout for the Puppeteer-facing `/render/night-pack/*` route —
 * one building's PEEP night pack: the sheet night staff keep at the
 * desk. Who needs help getting out (current PEEPs with their plan,
 * buddy and equipment), who sweeps which floor (current marshals), and
 * where the secure information box is. English-only like the other
 * print layouts: the rendered artefact is a portable record, not a
 * localised screen.
 *
 * PEEP content is health-adjacent — this layout is only reachable via
 * the HMAC-gated render route driven by the `fireSafety.view`-gated
 * procedure; there is deliberately no share-token path.
 */
import type { NightPackRenderSnapshot } from '@forma360/render';
import { formatInTimeZone, resolveDocumentTimeZone } from '@forma360/shared/timezone';
import { CompanyLetterhead } from '../company-letterhead';

export interface NightPackPrintBranding {
  /** Resolved (signed) logo URL, or null when the tenant has none. */
  logoUrl: string | null;
  primaryColor?: string;
  accentColor?: string;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

const th: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  borderBottom: '1px solid #333',
  padding: '4px 6px',
};

const td: React.CSSProperties = {
  verticalAlign: 'top',
  borderBottom: '1px solid #ccc',
  padding: '5px 6px',
};

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        border: '1px solid #333',
        padding: '1px 8px',
        marginRight: 6,
        fontSize: 10,
        color: on ? '#111' : '#999',
        textDecoration: on ? 'none' : 'line-through',
      }}
    >
      {label}
    </span>
  );
}

export function NightPackPrintLayout({
  snapshot,
  branding = null,
  fallbackTimeZone,
}: {
  snapshot: NightPackRenderSnapshot;
  branding?: NightPackPrintBranding | null;
  /** BUG-14: the deployment's APP_TIMEZONE — the LAST resort. */
  fallbackTimeZone: string;
}) {
  const { building, peeps, marshals } = snapshot;
  const primary = branding?.primaryColor ?? '#111';
  const accent = branding?.accentColor ?? primary;
  const timeZone = resolveDocumentTimeZone(
    building.siteTimeZone,
    building.tenantTimeZone,
    fallbackTimeZone,
  );
  const generatedAt = formatInTimeZone(new Date(), timeZone, 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });

  return (
    <main
      style={{
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontSize: 12,
        color: '#111',
        padding: '28px 32px',
        maxWidth: 780,
      }}
    >
      {/* The letterhead carries the company name, logo and details — the
          header used to hand-roll the name + logo half of it. */}
      <CompanyLetterhead company={snapshot.company} logoUrl={branding?.logoUrl ?? null} />
      <header style={{ borderBottom: `2px solid ${primary}`, paddingBottom: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
          Fire safety
        </div>
        <h1 style={{ fontSize: 20, margin: '2px 0 4px', color: primary }}>Evacuation night pack</h1>
        <div style={{ fontSize: 11, color: '#444' }}>
          {building.name}
          {building.address.length > 0 ? ` · ${building.address}` : ''}
        </div>
        {building.useDescription.length > 0 ? (
          <div style={{ fontSize: 11, color: '#444' }}>{building.useDescription}</div>
        ) : null}
      </header>

      <section style={{ marginBottom: 12 }}>
        <Flag label="Residential" on={building.isResidential} />
        <Flag label="Fire alarm" on={building.hasFireAlarm} />
        <Flag label="Emergency lighting" on={building.hasEmergencyLighting} />
        <Flag label="Sprinklers" on={building.hasSprinklers} />
        {building.storeys !== null ? (
          <span style={{ fontSize: 10, marginRight: 6 }}>{building.storeys} storeys</span>
        ) : null}
        {building.heightMetres !== null ? (
          <span style={{ fontSize: 10 }}>{building.heightMetres} m</span>
        ) : null}
      </section>

      {building.secureInfoBoxLocation.length > 0 ? (
        <section
          style={{
            border: `2px solid ${accent}`,
            padding: '8px 12px',
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 11 }}>Secure information box</div>
          <div>{building.secureInfoBoxLocation}</div>
        </section>
      ) : null}

      <section style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 13, borderBottom: '1px solid #999', paddingBottom: 2 }}>
          People needing assistance (PEEPs)
        </h2>
        {peeps.length === 0 ? (
          <p style={{ color: '#555' }}>No current PEEPs for this building.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={th}>Person</th>
                <th style={th}>Assistance needs</th>
                <th style={th}>Plan</th>
                <th style={th}>Buddy</th>
                <th style={th}>Equipment</th>
                <th style={th}>Review due</th>
              </tr>
            </thead>
            <tbody>
              {peeps.map((p) => (
                <tr key={p.id}>
                  <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>{p.personName}</td>
                  <td style={td}>{p.assistanceNeeds || '—'}</td>
                  <td style={td}>{p.planSummary || '—'}</td>
                  <td style={td}>{p.buddyName || '—'}</td>
                  <td style={td}>{p.equipmentNeeded || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{day(p.nextReviewAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 13, borderBottom: '1px solid #999', paddingBottom: 2 }}>
          Fire marshals
        </h2>
        {marshals.length === 0 ? (
          <p style={{ color: '#555' }}>No current marshals for this building.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Role</th>
                <th style={th}>Area swept</th>
              </tr>
            </thead>
            <tbody>
              {marshals.map((m) => (
                <tr key={m.id}>
                  <td style={{ ...td, fontWeight: 700 }}>{m.name ?? '—'}</td>
                  <td style={td}>{m.role === 'deputy' ? 'Deputy' : 'Marshal'}</td>
                  <td style={td}>{m.area || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer style={{ borderTop: `2px solid ${primary}`, paddingTop: 8, marginTop: 16 }}>
        <p style={{ fontSize: 10, color: '#555', margin: 0 }}>
          Generated {generatedAt} · Personal data — store securely, destroy superseded copies.
        </p>
      </footer>
    </main>
  );
}
