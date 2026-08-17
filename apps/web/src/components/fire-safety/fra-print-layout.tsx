/**
 * Print layout for the Puppeteer-facing `/render/fra/*` route (HSE
 * review FS-5) — the fire risk assessment as a filable document:
 * premises, occupancy, the fire-triangle narrative, significant
 * findings, the review trail and the Responsible Person's sign-off.
 * English-only like the other print layouts: the rendered artefact is
 * a portable record, not a localised screen.
 */
import type { FraRenderSnapshot } from '@forma360/render';
import { CompanyLetterhead } from '../company-letterhead';

const RATING_LABELS: Record<string, string> = {
  trivial: 'Trivial',
  tolerable: 'Tolerable',
  moderate: 'Moderate',
  substantial: 'Substantial',
  intolerable: 'Intolerable',
};

const METHODOLOGY_LABELS: Record<string, string> = {
  pas79: 'PAS 79',
  hse_five_step: 'HSE five-step',
  other: 'Other',
};

const CATEGORY_LABELS: Record<string, string> = {
  ignition_sources: 'Ignition sources',
  fuel_storage: 'Fuel storage',
  dangerous_substances: 'Dangerous substances',
  means_of_escape: 'Means of escape',
  detection_warning: 'Detection & warning',
  emergency_lighting: 'Emergency lighting',
  compartmentation: 'Compartmentation',
  fire_doors: 'Fire doors',
  external_walls: 'External walls',
  firefighting_equipment: 'Firefighting equipment',
  management: 'Management',
  training_drills: 'Training & drills',
  signage: 'Signage',
  arson_security: 'Arson & security',
  other: 'Other',
};

const PERSONS_LABELS: Record<string, string> = {
  employees: 'Employees',
  residents: 'Residents',
  sleeping_occupants: 'Sleeping occupants',
  visitors: 'Visitors',
  contractors: 'Contractors',
  young_persons: 'Young persons',
  persons_requiring_assistance: 'Persons requiring assistance',
  lone_workers: 'Lone workers',
  members_of_public: 'Members of the public',
};

const TRIGGER_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  post_incident: 'After an incident',
  material_change: 'Material change',
  legislation_change: 'Legislation change',
  manual: 'Other',
};

function day(iso: string | null): string {
  return iso !== null ? iso.slice(0, 10) : '—';
}

function Narrative({ label, text }: { label: string; text: string }) {
  if (text.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 11 }}>{label}</div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  );
}

export function FraPrintLayout({
  snapshot,
  companyLogoUrl = null,
}: {
  snapshot: FraRenderSnapshot;
  /** Pre-resolved signed URL for the tenant logo (letterhead). */
  companyLogoUrl?: string | null;
}) {
  const { fra, building, findings, reviews } = snapshot;
  const rating = fra.riskRating !== null ? (RATING_LABELS[fra.riskRating] ?? fra.riskRating) : '—';
  const open = findings.filter((f) => f.resolvedAt === null);
  const resolved = findings.filter((f) => f.resolvedAt !== null);

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
      <CompanyLetterhead company={snapshot.company} logoUrl={companyLogoUrl} />
      <header style={{ borderBottom: '2px solid #111', paddingBottom: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
          Fire risk assessment{fra.referenceNumber !== null ? ` · ${fra.referenceNumber}` : ''}
        </div>
        <h1 style={{ fontSize: 20, margin: '2px 0 4px' }}>{fra.title}</h1>
        <div style={{ fontSize: 11, color: '#444' }}>
          {[
            METHODOLOGY_LABELS[fra.methodology] ?? fra.methodology,
            fra.status === 'active' ? 'Published' : fra.status === 'draft' ? 'DRAFT' : 'Archived',
            building !== null ? building.name : null,
            fra.nextReviewAt !== null ? `Next review ${day(fra.nextReviewAt)}` : null,
          ]
            .filter((v) => v !== null)
            .join(' · ')}
        </div>
        {fra.status !== 'active' ? (
          <div style={{ marginTop: 6, fontWeight: 700, color: '#8a6d00' }}>
            {fra.status === 'draft'
              ? 'DRAFT — not yet signed by the Responsible Person.'
              : 'ARCHIVED — retained for record; no longer the current assessment.'}
          </div>
        ) : null}
        {fra.attestationStale ? (
          <div style={{ marginTop: 6, fontWeight: 700, color: '#a11' }}>
            CONTENT CHANGED SINCE SIGN-OFF — the signature below covers an earlier version;
            re-attestation pending.
          </div>
        ) : null}
      </header>

      <section style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 11 }}>Premises</div>
          <div>
            {building !== null ? (
              <>
                {building.name}
                {building.address.length > 0 ? <>, {building.address}</> : null}
                <br />
                {[
                  building.isResidential ? 'Residential' : 'Non-residential',
                  building.heightMetres !== null ? `${building.heightMetres} m` : null,
                  building.storeys !== null ? `${building.storeys} storeys` : null,
                ]
                  .filter((v) => v !== null)
                  .join(' · ')}
              </>
            ) : (
              '—'
            )}
          </div>
          {fra.premisesDescription.length > 0 ? (
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{fra.premisesDescription}</div>
          ) : null}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 11 }}>Occupancy & persons at risk</div>
          <div>
            {fra.personsAtRisk.length > 0
              ? fra.personsAtRisk.map((g) => PERSONS_LABELS[g] ?? g).join(', ')
              : '—'}
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: '#444' }}>
            {[
              fra.maxOccupancy !== null ? `Max occupancy ${fra.maxOccupancy}` : null,
              fra.sleepingOccupants ? 'Sleeping occupants present' : null,
            ]
              .filter((v) => v !== null)
              .join(' · ')}
          </div>
        </div>
      </section>

      <section
        style={{
          border: '2px solid #111',
          padding: '8px 12px',
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 700 }}>Taken-together risk rating</span>
        <span
          style={{
            fontWeight: 700,
            fontSize: 14,
            color:
              fra.riskRating === 'intolerable' || fra.riskRating === 'substantial'
                ? '#a11'
                : '#111',
          }}
        >
          {rating}
          {fra.riskRating === 'intolerable'
            ? ' — occupation should not continue until the risk is reduced'
            : ''}
        </span>
      </section>

      <section style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, borderBottom: '1px solid #999', paddingBottom: 2 }}>
          Hazard identification & evaluation
        </h2>
        <Narrative label="Sources of ignition" text={fra.ignitionSources} />
        <Narrative label="Sources of fuel" text={fra.fuelSources} />
        <Narrative label="Sources of oxygen" text={fra.oxygenSources} />
        <Narrative label="Evaluation" text={fra.evaluationNotes} />
      </section>

      <section style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, borderBottom: '1px solid #999', paddingBottom: 2 }}>
          Significant findings ({findings.length})
        </h2>
        {findings.length === 0 ? (
          <p>No significant findings recorded — confirmed by the Responsible Person on publish.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['Category', 'Priority', 'Finding', 'Status'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      borderBottom: '1px solid #111',
                      padding: '3px 6px 3px 0',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...open, ...resolved].map((f) => (
                <tr key={f.id}>
                  <td
                    style={{ padding: '3px 6px 3px 0', verticalAlign: 'top', whiteSpace: 'nowrap' }}
                  >
                    {CATEGORY_LABELS[f.category] ?? f.category}
                  </td>
                  <td
                    style={{
                      padding: '3px 6px 3px 0',
                      verticalAlign: 'top',
                      textTransform: 'capitalize',
                    }}
                  >
                    {f.priority}
                  </td>
                  <td style={{ padding: '3px 6px 3px 0', verticalAlign: 'top' }}>
                    {f.description}
                  </td>
                  <td style={{ padding: '3px 0', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                    {f.resolvedAt !== null
                      ? `Resolved ${day(f.resolvedAt)}`
                      : f.hasAction
                        ? 'Action raised'
                        : f.requiresAction
                          ? 'Action pending'
                          : 'Noted'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {reviews.length > 0 ? (
        <section style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 13, borderBottom: '1px solid #999', paddingBottom: 2 }}>
            Review history
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <tbody>
              {reviews.map((r, i) => (
                <tr key={i}>
                  <td
                    style={{ padding: '2px 8px 2px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}
                  >
                    {day(r.reviewedAt)}
                  </td>
                  <td
                    style={{ padding: '2px 8px 2px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}
                  >
                    {TRIGGER_LABELS[r.trigger] ?? r.trigger} · {r.outcome}
                  </td>
                  <td style={{ padding: '2px 0', verticalAlign: 'top' }}>
                    {[r.reviewedByName, r.note.length > 0 ? r.note : null]
                      .filter((v) => v !== null)
                      .join(' — ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <footer style={{ borderTop: '2px solid #111', paddingTop: 8, marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 24 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 11 }}>Responsible Person</div>
            <div>{fra.responsiblePersonName.length > 0 ? fra.responsiblePersonName : '—'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 11 }}>Assessor</div>
            <div>{fra.assessorName.length > 0 ? fra.assessorName : '—'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 11 }}>Signed & published</div>
            <div>
              {fra.publishedAt !== null
                ? `${fra.publishedByName ?? '—'} on ${day(fra.publishedAt)}`
                : 'Not yet published'}
            </div>
          </div>
        </div>
        <p style={{ fontSize: 10, color: '#555', marginTop: 8 }}>
          Attestation on publish: the signatory confirmed this fire risk assessment is suitable and
          sufficient for the premises under the Regulatory Reform (Fire Safety) Order 2005, article
          9, and that the significant findings above are recorded.
        </p>
      </footer>
    </main>
  );
}
