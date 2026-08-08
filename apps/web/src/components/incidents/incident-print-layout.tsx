/**
 * Print layout for the Puppeteer-facing `/render/incident/*` route
 * (rendered inside `app/render/layout.tsx`'s bare html/body). One A4
 * incident report: header, the record, affected people + lost time, the
 * RIDDOR determination and submission, every investigation revision
 * with its separated-duty signatures, findings → actions, evidence,
 * witness statements, the effectiveness verdict and the full timeline.
 * English-only like the other print layouts: the rendered artefact is a
 * portable document (insurer pack / audit sample), not a localised
 * screen.
 */
import type { IncidentRenderSnapshot } from '@forma360/render';

const KIND_LABELS: Record<string, string> = {
  injury: 'Injury',
  ill_health: 'Ill health',
  dangerous_occurrence: 'Dangerous occurrence',
  sharps_exposure: 'Sharps / splash exposure',
  violence_aggression: 'Violence & aggression',
  damage: 'Damage',
  environmental: 'Environmental',
  near_miss: 'Near miss',
};

const SEVERITY_LABELS: Record<string, string> = {
  negligible: 'Negligible',
  minor: 'Minor',
  moderate: 'Moderate',
  serious: 'Serious',
  major: 'Major',
};

const STATUS_LABELS: Record<string, string> = {
  reported: 'Reported',
  triaged: 'Triaged',
  investigating: 'Under investigation',
  actions_outstanding: 'Actions outstanding',
  closed: 'Closed',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
};

const RIDDOR_LABELS: Record<string, string> = {
  not_reportable: 'Not reportable',
  death: 'Death',
  specified_injury: 'Specified injury',
  non_worker_hospital: 'Non-worker taken to hospital',
  over_7_day: 'Over-7-day injury',
  occupational_disease: 'Occupational disease',
  dangerous_occurrence: 'Dangerous occurrence',
  gas_incident: 'Gas incident',
};

const CATEGORY_LABELS: Record<string, string> = {
  equipment_guarding: 'Equipment / guarding',
  procedure: 'Procedure absent or inadequate',
  training_competence: 'Training / competence',
  supervision: 'Supervision',
  human_factors: 'Human factors',
  environment: 'Environment',
  maintenance: 'Maintenance',
  management_system: 'Management system',
};

const PERSON_CATEGORY_LABELS: Record<string, string> = {
  employee: 'Employee',
  contractor: 'Contractor',
  agency: 'Agency',
  visitor: 'Visitor',
  member_of_public: 'Member of the public',
  work_experience: 'Work experience',
};

const EVENT_LABELS: Record<string, string> = {
  reported: 'Reported',
  updated: 'Details updated',
  triaged: 'Triaged',
  severity_changed: 'Severity changed',
  investigator_assigned: 'Lead investigator appointed',
  riddor_screened: 'RIDDOR screened',
  riddor_rescreen_flagged: 'RIDDOR re-screen flagged (absence crossed 7 days)',
  riddor_submitted: 'RIDDOR report submitted',
  person_added: 'Affected person added',
  person_updated: 'Affected person updated',
  person_removed: 'Affected person removed',
  absence_added: 'Absence recorded',
  absence_updated: 'Absence updated',
  absence_removed: 'Absence removed',
  evidence_added: 'Evidence added',
  witness_statement_added: 'Witness statement taken',
  investigation_started: 'Investigation started',
  investigation_submitted: 'Investigation submitted',
  investigation_rejected: 'Investigation returned for rework',
  investigation_approved: 'Investigation approved',
  actions_generated: 'Corrective actions generated',
  reviews_prompted: 'Risk-assessment reviews prompted',
  reviews_prompt_skipped: 'Review prompt skipped',
  closed: 'Closed',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
  effectiveness_recorded: 'Effectiveness verdict recorded',
  alert_sent: 'Immediate alert sent',
  riddor_warning_sent: 'RIDDOR deadline warning sent',
  riddor_escalated: 'RIDDOR deadline escalated',
  promoted_from_observation: 'Escalated from observation',
};

const DETAIL_FIELD_LABELS: Record<string, string> = {
  device: 'Device',
  procedure: 'Procedure',
  sourceKnown: 'Source known',
  sourceRiskAssessed: 'Source-exposure risk assessed',
  sourceRiskNote: 'Source risk note',
  contaminationStatus: 'Contamination status',
  ohFollowUpRequired: 'OH follow-up required',
  washedConfirmed: 'Washed / first-aid step confirmed',
  nature: 'Nature',
  perpetratorType: 'Perpetrator',
  weaponInvolved: 'Weapon involved',
  policeNotified: 'Police notified',
  crimeReference: 'Crime reference',
  supportOffered: 'Support offered',
  supportNote: 'Support note',
  category: 'Category',
  otherText: 'Description',
  whatDamaged: 'What was damaged',
  whatReleased: 'What was released',
  estimatedCostBand: 'Estimated cost band',
  mitigation: 'Immediate mitigation',
  containment: 'Containment',
};

function dt(iso: string | null): string {
  if (iso === null) return '—';
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function words(value: string): string {
  return value.replaceAll('_', ' ');
}

function detailValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return words(value);
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

export function IncidentPrintLayout({ snapshot }: { snapshot: IncidentRenderSnapshot }) {
  const { incident } = snapshot;
  const detailEntries = Object.entries(incident.details).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @page { size: A4; margin: 1cm; }
            .in-print { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 10pt; line-height: 1.35; }
            .in-print table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
            .in-print th, .in-print td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; text-align: left; }
            .in-print th { background: #f0f0f0; }
            .in-print p { margin: 0 0 6px; }
            .in-print h2 { font-size: 11pt; margin: 10px 0 4px; }
            .in-print h3 { font-size: 10pt; margin: 8px 0 3px; }
            .in-print .in-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 4px; }
            .in-print .in-title { font-size: 14pt; font-weight: 700; }
            .in-print .in-ref { font-family: monospace; font-size: 12pt; }
            .in-print .in-danger { color: #b00000; font-weight: 700; }
            .in-print .in-quote { border-left: 3px solid #999; padding-left: 8px; margin: 0 0 8px; white-space: pre-wrap; }
          `,
        }}
      />
      <div className="in-print">
        <div className="in-head">
          <span className="in-title">
            INCIDENT REPORT — {KIND_LABELS[incident.kind] ?? incident.kind}
          </span>
          <span className="in-ref">{incident.referenceNumber}</span>
        </div>
        <p>
          <strong>{incident.title}</strong>
          {' · '}
          {STATUS_LABELS[incident.status] ?? incident.status}
          {' · Severity: '}
          {SEVERITY_LABELS[incident.severity] ?? incident.severity}
          {incident.potentialSeverity !== null
            ? ` (potential: ${SEVERITY_LABELS[incident.potentialSeverity] ?? incident.potentialSeverity})`
            : ''}
          {incident.confidential ? ' · CONFIDENTIAL' : ''}
        </p>
        <p>
          Occurred {dt(incident.occurredAt)} · Reported {dt(incident.reportedAt)} by{' '}
          {incident.reportedByName ?? '—'}
          {incident.siteName !== null ? ` · ${incident.siteName}` : ''}
          {incident.locationText.length > 0 ? ` · ${incident.locationText}` : ''}
        </p>
        {incident.description.length > 0 ? (
          <p className="in-quote">{incident.description}</p>
        ) : null}
        {detailEntries.length > 0 ? (
          <table>
            <tbody>
              {detailEntries.map(([key, value]) => (
                <tr key={key}>
                  <th style={{ width: '35%' }}>{DETAIL_FIELD_LABELS[key] ?? words(key)}</th>
                  <td>{detailValue(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <h2>People affected &amp; lost time</h2>
        {snapshot.persons.length === 0 ? (
          <p>No persons recorded (no-injury event).</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Injury</th>
                <th>First aid / hospitalisation</th>
                <th>Days lost</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.persons.map((person, i) => {
                const injury = person.injury;
                const bodyParts = Array.isArray(injury.bodyParts)
                  ? (injury.bodyParts as string[]).map(words).join(', ')
                  : '';
                const kinds = Array.isArray(injury.injuryKinds)
                  ? (injury.injuryKinds as string[]).map(words).join(', ')
                  : '';
                const firstAid = injury.firstAidGiven === true ? 'First aid given' : '';
                const hosp =
                  injury.hospitalisation === 'ae'
                    ? 'A&E'
                    : injury.hospitalisation === 'admitted'
                      ? 'Admitted'
                      : '';
                return (
                  <tr key={i}>
                    <td>{person.name}</td>
                    <td>{PERSON_CATEGORY_LABELS[person.category] ?? words(person.category)}</td>
                    <td>{[kinds, bodyParts].filter((s) => s.length > 0).join(' — ') || '—'}</td>
                    <td>
                      {[firstAid, hosp, person.ohFollowUpRequired ? 'OH follow-up' : '']
                        .filter((s) => s.length > 0)
                        .join(' · ') || '—'}
                    </td>
                    <td>
                      {String(person.daysLost)}
                      {person.onRestrictedDuties ? ' · restricted duties' : ''}
                      {person.returnedToWork ? ' · returned' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {snapshot.totalDaysLost > 0 ? (
          <p>
            <strong>Total days lost:</strong> {String(snapshot.totalDaysLost)} (RIDDOR counting
            rule: day of the accident excluded, weekends counted)
          </p>
        ) : null}

        <h2>RIDDOR determination</h2>
        {incident.riddorCategory === null ? (
          <p>Not yet screened.</p>
        ) : (
          <table>
            <tbody>
              <tr>
                <th style={{ width: '35%' }}>Determination</th>
                <td>
                  {incident.riddorCategory === 'not_reportable' ? (
                    (RIDDOR_LABELS[incident.riddorCategory] ?? incident.riddorCategory)
                  ) : (
                    <span className="in-danger">
                      Reportable —{' '}
                      {RIDDOR_LABELS[incident.riddorCategory] ?? incident.riddorCategory}
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <th>Screened</th>
                <td>
                  {dt(incident.riddorScreenedAt)} by {incident.riddorScreenedByName ?? '—'}
                </td>
              </tr>
              <tr>
                <th>Reasoning</th>
                <td>{incident.riddorDeterminationNote || '—'}</td>
              </tr>
              {incident.riddorDeadlineAt !== null ? (
                <tr>
                  <th>Statutory deadline</th>
                  <td>{dt(incident.riddorDeadlineAt)}</td>
                </tr>
              ) : null}
              {incident.riddorSubmittedAt !== null ? (
                <tr>
                  <th>Submitted</th>
                  <td>
                    {dt(incident.riddorSubmittedAt)} by {incident.riddorSubmittedByName ?? '—'} via{' '}
                    {incident.riddorSubmissionRoute === 'phone' ? 'phone' : 'HSE online form'}
                    {incident.riddorHseReference !== null
                      ? ` · HSE ref ${incident.riddorHseReference}`
                      : ''}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}

        {snapshot.investigations.map((inv) => (
          <div key={inv.revision}>
            <h2>
              Investigation — revision {String(inv.revision)} (
              {inv.status === 'approved'
                ? `approved ${dt(inv.approvedAt)}`
                : inv.status === 'submitted'
                  ? 'awaiting approval'
                  : 'draft'}
              )
            </h2>
            <table>
              <tbody>
                <tr>
                  <th style={{ width: '35%' }}>Immediate cause</th>
                  <td>{inv.immediateCause || '—'}</td>
                </tr>
                <tr>
                  <th>Underlying cause</th>
                  <td>{inv.underlyingCause || '—'}</td>
                </tr>
                {inv.contributingFactors.length > 0 ? (
                  <tr>
                    <th>Contributing factors</th>
                    <td>
                      {inv.contributingFactors
                        .map((c) => CATEGORY_LABELS[c] ?? words(c))
                        .join(', ')}
                    </td>
                  </tr>
                ) : null}
                {inv.method !== null ? (
                  <tr>
                    <th>RCA method</th>
                    <td>
                      {inv.method === 'five_whys'
                        ? 'Five whys'
                        : inv.method === 'causal_factors'
                          ? 'Causal factors (HSG245)'
                          : 'Other'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {inv.whyChain !== null && inv.whyChain.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.whyChain.map((entry, i) => (
                    <tr key={i}>
                      <td>{String(i + 1)}</td>
                      <td>
                        {entry.text}
                        {entry.isRootCause ? <strong> — ROOT CAUSE</strong> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {inv.causalFactors !== null && inv.causalFactors.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Causal factor</th>
                    <th>Narrative</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.causalFactors.map((factor, i) => (
                    <tr key={i}>
                      <td>{CATEGORY_LABELS[factor.category] ?? words(factor.category)}</td>
                      <td>{factor.narrative}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {inv.timelineEntries.length > 0 ? (
              <>
                <h3>Sequence of events</h3>
                <table>
                  <tbody>
                    {inv.timelineEntries.map((entry, i) => (
                      <tr key={i}>
                        <th style={{ width: '25%' }}>{entry.at}</th>
                        <td>{entry.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
            {inv.conclusionSummary.length > 0 ? (
              <>
                <h3>Conclusion</h3>
                <p className="in-quote">{inv.conclusionSummary}</p>
                {inv.rootCauseStatement.length > 0 ? (
                  <p>
                    <strong>Root cause:</strong> {inv.rootCauseStatement}
                  </p>
                ) : null}
                {inv.recurrenceLikelihood !== null ? (
                  <p>
                    <strong>Recurrence likelihood:</strong> {inv.recurrenceLikelihood}
                  </p>
                ) : null}
                {inv.lessonsLearned.length > 0 ? (
                  <p>
                    <strong>Lessons learned:</strong> {inv.lessonsLearned}
                  </p>
                ) : null}
              </>
            ) : null}
            <table>
              <tbody>
                <tr>
                  <td>
                    <strong>Submitted by (lead investigator)</strong>
                    <br />
                    {inv.submittedByName ?? '—'}
                    <br />
                    {dt(inv.submittedAt)}
                  </td>
                  <td>
                    <strong>Approved by (separated duty)</strong>
                    <br />
                    {inv.approvedByName ?? '—'}
                    <br />
                    {dt(inv.approvedAt)}
                  </td>
                </tr>
              </tbody>
            </table>
            {(() => {
              // IN-A8: a sole-manager override is part of the signature
              // record — the auditor sees who signed alone and why.
              const approval = snapshot.events.find(
                (event) =>
                  event.kind === 'investigation_approved' &&
                  event.detail.revision === inv.revision &&
                  event.detail.soleManagerOverride === true,
              );
              if (approval === undefined) return null;
              const justification =
                typeof approval.detail.justification === 'string'
                  ? approval.detail.justification
                  : '';
              return (
                <p>
                  <strong>Sole-manager override:</strong> approved by the lead investigator — no
                  independent approver held the incidents-manage permission in this organisation at
                  the time.
                  {justification !== '' ? ` Justification: ${justification}` : ''}
                </p>
              );
            })()}
          </div>
        ))}

        {snapshot.findings.length > 0 ? (
          <>
            <h2>Findings &amp; corrective actions</h2>
            <table>
              <thead>
                <tr>
                  <th>Finding</th>
                  <th>Category</th>
                  <th>Priority</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.findings.map((finding, i) => (
                  <tr key={i}>
                    <td>{finding.description}</td>
                    <td>{CATEGORY_LABELS[finding.category] ?? words(finding.category)}</td>
                    <td>{finding.priority}</td>
                    <td>
                      {finding.actionReference !== null
                        ? `${finding.actionReference} (${words(finding.actionStatus ?? '')})`
                        : finding.requiresAction
                          ? 'Pending'
                          : 'No action required'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {snapshot.evidence.length > 0 ? (
          <>
            <h2>Evidence</h2>
            <table>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>File / reference</th>
                  <th>Collected</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.evidence.map((item, i) => (
                  <tr key={i}>
                    <td>{words(item.kind)}</td>
                    <td>
                      {item.filename ?? '—'}
                      {item.caption.length > 0 ? ` — ${item.caption}` : ''}
                    </td>
                    <td>
                      {dt(item.collectedAt)} by {item.collectedByName ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {snapshot.witnesses.length > 0 ? (
          <>
            <h2>Witness statements</h2>
            {snapshot.witnesses.map((witness, i) => (
              <div key={i}>
                <p>
                  <strong>{witness.witnessName}</strong> — taken {dt(witness.takenAt)} by{' '}
                  {witness.takenByName ?? '—'}
                  {witness.signed ? ' · signed' : ''}
                </p>
                <p className="in-quote">{witness.statement}</p>
              </div>
            ))}
          </>
        ) : null}

        {incident.effectivenessDueAt !== null ? (
          <>
            <h2>Effectiveness review</h2>
            <table>
              <tbody>
                <tr>
                  <th style={{ width: '35%' }}>Due</th>
                  <td>{dt(incident.effectivenessDueAt)}</td>
                </tr>
                <tr>
                  <th>Verdict</th>
                  <td>
                    {incident.effectivenessVerdict !== null
                      ? words(incident.effectivenessVerdict)
                      : 'Pending'}
                    {incident.effectivenessNote.length > 0
                      ? ` — ${incident.effectivenessNote}`
                      : ''}
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        ) : null}

        <h2>Timeline</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: '22%' }}>When</th>
              <th>Event</th>
              <th style={{ width: '22%' }}>By</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.events.map((event) => (
              <tr key={event.id}>
                <td>{dt(event.createdAt)}</td>
                <td>{EVENT_LABELS[event.kind] ?? words(event.kind)}</td>
                <td>{event.actorName ?? 'System'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Rendered {dt(new Date().toISOString())} · {incident.referenceNumber}
          {incident.closedAt !== null
            ? ` · Closed ${dt(incident.closedAt)}${
                incident.closedByName !== null ? ` by ${incident.closedByName}` : ''
              }`
            : ''}
        </p>
      </div>
    </>
  );
}
