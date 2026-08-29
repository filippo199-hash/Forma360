import type { IncidentStatus } from '@forma360/shared/incidents';

/**
 * The incident journey — "where am I, what happens next" — derived
 * purely from record state so the stepper on the incident page and its
 * single Next-step callout can never disagree with the router's gates.
 *
 * The lifecycle is strictly linear (reported → triaged → investigating →
 * actions_outstanding → closed; reopened re-enters at investigating), so
 * the steps are a line. RIDDOR is the one parallel statutory duty: it is
 * shown as its own step, is "done" only when discharged (screened, no
 * re-screen pending, and — where reportable — the HSE submission
 * recorded), and outranks everything in the Next pick once overdue,
 * because a missed statutory deadline is the most expensive thing on
 * the page.
 */

export type JourneyStepKey =
  | 'reported'
  | 'triaged'
  | 'riddor'
  | 'investigation'
  | 'actions'
  | 'closed';

export type JourneyStepState = 'done' | 'current' | 'todo';

export interface JourneyStep {
  key: JourneyStepKey;
  state: JourneyStepState;
  /** RIDDOR only: paint the step red — the statutory clock has run out. */
  alarm?: boolean;
}

export type JourneyNextKind =
  | 'triage'
  | 'screen'
  | 'rescreen'
  | 'submitRiddor'
  | 'submitRiddorOverdue'
  | 'startInvestigation'
  | 'continueInvestigation'
  | 'approveInvestigation'
  | 'investigationRestricted'
  | 'completeActions'
  | 'close'
  | 'recordEffectiveness';

export interface JourneyNext {
  kind: JourneyNextKind;
  /** completeActions only: how many actions are still open. */
  count?: number;
}

export interface JourneyInput {
  status: IncidentStatus;
  riddorCategory: string | null;
  /** isRiddorReportable(riddorCategory) — computed by the caller. */
  riddorReportable: boolean;
  riddorSubmitted: boolean;
  riddorRescreenRequired: boolean;
  riddorOverdue: boolean;
  /**
   * Latest revision's status; 'none' when no investigation exists and
   * 'restricted' when one exists but the viewer is outside its
   * visibility circle (counted-not-readable — the stepper must not
   * pretend there is nothing there).
   */
  investigationStatus: 'none' | 'draft' | 'submitted' | 'approved' | 'restricted';
  /** Linked actions still open or in progress. */
  openActions: number;
  /** Closed, verdict not yet recorded, and the review date has arrived. */
  effectivenessDue: boolean;
}

const STAGE: Record<IncidentStatus, number> = {
  reported: 0,
  triaged: 1,
  investigating: 2,
  actions_outstanding: 3,
  closed: 4,
  // Reopened re-enters the investigation stage; the prior revision
  // stays frozen and a new one starts.
  reopened: 2,
  // Cancelled is off the line entirely — the caller hides the stepper.
  cancelled: 0,
};

export function buildIncidentJourney(input: JourneyInput): {
  steps: JourneyStep[];
  next: JourneyNext | null;
} {
  const stage = STAGE[input.status];
  const riddorDischarged =
    input.riddorCategory !== null &&
    !input.riddorRescreenRequired &&
    (!input.riddorReportable || input.riddorSubmitted);

  const steps: JourneyStep[] = [
    { key: 'reported', state: 'done' },
    { key: 'triaged', state: stage >= 1 ? 'done' : 'current' },
    {
      key: 'riddor',
      state: riddorDischarged ? 'done' : stage === 0 ? 'todo' : 'current',
      ...(input.riddorOverdue && !riddorDischarged ? { alarm: true } : {}),
    },
    {
      key: 'investigation',
      state: stage >= 3 ? 'done' : stage >= 1 ? 'current' : 'todo',
    },
    { key: 'actions', state: stage >= 4 ? 'done' : stage === 3 ? 'current' : 'todo' },
    { key: 'closed', state: stage >= 4 ? 'done' : 'todo' },
  ];

  if (input.status === 'cancelled') return { steps, next: null };

  const next = ((): JourneyNext | null => {
    if (input.riddorReportable && !input.riddorSubmitted && input.riddorOverdue) {
      return { kind: 'submitRiddorOverdue' };
    }
    if (input.status === 'reported') return { kind: 'triage' };
    if (input.riddorRescreenRequired) return { kind: 'rescreen' };
    if (input.riddorCategory === null) return { kind: 'screen' };
    if (input.riddorReportable && !input.riddorSubmitted) return { kind: 'submitRiddor' };
    if (stage === 1 || input.status === 'reopened') return { kind: 'startInvestigation' };
    if (stage === 2) {
      if (input.investigationStatus === 'draft') return { kind: 'continueInvestigation' };
      if (input.investigationStatus === 'submitted') return { kind: 'approveInvestigation' };
      return { kind: 'investigationRestricted' };
    }
    if (stage === 3) {
      return input.openActions > 0
        ? { kind: 'completeActions', count: input.openActions }
        : { kind: 'close' };
    }
    if (stage === 4 && input.effectivenessDue) return { kind: 'recordEffectiveness' };
    return null;
  })();

  return { steps, next };
}
