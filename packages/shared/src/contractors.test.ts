/**
 * Contractors domain logic — the gate rule and the visit state machine.
 *
 * Edge cases (audit IDs in brackets):
 *   - CT-D01: an override replaces the derived evidence, and the union
 *     genuinely admits 'suspended' — the old code cast it away
 *   - CT-G08: suspension bars entry, and cannot be waived at the desk
 *   - CT-G05: check-in is not repeatable (a rescan reset the overstay clock)
 *   - CT-L03: check-out is not repeatable (a second tap overwrote departure)
 *   - CT-L02: a visit with someone on site cannot be deleted or cancelled
 *   - CT-L01: the required gate questions are one rule for both paths
 */
import { describe, expect, it } from 'vitest';
import {
  complianceBarsEntry,
  complianceOverridable,
  effectiveComplianceStatus,
  firstMissingGateField,
  isCalendarDate,
  todayIso,
  validateDocumentPeriod,
  visitIsOnSite,
  visitTransitionError,
  type EffectiveComplianceStatus,
  type VisitStatus,
} from './contractors';

describe('contractor compliance gate', () => {
  it('CT-D01: an override replaces the derived evidence', () => {
    expect(effectiveComplianceStatus({ override: null, derived: 'compliant' })).toBe('compliant');
    expect(effectiveComplianceStatus({ override: null, derived: 'non_compliant' })).toBe(
      'non_compliant',
    );
    // The dangerous case the audit found: suspending a contractor whose
    // paperwork has ALSO lapsed used to convert a refusal into an
    // admission, because the override replaced the derived status and
    // only `non_compliant` was refused.
    expect(effectiveComplianceStatus({ override: 'suspended', derived: 'non_compliant' })).toBe(
      'suspended',
    );
    expect(effectiveComplianceStatus({ override: 'compliant', derived: 'non_compliant' })).toBe(
      'compliant',
    );
  });

  it('CT-G08: suspension bars entry, and so does missing paperwork', () => {
    expect(complianceBarsEntry('suspended')).toBe(true);
    expect(complianceBarsEntry('non_compliant')).toBe(true);
    expect(complianceBarsEntry('compliant')).toBe(false);
    // A contractor nobody has asked paperwork from is not thereby unsafe;
    // barring them would make the register unusable on day one.
    expect(complianceBarsEntry('no_requirements')).toBe(false);
  });

  it('CT-G08: a desk override may waive missing paperwork but never a suspension', () => {
    // Missing paperwork is a supervisor's judgement call, with a reason.
    expect(complianceOverridable('non_compliant')).toBe(true);
    // A suspension is an explicit decision that this contractor does not
    // come on site. A desk override that could undo it would make the
    // control decorative.
    expect(complianceOverridable('suspended')).toBe(false);
  });

  it('every status is either passable or barred — no third case', () => {
    const all: EffectiveComplianceStatus[] = [
      'compliant',
      'non_compliant',
      'no_requirements',
      'suspended',
    ];
    for (const s of all) expect(typeof complianceBarsEntry(s)).toBe('boolean');
  });
});

describe('visit lifecycle', () => {
  const err = (status: VisitStatus, transition: 'check_in' | 'check_out' | 'cancel' | 'delete') =>
    visitTransitionError({ status, transition });

  it('CT-G05: check-in is not repeatable', () => {
    expect(err('scheduled', 'check_in')).toBeNull();
    // A second kiosk scan used to re-stamp checkedInAt — and the overstay
    // worker measures from that stamp, so a contractor could clear their
    // own overstay alert by scanning again.
    expect(err('checked_in', 'check_in')).toBe('visit-already-checked-in');
    // Re-entry after a genuine check-out is legitimate.
    expect(err('checked_out', 'check_in')).toBeNull();
  });

  it('CT-L03: check-out is not repeatable, and needs a check-in first', () => {
    expect(err('checked_in', 'check_out')).toBeNull();
    // Guarding only "never checked in" let a second tap move checkedOutAt
    // forward and overwrite the real departure time.
    expect(err('checked_out', 'check_out')).toBe('visit-already-checked-out');
    expect(err('scheduled', 'check_out')).toBe('visit-not-checked-in');
    expect(err('no_show', 'check_out')).toBe('visit-not-checked-in');
  });

  it('CT-L02: a visit cannot be deleted or cancelled while someone is on site', () => {
    // The on-site board is what a fire marshal reads at the assembly
    // point. Archiving a checked-in visit erased a person who is
    // physically present, with no check-out and no record they left.
    expect(err('checked_in', 'delete')).toBe('visit-on-site');
    expect(err('checked_in', 'cancel')).toBe('visit-on-site');
    // Check them out first, then delete.
    expect(err('checked_out', 'delete')).toBeNull();
    expect(err('scheduled', 'delete')).toBeNull();
  });

  it('a cancelled visit accepts nothing but deletion', () => {
    expect(err('cancelled', 'check_in')).toBe('visit-cancelled');
    expect(err('cancelled', 'check_out')).toBe('visit-cancelled');
    // Tidying away a cancelled visit is fine — nobody is on site under it.
    expect(err('cancelled', 'delete')).toBeNull();
  });

  it('visitIsOnSite is the single definition of "present"', () => {
    expect(visitIsOnSite('checked_in')).toBe(true);
    for (const s of ['scheduled', 'checked_out', 'cancelled', 'no_show'] as VisitStatus[]) {
      expect(visitIsOnSite(s)).toBe(false);
    }
  });
});

describe('document period of cover', () => {
  const TODAY = '2026-08-07';
  const period = (over: Partial<Parameters<typeof validateDocumentPeriod>[0]>) =>
    validateDocumentPeriod({
      startDate: '',
      endDate: '',
      noExpiry: false,
      recurrenceMonths: null,
      today: TODAY,
      rejectExpired: true,
      ...over,
    });

  it('CT-U01: omitting the expiry no longer means "valid forever"', () => {
    // The contractor portal sent neither a date nor an assertion, so every
    // self-service upload satisfied its requirement permanently and was
    // filtered out of the chase list. It now fails closed.
    expect(period({})).toEqual({ ok: false, error: 'EXPIRY_REQUIRED' });
  });

  it('CT-U01: a null expiry is legitimate only as a deliberate assertion', () => {
    // A company registration or a lifetime qualification genuinely never
    // expires. Forcing a date there makes people invent 2099-12-31, which
    // is the same permanent pass with an audit trail that lies.
    expect(period({ noExpiry: true })).toEqual({ ok: true });
  });

  it('CT-U01: a requirement on a renewal cycle has no "never expires" escape', () => {
    // The company already declared this evidence must be renewed, so a
    // perpetual document cannot logically satisfy it.
    expect(period({ noExpiry: true, recurrenceMonths: 12 })).toEqual({
      ok: false,
      error: 'EXPIRY_REQUIRED',
    });
    expect(period({ endDate: '2027-01-01', recurrenceMonths: 12 })).toEqual({ ok: true });
  });

  it('CT-U01: a malformed date is refused rather than laundered into null', () => {
    // The old check was the regex alone: `2026-13-45` passed it, reached
    // the `date` column and turned a typo into a 500.
    expect(isCalendarDate('2026-13-45')).toBe(false);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(period({ endDate: '2026-13-45' })).toEqual({ ok: false, error: 'INVALID_END_DATE' });
    expect(period({ startDate: 'soon', endDate: '2027-01-01' })).toEqual({
      ok: false,
      error: 'INVALID_START_DATE',
    });
  });

  it('CT-U01: the period has to run forwards, and has to still be current', () => {
    expect(period({ startDate: '2026-08-01', endDate: '2026-07-01' })).toEqual({
      ok: false,
      error: 'INVALID_PERIOD',
    });
    // On the contractor's own portal, accepting an expired document hands
    // them a "done ✓" for work that still has to happen.
    expect(period({ endDate: '2026-08-06' })).toEqual({ ok: false, error: 'EXPIRY_IN_PAST' });
    expect(period({ endDate: TODAY })).toEqual({ ok: true });
    // At the staff desk it is allowed: recording the certificate that
    // lapsed last week, while the replacement is chased, is a legitimate
    // audit trail — and it satisfies nothing, which the UI already shows.
    expect(period({ endDate: '2026-08-06', rejectExpired: false })).toEqual({ ok: true });
  });

  it('todayIso is the UTC calendar day', () => {
    expect(todayIso(new Date('2026-08-07T23:30:00.000Z'))).toBe('2026-08-07');
  });
});

describe('gate capture fields', () => {
  const FIELDS = [
    { id: 'induction', label: 'Site induction completed?', required: true },
    { id: 'vehicle', label: 'Vehicle registration', required: false },
  ];

  it('CT-L01: a required question with no answer is refused', () => {
    expect(firstMissingGateField(FIELDS, {})?.id).toBe('induction');
    // Whitespace is not an answer.
    expect(firstMissingGateField(FIELDS, { induction: '  ' })?.id).toBe('induction');
    expect(firstMissingGateField(FIELDS, { induction: 'yes' })).toBeNull();
  });

  it('CT-L01: an optional question never blocks', () => {
    expect(firstMissingGateField(FIELDS, { induction: 'yes', vehicle: '' })).toBeNull();
  });

  it('CT-L01: no configured fields means nothing to answer', () => {
    expect(firstMissingGateField([], {})).toBeNull();
  });
});
