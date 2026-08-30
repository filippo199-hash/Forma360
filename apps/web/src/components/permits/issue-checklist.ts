/**
 * The permit issue-readiness checklist (review round 4).
 *
 * A practitioner drafted a permit and hit Issue; the gate refused and
 * the page offered a one-line error at the top of a very long page —
 * a dead-end with no explanation of what was done, what was missing,
 * or where to do it. This helper derives one row per applicable gate
 * requirement so the Signatures card can show the same steps treatment
 * the incident page got.
 *
 * Every verdict is computed by the SAME shared helpers the server's
 * `permits.issue` runs (`validityWindowError`, `gasGateError`) or comes
 * back pre-computed on `permits.get` (`riskAssessmentGate`, `ramsGate`,
 * `trainingShortfalls`), so the list cannot disagree with the refusal.
 * Rows for requirements the permit type does not impose are omitted —
 * a confined-space permit shows its gas row, a hot-work permit doesn't
 * show a rescue-plan row it will never need.
 */
import { gasGateError, validityWindowError } from '@forma360/shared/permits';

export type PermitChecklistKey =
  | 'window'
  | 'acceptor'
  | 'preconditions'
  | 'gasTest'
  | 'isolation'
  | 'rescuePlan'
  | 'authorisation'
  | 'riskAssessment'
  | 'ramsPack'
  | 'training'
  | 'conflicts';

export interface PermitChecklistItem {
  key: PermitChecklistKey;
  done: boolean;
  /** preconditions only: tick progress. */
  count?: { done: number; total: number };
  /** The gate slug explaining an unmet row, where one exists. */
  reason?: string | null;
}

export function buildPermitIssueChecklist(input: {
  now: Date;
  validFrom: Date | string;
  validTo: Date | string;
  maxDurationHours: number;
  acceptorNamed: boolean;
  preconditions: ReadonlyArray<{ checked: boolean }>;
  /** null when the type does not require gas testing. */
  gas: Omit<Parameters<typeof gasGateError>[0], 'now'> | null;
  isolationRequired: boolean;
  isolationSatisfied: boolean;
  rescueRequired: boolean;
  rescueSatisfied: boolean;
  authoriserRequired: boolean;
  authorised: boolean;
  riskAssessmentRequired: boolean;
  /** Server-computed slug from permits.get, null = satisfied. */
  riskAssessmentGate: string | null;
  ramsRequired: boolean;
  /** Server-computed slug from permits.get, null = satisfied. */
  ramsGate: string | null;
  requiredTrainingCount: number;
  trainingShortfallCount: number;
  conflictCount: number;
  conflictsAcknowledged: boolean;
}): PermitChecklistItem[] {
  const items: PermitChecklistItem[] = [];

  const from = new Date(input.validFrom);
  const to = new Date(input.validTo);
  const windowError = validityWindowError(from, to, input.maxDurationHours);
  const windowPast = to.getTime() <= input.now.getTime();
  items.push({
    key: 'window',
    done: windowError === null && !windowPast,
    reason: windowError ?? (windowPast ? 'window-past' : null),
  });

  items.push({ key: 'acceptor', done: input.acceptorNamed });

  if (input.preconditions.length > 0) {
    const done = input.preconditions.filter((p) => p.checked).length;
    items.push({
      key: 'preconditions',
      done: done === input.preconditions.length,
      count: { done, total: input.preconditions.length },
    });
  }

  if (input.gas !== null) {
    const err = gasGateError({ ...input.gas, now: input.now });
    items.push({ key: 'gasTest', done: err === null, reason: err });
  }

  if (input.isolationRequired) {
    items.push({ key: 'isolation', done: input.isolationSatisfied });
  }
  if (input.rescueRequired) {
    items.push({ key: 'rescuePlan', done: input.rescueSatisfied });
  }
  if (input.authoriserRequired) {
    items.push({ key: 'authorisation', done: input.authorised });
  }
  if (input.riskAssessmentRequired) {
    items.push({
      key: 'riskAssessment',
      done: input.riskAssessmentGate === null,
      reason: input.riskAssessmentGate,
    });
  }
  if (input.ramsRequired) {
    items.push({ key: 'ramsPack', done: input.ramsGate === null, reason: input.ramsGate });
  }
  if (input.requiredTrainingCount > 0 || input.trainingShortfallCount > 0) {
    items.push({ key: 'training', done: input.trainingShortfallCount === 0 });
  }
  if (input.conflictCount > 0) {
    items.push({ key: 'conflicts', done: input.conflictsAcknowledged });
  }

  return items;
}
