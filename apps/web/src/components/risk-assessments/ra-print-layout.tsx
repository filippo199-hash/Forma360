/**
 * Print layout for the Puppeteer-facing `/render/risk-assessment/*`
 * route (rendered inside `app/render/layout.tsx`'s bare html/body).
 * One compact A4 record: header, meta line, hazards table (initial risk
 * → controls → residual risk), sign-off. English-only like the
 * inspection PrintLayout: the rendered artefact is a portable document,
 * not a localised screen.
 */
import type { RiskAssessmentRenderSnapshot } from '@forma360/render';
import { bandFor, type RiskMatrixConfig } from '@forma360/shared/risk-matrix';
import { CompanyLetterhead } from '../company-letterhead';

const TIER_LABELS: Record<string, string> = {
  eliminate: 'Eliminate',
  substitute: 'Substitute',
  engineering: 'Engineering',
  administrative: 'Administrative',
  ppe: 'PPE',
};

const GROUP_LABELS: Record<string, string> = {
  employees: 'Employees',
  cleaners: 'Cleaners',
  contractors: 'Contractors',
  visitors: 'Visitors',
  young_persons: 'Young persons',
  new_expectant_mothers: 'New & expectant mothers',
  lone_workers: 'Lone workers',
  members_of_public: 'Members of the public',
  residents_service_users: 'Residents / service users',
};

const BAND_LABELS: Record<string, string> = {
  none: '—',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

function riskCell(l: number | null, s: number | null, matrix: RiskMatrixConfig): string {
  if (l === null || s === null) return '—';
  // Shared banding — severity floors included, matching the app exactly.
  const band = bandFor(l, s, matrix);
  return `${l * s} (${BAND_LABELS[band] ?? band})`;
}

export function RaPrintLayout({
  snapshot,
  companyLogoUrl = null,
}: {
  snapshot: RiskAssessmentRenderSnapshot;
  /** Pre-resolved signed URL for the tenant logo (letterhead). */
  companyLogoUrl?: string | null;
}) {
  const { assessment, hazards } = snapshot;
  const metaParts = [
    assessment.type === 'dynamic' ? 'Dynamic / point-of-work' : 'Standing assessment',
    assessment.status.charAt(0).toUpperCase() + assessment.status.slice(1),
    ...(assessment.currentVersion > 0 ? [`Version ${assessment.currentVersion}`] : []),
    ...(assessment.siteName !== null ? [assessment.siteName] : []),
    ...(assessment.createdByName !== null
      ? [`Created by ${assessment.createdByName} on ${assessment.createdAt.slice(0, 10)}`]
      : []),
    ...(assessment.nextReviewAt !== null
      ? [`Next review ${assessment.nextReviewAt.slice(0, 10)}`]
      : []),
  ];

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @page { size: A4; margin: 1cm; }
            .ra-print { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 10pt; line-height: 1.35; }
            .ra-print table { border-collapse: collapse; width: 100%; }
            .ra-print th, .ra-print td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; text-align: left; }
            .ra-print th { background: #f0f0f0; }
            .ra-print p { margin: 0 0 6px; }
            .ra-print .ra-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 4px; }
            .ra-print .ra-title { font-size: 14pt; font-weight: 700; }
            .ra-print .ra-ref { font-family: monospace; }
            .ra-print .ra-cell-p { margin: 0; }
          `,
        }}
      />
      <div className="ra-print">
        <CompanyLetterhead company={snapshot.company} logoUrl={companyLogoUrl} />
        <div className="ra-head">
          <span className="ra-title">{assessment.title}</span>
          <span className="ra-ref">{assessment.referenceNumber ?? ''}</span>
        </div>
        <p>{metaParts.join(' · ')}</p>
        {assessment.activity.length > 0 ? <p>{assessment.activity}</p> : null}

        <table>
          <thead>
            <tr>
              <th style={{ width: '24%' }}>Hazard &amp; harm</th>
              <th style={{ width: '18%' }}>Who might be harmed</th>
              <th style={{ width: '10%' }}>Initial risk</th>
              <th style={{ width: '38%' }}>Controls</th>
              <th style={{ width: '10%' }}>Residual risk</th>
            </tr>
          </thead>
          <tbody>
            {hazards.map((h) => (
              <tr key={h.id}>
                <td>
                  <strong>{h.hazard}</strong>
                  {h.harmDescription.length > 0 ? <> — {h.harmDescription}</> : null}
                </td>
                <td>{h.affectedGroups.map((g) => GROUP_LABELS[g] ?? g).join(', ')}</td>
                <td>{riskCell(h.initialLikelihood, h.initialSeverity, assessment.matrix)}</td>
                <td>
                  {h.existingControls.length > 0 ? (
                    <p className="ra-cell-p">{h.existingControls}</p>
                  ) : null}
                  {h.controls.map((c) => (
                    <p key={c.id} className="ra-cell-p">
                      [{TIER_LABELS[c.tier] ?? c.tier}] {c.description}
                      {c.status === 'planned' ? ' (planned)' : ''}
                      {c.ppeJustification !== null && c.ppeJustification.length > 0
                        ? ` — PPE justification: ${c.ppeJustification}`
                        : ''}
                    </p>
                  ))}
                </td>
                <td>
                  {riskCell(h.residualLikelihood, h.residualSeverity, assessment.matrix)}
                  {h.residualJustification.length > 0 ? (
                    <p className="ra-cell-p" style={{ fontStyle: 'italic' }}>
                      {h.residualJustification}
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={{ marginTop: '10px' }}>
          The assessor confirms this is a suitable and sufficient assessment of the risks of the
          activity described.
          {/* M-2: attribute the sign-off to the actual signer of the
              current version, falling back to the creator only for
              never-published drafts. */}
          {assessment.signedOffByName !== null
            ? ` — Signed off by ${assessment.signedOffByName}`
            : assessment.createdByName !== null
              ? ` — ${assessment.createdByName}`
              : ''}
          {assessment.signedOffAt !== null
            ? ` on ${assessment.signedOffAt.slice(0, 10)}`
            : assessment.publishedAt !== null
              ? `, ${assessment.publishedAt.slice(0, 10)}`
              : ''}
          {assessment.currentVersion > 0 ? ` (version ${assessment.currentVersion})` : ''}
        </p>
      </div>
    </>
  );
}
