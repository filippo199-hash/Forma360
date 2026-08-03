/**
 * Print layout for a RAMS pack version (FreeHS module B6) — the single
 * combined artefact the client receives and the crew is briefed from.
 *
 * Renders the FROZEN version snapshot, never the mutable pack, so a pack
 * issued at v1 always prints as it was issued (RS-E07).
 *
 * Deliberately not translated: this is a Puppeteer-facing print target
 * with no session and no locale, matching `/render/permit`,
 * `/render/fra` and `/render/incident`. The `no-hardcoded-strings` rule
 * scopes to `app/[locale]/**` and `packages/ui`, so this file is outside
 * it by construction.
 */
import type { RamsRenderSnapshot } from '@forma360/render';

function formatDate(value: string | null): string {
  if (value === null) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ breakInside: 'avoid' }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6, color: '#64748b' }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: '#0f172a' }}>{value.length > 0 ? value : '—'}</div>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  if (body.trim().length === 0) return null;
  return (
    <div style={{ marginBottom: 10, breakInside: 'avoid' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a' }}>{title}</div>
      <div style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#334155' }}>{body}</div>
    </div>
  );
}

const SECTION: React.CSSProperties = {
  marginTop: 18,
  paddingTop: 8,
  borderTop: '2px solid #0f172a',
  breakInside: 'avoid',
};

const H2: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  margin: '0 0 8px',
  color: '#0f172a',
};

export function RamsPrintLayout({ snapshot }: { snapshot: RamsRenderSnapshot }) {
  const { pack, version, briefings, acceptance } = snapshot;
  const { content, jobContext } = version.content;

  return (
    <main
      style={{
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        color: '#0f172a',
        padding: 28,
        maxWidth: 820,
        margin: '0 auto',
      }}
    >
      <header style={{ borderBottom: '3px solid #0f172a', paddingBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Risk Assessment &amp; Method Statement</h1>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{pack.referenceNumber ?? ''}</div>
        </div>
        <div style={{ fontSize: 14, marginTop: 4 }}>{jobContext.title}</div>
        <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
          Version {version.versionNumber} · issued {formatDate(version.issuedAt)}
          {version.issuedByName !== null ? ` by ${version.issuedByName}` : ''}
          {version.supersededAt !== null ? ' · SUPERSEDED' : ''}
        </div>
        {pack.status === 'withdrawn' ? (
          <div
            style={{
              marginTop: 8,
              padding: 8,
              border: '2px solid #b91c1c',
              color: '#b91c1c',
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            WITHDRAWN — this pack must not be worked to.
            {pack.withdrawnReason.length > 0 ? ` Reason: ${pack.withdrawnReason}` : ''}
          </div>
        ) : null}
      </header>

      <section style={SECTION}>
        <h2 style={H2}>1 · Job details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Field label="Client" value={jobContext.clientName} />
          <Field label="Site" value={jobContext.siteName ?? ''} />
          <Field label="Location" value={jobContext.locationText} />
          <Field label="Planned from" value={formatDate(jobContext.plannedFrom)} />
          <Field label="Planned to" value={formatDate(jobContext.plannedTo)} />
          <Field label="Supervisor" value={jobContext.supervisorName} />
          <Field label="Prepared by" value={jobContext.authorName} />
          <Field
            label="Method statement"
            value={
              version.content.methodStatementTitle.length > 0
                ? `${version.content.methodStatementTitle}${
                    version.content.methodStatementVersionNumber !== null
                      ? ` (v${version.content.methodStatementVersionNumber})`
                      : ''
                  }`
                : ''
            }
          />
        </div>
        {content.scopeOfWorks.trim().length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <Block title="Scope of works" body={content.scopeOfWorks} />
          </div>
        ) : null}
      </section>

      <section style={SECTION}>
        <h2 style={H2}>2 · Risk assessments referenced</h2>
        {version.content.riskAssessments.length === 0 ? (
          <p style={{ fontSize: 11, color: '#64748b' }}>None bound.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ textAlign: 'left', padding: 5 }}>Reference</th>
                <th style={{ textAlign: 'left', padding: 5 }}>Title</th>
                <th style={{ textAlign: 'left', padding: 5 }}>Version</th>
                <th style={{ textAlign: 'left', padding: 5 }}>Hazards</th>
                <th style={{ textAlign: 'left', padding: 5 }}>Highest residual</th>
              </tr>
            </thead>
            <tbody>
              {version.content.riskAssessments.map((ra) => (
                <tr key={ra.raVersionId} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 5 }}>{ra.referenceNumber ?? '—'}</td>
                  <td style={{ padding: 5 }}>{ra.title}</td>
                  <td style={{ padding: 5 }}>v{ra.versionNumber}</td>
                  <td style={{ padding: 5 }}>{ra.hazardCount}</td>
                  <td style={{ padding: 5, textTransform: 'capitalize' }}>{ra.worstResidualBand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {version.content.coshh.length > 0 ? (
        <section style={SECTION}>
          <h2 style={H2}>3 · Hazardous substances (COSHH)</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ textAlign: 'left', padding: 5 }}>Substance</th>
                <th style={{ textAlign: 'left', padding: 5 }}>Task</th>
                <th style={{ textAlign: 'left', padding: 5 }}>SDS ref</th>
              </tr>
            </thead>
            <tbody>
              {version.content.coshh.map((c) => (
                <tr key={c.assessmentId} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 5 }}>{c.substanceName}</td>
                  <td style={{ padding: 5 }}>{c.taskDescription}</td>
                  <td style={{ padding: 5 }}>{c.sdsReference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section style={SECTION}>
        <h2 style={H2}>4 · Method statement — sequence of works</h2>
        {content.steps.map((step) => (
          <div
            key={step.id}
            style={{
              borderTop: '1px solid #cbd5e1',
              padding: '8px 0',
              breakInside: 'avoid',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              {step.sequence}. {step.title}
            </div>
            {step.description.trim().length > 0 ? (
              <div style={{ fontSize: 11, whiteSpace: 'pre-wrap', marginTop: 3, color: '#334155' }}>
                {step.description}
              </div>
            ) : null}

            {step.holdPoint !== null ? (
              <div
                style={{
                  marginTop: 6,
                  padding: 6,
                  border: '2px solid #b45309',
                  background: '#fffbeb',
                  fontSize: 11,
                }}
              >
                <strong>HOLD POINT — work stops here.</strong> {step.holdPoint.description}
                {step.holdPoint.responsibleRole.length > 0
                  ? ` (${step.holdPoint.responsibleRole})`
                  : ''}
              </div>
            ) : null}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6,
                marginTop: 6,
                fontSize: 10,
                color: '#475569',
              }}
            >
              {step.ppe.length > 0 || step.ppeOther.length > 0 ? (
                <div>
                  <strong>PPE:</strong>{' '}
                  {[...step.ppe.map((p) => p.replace(/_/g, ' ')), step.ppeOther]
                    .filter((v) => v.length > 0)
                    .join(', ')}
                </div>
              ) : null}
              {step.personnel.length > 0 ? (
                <div>
                  <strong>Personnel:</strong>{' '}
                  {step.personnel
                    .map(
                      (p) =>
                        `${p.count} × ${p.role === 'other' ? p.roleOther : p.role.replace(/_/g, ' ')}`,
                    )
                    .join(', ')}
                </div>
              ) : null}
              {step.plant.length > 0 ? (
                <div>
                  <strong>Plant:</strong> {step.plant.map((p) => p.name).join(', ')}
                </div>
              ) : null}
              {step.hazardRefs.length > 0 ? (
                <div>
                  <strong>Hazards addressed:</strong>{' '}
                  {step.hazardRefs
                    .map((h) => (h.hazardLabel.length > 0 ? h.hazardLabel : `#${h.hazardIndex + 1}`))
                    .join(', ')}
                </div>
              ) : null}
              {step.controlNotes.trim().length > 0 ? (
                <div style={{ gridColumn: '1 / -1' }}>
                  <strong>Controls:</strong> {step.controlNotes}
                </div>
              ) : null}
              {step.environmentalNotes.trim().length > 0 ? (
                <div style={{ gridColumn: '1 / -1' }}>
                  <strong>Environmental:</strong> {step.environmentalNotes}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <section style={SECTION}>
        <h2 style={H2}>5 · Emergency arrangements</h2>
        <Block title="First aid" body={content.emergency.firstAid} />
        <Block title="Emergency procedure" body={content.emergency.emergencyProcedure} />
        <Block title="Rescue plan" body={content.emergency.rescuePlan} />
        <Block title="Nearest hospital" body={content.emergency.nearestHospital} />
        {content.emergency.emergencyContacts.length > 0 ? (
          <div style={{ fontSize: 11 }}>
            <strong>Emergency contacts:</strong>{' '}
            {content.emergency.emergencyContacts
              .map((c) => `${c.name}${c.role.length > 0 ? ` (${c.role})` : ''} ${c.phone}`.trim())
              .join(' · ')}
          </div>
        ) : null}
      </section>

      <section style={SECTION}>
        <h2 style={H2}>6 · Welfare, access and environment</h2>
        <Block title="Welfare" body={content.logistics.welfare} />
        <Block title="Access and egress" body={content.logistics.accessEgress} />
        <Block title="Environmental and waste" body={content.logistics.environmental} />
        <Block title="Permits required" body={content.logistics.permitsRequired} />
        <Block title="Competence" body={content.logistics.competence} />
      </section>

      {version.content.documents.length > 0 ? (
        <section style={SECTION}>
          <h2 style={H2}>7 · Supporting documents</h2>
          <ul style={{ fontSize: 11, margin: 0, paddingLeft: 18 }}>
            {version.content.documents.map((d) => (
              <li key={d.id}>
                {d.title.length > 0 ? d.title : d.filename}{' '}
                <span style={{ color: '#64748b' }}>({d.kind.replace(/_/g, ' ')})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section style={SECTION}>
        <h2 style={H2}>8 · Author declaration</h2>
        <p style={{ fontSize: 11, color: '#334155', whiteSpace: 'pre-wrap' }}>
          {version.attestationText}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
          <Field label="Signed" value={version.issuedByName ?? ''} />
          <Field label="Date" value={formatDate(version.issuedAt)} />
        </div>
      </section>

      <section style={SECTION}>
        <h2 style={H2}>9 · Briefing register — version {version.versionNumber}</h2>
        {briefings.length === 0 ? (
          <p style={{ fontSize: 11, color: '#64748b' }}>
            Nobody has been briefed on this version yet.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ textAlign: 'left', padding: 5 }}>Name</th>
                <th style={{ textAlign: 'left', padding: 5 }}>Organisation</th>
                <th style={{ textAlign: 'left', padding: 5 }}>Briefed by</th>
                <th style={{ textAlign: 'left', padding: 5 }}>When</th>
                <th style={{ textAlign: 'left', padding: 5 }}>Signed</th>
              </tr>
            </thead>
            <tbody>
              {briefings.map((b, i) => (
                <tr key={`${b.name}-${i}`} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 5 }}>{b.name}</td>
                  <td style={{ padding: 5 }}>{b.organisation}</td>
                  <td style={{ padding: 5 }}>{b.briefedByName}</td>
                  <td style={{ padding: 5 }}>{formatDate(b.briefedAt)}</td>
                  <td style={{ padding: 5 }}>{b.hasSignature ? 'Yes' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {acceptance !== null ? (
        <section style={SECTION}>
          <h2 style={H2}>10 · Client acceptance</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field
              label="Decision"
              value={acceptance.decision === 'accepted' ? 'Accepted' : 'Changes requested'}
            />
            <Field label="By" value={acceptance.acceptedByName} />
            <Field label="Organisation" value={acceptance.acceptedByOrganisation} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Field label="When" value={formatDate(acceptance.decidedAt)} />
          </div>
          {acceptance.comment.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <Block title="Comment" body={acceptance.comment} />
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
