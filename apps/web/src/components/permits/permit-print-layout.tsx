/**
 * Print layout for the Puppeteer-facing `/render/permit/*` route
 * (rendered inside `app/render/layout.tsx`'s bare html/body). One
 * A4 permit record: header, validity + parties, precondition checklist,
 * gas tests against their limits, evidence, the gang and entry/exit log,
 * closure, and the full timeline. English-only like the other print
 * layouts: the rendered artefact is a portable document, not a
 * localised screen (HSE review PW-6).
 */
import type { PermitRenderSnapshot } from '@forma360/render';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  issued: 'Issued — awaiting acceptance',
  active: 'Active',
  suspended: 'Suspended',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const UNIT_LABELS: Record<string, string> = {
  percent_lel: '% LEL',
  percent_o2: '% O₂',
  ppm: 'ppm',
  mg_m3: 'mg/m³',
};

const EVENT_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Details updated',
  precondition_checked: 'Precondition confirmed',
  precondition_unchecked: 'Precondition unconfirmed',
  gas_reading_recorded: 'Gas reading recorded',
  attachment_added: 'Attachment added',
  authorised: 'Authorised',
  issued: 'Issued',
  accepted: 'Accepted',
  suspended: 'Suspended',
  resumed: 'Resumed',
  extended: 'Extended',
  handed_over: 'Handed over',
  cancelled: 'Cancelled',
  closed: 'Closed',
  expiry_escalated: 'Expiry escalated',
  expiry_warning: 'Expiry warning sent',
  worker_added: 'Worker added',
  worker_removed: 'Worker removed',
  entry_logged: 'Entered',
  exit_logged: 'Exited',
};

const CLOSURE_LABELS: Record<string, string> = {
  workComplete: 'Work complete or stopped safely',
  areaMadeSafe: 'Area inspected and made safe',
  isolationsRemoved: 'Isolations removed / reinstated as agreed',
  personnelClear: 'All personnel accounted for and clear',
};

function dt(iso: string | null): string {
  if (iso === null) return '—';
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function limitRange(min: number | null, max: number | null, unit: string): string {
  const u = UNIT_LABELS[unit] ?? unit;
  if (min !== null && max !== null) return `${String(min)}–${String(max)} ${u}`;
  if (max !== null) return `≤ ${String(max)} ${u}`;
  if (min !== null) return `≥ ${String(min)} ${u}`;
  return u;
}

export function PermitPrintLayout({ snapshot }: { snapshot: PermitRenderSnapshot }) {
  const { permit, parties } = snapshot;
  const signature = (label: string, name: string | null, at: string | null): React.JSX.Element => (
    <td>
      <strong>{label}</strong>
      <br />
      {name ?? '—'}
      <br />
      {dt(at)}
    </td>
  );

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @page { size: A4; margin: 1cm; }
            .pw-print { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 10pt; line-height: 1.35; }
            .pw-print table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
            .pw-print th, .pw-print td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; text-align: left; }
            .pw-print th { background: #f0f0f0; }
            .pw-print p { margin: 0 0 6px; }
            .pw-print h2 { font-size: 11pt; margin: 10px 0 4px; }
            .pw-print .pw-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 4px; }
            .pw-print .pw-title { font-size: 14pt; font-weight: 700; }
            .pw-print .pw-ref { font-family: monospace; font-size: 12pt; }
            .pw-print .pw-danger { color: #b00000; font-weight: 700; }
          `,
        }}
      />
      <div className="pw-print">
        <div className="pw-head">
          <span className="pw-title">PERMIT TO WORK — {permit.typeName}</span>
          <span className="pw-ref">{permit.referenceNumber ?? ''}</span>
        </div>
        <p>
          <strong>{permit.title}</strong>
          {' · '}
          {STATUS_LABELS[permit.status] ?? permit.status}
          {permit.siteName !== null ? ` · ${permit.siteName}` : ''}
          {permit.locationText.length > 0 ? ` · ${permit.locationText}` : ''}
        </p>
        <p>
          Valid {dt(permit.validFrom)} → {dt(permit.validTo)}
          {permit.extensionCount > 0
            ? ` (${String(permit.extensionCount)} extension${permit.extensionCount === 1 ? '' : 's'})`
            : ''}
        </p>
        {permit.workDescription.length > 0 ? <p>{permit.workDescription}</p> : null}
        {permit.riskAssessmentRef !== null ? (
          <p>Risk assessment: {permit.riskAssessmentRef}</p>
        ) : null}

        <h2>Signatures</h2>
        <table>
          <tbody>
            <tr>
              {signature('Authorising engineer', parties.authoriserName, parties.authorisedAt)}
              {signature('Issuer', parties.issuerName, parties.issuedAt)}
              {signature('Acceptor', parties.acceptorName, parties.acceptedAt)}
            </tr>
          </tbody>
        </table>

        <h2>Preconditions</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: '6%' }}>OK</th>
              <th>Precondition</th>
              <th style={{ width: '30%' }}>Confirmed by</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.preconditions.map((p) => (
              <tr key={p.id}>
                <td>{p.checked ? '☑' : '☐'}</td>
                <td>
                  {p.label}
                  {p.note.length > 0 ? <em> — {p.note}</em> : null}
                </td>
                <td>
                  {p.checkedByName ?? '—'}
                  {p.checkedAt !== null ? ` · ${dt(p.checkedAt)}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {snapshot.gasReadings.length > 0 || snapshot.gasLimits.length > 0 ? (
          <>
            <h2>Gas testing</h2>
            <table>
              <thead>
                <tr>
                  <th>Substance</th>
                  <th>Reading</th>
                  <th>Acceptable range</th>
                  <th>Verdict</th>
                  <th>By / at</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.gasReadings.map((g) => {
                  const limit = snapshot.gasLimits.find((l) => l.id === g.limitId);
                  return (
                    <tr key={g.id}>
                      <td>{g.substance}</td>
                      <td>
                        {g.reading} {UNIT_LABELS[g.unit] ?? g.unit}
                      </td>
                      <td>
                        {limit !== undefined ? limitRange(limit.min, limit.max, limit.unit) : '—'}
                      </td>
                      <td>
                        {g.withinLimits === true ? (
                          'Within limits'
                        ) : g.withinLimits === false ? (
                          <span className="pw-danger">OUT OF LIMITS</span>
                        ) : (
                          'Not evaluated'
                        )}
                      </td>
                      <td>
                        {g.takenByName} · {dt(g.takenAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : null}

        {(permit.isolationCertificateRef.length > 0 ||
          permit.rescuePlan.length > 0 ||
          snapshot.attachments.length > 0) && (
          <>
            <h2>Evidence</h2>
            {permit.isolationCertificateRef.length > 0 ? (
              <p>Isolation certificate: {permit.isolationCertificateRef}</p>
            ) : null}
            {permit.rescuePlan.length > 0 ? <p>Rescue plan: {permit.rescuePlan}</p> : null}
            {snapshot.attachments.length > 0 ? (
              <p>
                Attachments:{' '}
                {snapshot.attachments.map((a) => `${a.filename} (${a.kind})`).join('; ')}
              </p>
            ) : null}
          </>
        )}

        {snapshot.workers.length > 0 ? (
          <>
            <h2>People under this permit</h2>
            <p>{snapshot.workers.map((w) => `${w.name} (${w.role})`).join('; ')}</p>
          </>
        ) : null}

        {snapshot.entryLog.length > 0 ? (
          <>
            <h2>Entry / exit log</h2>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Entered</th>
                  <th>Exited</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.entryLog.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{dt(row.enteredAt)}</td>
                    <td>
                      {row.exitedAt !== null ? (
                        dt(row.exitedAt)
                      ) : (
                        <span className="pw-danger">STILL IN</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {permit.status === 'closed' && permit.closureChecks !== null ? (
          <>
            <h2>Close-out</h2>
            {Object.entries(permit.closureChecks).map(([key, value]) => (
              <p key={key}>
                {value ? '☑' : '☐'} {CLOSURE_LABELS[key] ?? key}
              </p>
            ))}
            {permit.closureNotes.length > 0 ? <p>{permit.closureNotes}</p> : null}
            <p>
              Closed by {parties.closedByName ?? '—'} on {dt(parties.closedAt)}
            </p>
          </>
        ) : null}
        {permit.status === 'cancelled' ? (
          <p>
            Cancelled by {parties.cancelledByName ?? '—'} on {dt(parties.cancelledAt)}
            {permit.cancellationReason.length > 0 ? ` — ${permit.cancellationReason}` : ''}
          </p>
        ) : null}

        <h2>Timeline</h2>
        <table>
          <tbody>
            {snapshot.events.map((e) => (
              <tr key={e.id}>
                <td style={{ width: '22%' }}>{dt(e.createdAt)}</td>
                <td style={{ width: '24%' }}>{EVENT_LABELS[e.kind] ?? e.kind}</td>
                <td style={{ width: '20%' }}>{e.actorName ?? 'System'}</td>
                <td>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
