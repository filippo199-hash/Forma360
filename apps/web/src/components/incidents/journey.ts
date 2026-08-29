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
  /**
   * RIDDOR only: the duty is open but not yet late (amber). RIDDOR is
   * never `current`: it runs BESIDE the lifecycle rather than in it, and
   * two highlighted chips stop the strip answering "where am I" at a
   * glance — the whole point of the strip. Exactly one lifecycle step
   * carries `current`; the RIDDOR chip reads as a duty badge.
   */
  duty?: boolean;
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

  // The lifecycle line: exactly one step is `current` — the first one
  // not yet done. That single highlight is what answers "where am I".
  const lifecycleDone: Record<Exclude<JourneyStepKey, 'riddor'>, boolean> = {
    reported: true,
    triaged: stage >= 1,
    investigation: stage >= 3,
    actions: stage >= 4,
    closed: stage >= 4,
  };
  const lifecycleOrder: Array<Exclude<JourneyStepKey, 'riddor'>> = [
    'reported',
    'triaged',
    'investigation',
    'actions',
    'closed',
  ];
  const currentKey =
    input.status === 'cancelled'
      ? null
      : (lifecycleOrder.find((key) => !lifecycleDone[key]) ?? null);
  const lifecycleStep = (key: Exclude<JourneyStepKey, 'riddor'>): JourneyStep => ({
    key,
    state: lifecycleDone[key] ? 'done' : key === currentKey ? 'current' : 'todo',
  });

  const steps: JourneyStep[] = [
    lifecycleStep('reported'),
    lifecycleStep('triaged'),
    {
      key: 'riddor',
      state: riddorDischarged ? 'done' : 'todo',
      ...(riddorDischarged
        ? {}
        : input.riddorOverdue
          ? { alarm: true }
          : stage >= 1
            ? { duty: true }
            : {}),
    },
    lifecycleStep('investigation'),
    lifecycleStep('actions'),
    lifecycleStep('closed'),
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
