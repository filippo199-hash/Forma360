/**
 * IN-JR01..JR09 — the incident journey stepper + "what next" pick.
 *
 * The user report this answers: a production incident showed a red
 * "record it here" banner with no visible control and no indication of
 * where in the process the record sat. The helper is the single source
 * of both the step states and the ONE next action, so the page cannot
 * show a stepper that disagrees with its own callout.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildIncidentJourney,
  type JourneyInput,
  type JourneyNextKind,
  type JourneyStepKey,
} from './journey';

const __dirname = dirname(fileURLToPath(import.meta.url));

function input(overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    status: 'reported',
    riddorCategory: null,
    riddorReportable: false,
    riddorSubmitted: false,
    riddorRescreenRequired: false,
    riddorOverdue: false,
    investigationStatus: 'none',
    openActions: 0,
    effectivenessDue: false,
    ...overrides,
  };
}

function stateOf(steps: ReturnType<typeof buildIncidentJourney>['steps'], key: JourneyStepKey) {
  return steps.find((s) => s.key === key)?.state;
}

describe('incident journey (IN-JR)', () => {
  it('IN-JR01: a fresh report sits at triage, and triage is the next act', () => {
    const { steps, next } = buildIncidentJourney(input());
    expect(stateOf(steps, 'reported')).toBe('done');
    expect(stateOf(steps, 'triaged')).toBe('current');
    // RIDDOR is not asked for before triage — the screening needs the
    // severity decision first.
    expect(stateOf(steps, 'riddor')).toBe('todo');
    expect(stateOf(steps, 'investigation')).toBe('todo');
    expect(next).toEqual({ kind: 'triage' });
  });

  it('IN-JR02: after triage the RIDDOR screening is the open duty', () => {
    const { steps, next } = buildIncidentJourney(input({ status: 'triaged' }));
    expect(stateOf(steps, 'triaged')).toBe('done');
    expect(stateOf(steps, 'riddor')).toBe('current');
    expect(next).toEqual({ kind: 'screen' });
  });

  it('IN-JR03: a not-reportable determination discharges RIDDOR outright', () => {
    const { steps, next } = buildIncidentJourney(
      input({ status: 'triaged', riddorCategory: 'not_reportable' }),
    );
    expect(stateOf(steps, 'riddor')).toBe('done');
    // The negative determination IS the record — the next act is the
    // investigation, not another RIDDOR step.
    expect(next).toEqual({ kind: 'startInvestigation' });
  });

  it('IN-JR04: reportable + unsubmitted asks for the submission; overdue outranks everything', () => {
    const pending = buildIncidentJourney(
      input({ status: 'triaged', riddorCategory: 'specified_injury', riddorReportable: true }),
    );
    expect(stateOf(pending.steps, 'riddor')).toBe('current');
    expect(pending.steps.find((s) => s.key === 'riddor')?.alarm).toBeUndefined();
    expect(pending.next).toEqual({ kind: 'submitRiddor' });

    // The screenshot's case: mid-flow (actions outstanding) with the
    // statutory clock blown. The missed deadline is the most expensive
    // thing on the page, so it wins the Next pick outright.
    const overdue = buildIncidentJourney(
      input({
        status: 'actions_outstanding',
        riddorCategory: 'specified_injury',
        riddorReportable: true,
        riddorOverdue: true,
        openActions: 3,
      }),
    );
    expect(stateOf(overdue.steps, 'riddor')).toBe('current');
    expect(overdue.steps.find((s) => s.key === 'riddor')?.alarm).toBe(true);
    expect(overdue.next).toEqual({ kind: 'submitRiddorOverdue' });
  });

  it('IN-JR05: a recorded submission clears the alarm and hands the flow back', () => {
    const { steps, next } = buildIncidentJourney(
      input({
        status: 'actions_outstanding',
        riddorCategory: 'specified_injury',
        riddorReportable: true,
        riddorSubmitted: true,
        // Deliberately still "overdue" by date: submitting late is what
        // clears the duty, and the step must go green once recorded.
        riddorOverdue: true,
        openActions: 2,
      }),
    );
    expect(stateOf(steps, 'riddor')).toBe('done');
    expect(steps.find((s) => s.key === 'riddor')?.alarm).toBeUndefined();
    expect(next).toEqual({ kind: 'completeActions', count: 2 });
  });

  it('IN-JR06: a pending re-screen reopens the RIDDOR step ahead of the investigation', () => {
    const { steps, next } = buildIncidentJourney(
      input({
        status: 'investigating',
        riddorCategory: 'not_reportable',
        riddorRescreenRequired: true,
        investigationStatus: 'draft',
      }),
    );
    expect(stateOf(steps, 'riddor')).toBe('current');
    expect(next).toEqual({ kind: 'rescreen' });
  });

  it('IN-JR07: the investigation stage names the act its status calls for', () => {
    const base = {
      status: 'investigating' as const,
      riddorCategory: 'not_reportable',
    };
    expect(buildIncidentJourney(input({ ...base, investigationStatus: 'draft' })).next).toEqual({
      kind: 'continueInvestigation',
    });
    expect(buildIncidentJourney(input({ ...base, investigationStatus: 'submitted' })).next).toEqual(
      { kind: 'approveInvestigation' },
    );
    // Outside the visibility circle the page must not invent a step it
    // cannot show — it says so instead (counted-not-readable).
    expect(
      buildIncidentJourney(input({ ...base, investigationStatus: 'restricted' })).next,
    ).toEqual({ kind: 'investigationRestricted' });
    // Reopened re-enters the investigation stage with a fresh revision.
    const reopened = buildIncidentJourney(
      input({ status: 'reopened', riddorCategory: 'not_reportable' }),
    );
    expect(stateOf(reopened.steps, 'investigation')).toBe('current');
    expect(reopened.next).toEqual({ kind: 'startInvestigation' });
  });

  it('IN-JR08: actions then closure, then the effectiveness review', () => {
    const outstanding = buildIncidentJourney(
      input({ status: 'actions_outstanding', riddorCategory: 'not_reportable', openActions: 1 }),
    );
    expect(stateOf(outstanding.steps, 'investigation')).toBe('done');
    expect(stateOf(outstanding.steps, 'actions')).toBe('current');
    expect(outstanding.next).toEqual({ kind: 'completeActions', count: 1 });

    const clear = buildIncidentJourney(
      input({ status: 'actions_outstanding', riddorCategory: 'not_reportable', openActions: 0 }),
    );
    expect(clear.next).toEqual({ kind: 'close' });

    const closed = buildIncidentJourney(
      input({ status: 'closed', riddorCategory: 'not_reportable' }),
    );
    expect(closed.steps.every((s) => s.state === 'done')).toBe(true);
    expect(closed.next).toBeNull();

    const due = buildIncidentJourney(
      input({ status: 'closed', riddorCategory: 'not_reportable', effectivenessDue: true }),
    );
    expect(due.next).toEqual({ kind: 'recordEffectiveness' });
  });

  it('IN-JR09: a cancelled record has no next act', () => {
    const { next } = buildIncidentJourney(input({ status: 'cancelled' }));
    expect(next).toBeNull();
  });

  /**
   * IN-JR10 — the variable-keyed-t() guard. The stepper renders both
   * `journey.steps.<key>` and `journey.next.<kind>` through template
   * literals, which K01 structurally cannot see: a missing key would
   * print the raw dotted path on screen and pass CI in silence (exactly
   * how the FRA fire-triangle bug shipped). Every member of both unions
   * is asserted against EVERY locale bundle, so adding a step or a next
   * kind without copy fails here.
   */
  it('IN-JR10: every step and next kind has copy in all ten locales', async () => {
    const stepKeys: JourneyStepKey[] = [
      'reported',
      'triaged',
      'riddor',
      'investigation',
      'actions',
      'closed',
    ];
    const nextKinds: JourneyNextKind[] = [
      'triage',
      'screen',
      'rescreen',
      'submitRiddor',
      'submitRiddorOverdue',
      'startInvestigation',
      'continueInvestigation',
      'approveInvestigation',
      'investigationRestricted',
      'completeActions',
      'close',
      'recordEffectiveness',
    ];
    // The unions must stay exhaustive: a new member added to the type
    // without a line above is a compile error on these two maps.
    const stepSeen: Record<JourneyStepKey, true> = {
      reported: true,
      triaged: true,
      riddor: true,
      investigation: true,
      actions: true,
      closed: true,
    };
    const nextSeen: Record<JourneyNextKind, true> = {
      triage: true,
      screen: true,
      rescreen: true,
      submitRiddor: true,
      submitRiddorOverdue: true,
      startInvestigation: true,
      continueInvestigation: true,
      approveInvestigation: true,
      investigationRestricted: true,
      completeActions: true,
      close: true,
      recordEffectiveness: true,
    };
    expect(Object.keys(stepSeen).sort()).toEqual([...stepKeys].sort());
    expect(Object.keys(nextSeen).sort()).toEqual([...nextKinds].sort());

    const dir = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'i18n', 'messages');
    const locales = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    expect(locales.length).toBe(10);

    for (const file of locales) {
      const bundle = JSON.parse(await readFile(join(dir, file), 'utf-8')) as {
        incidents: {
          journey?: {
            steps?: Record<string, string>;
            next?: Record<string, string>;
            nextLabel?: string;
            youAreHere?: string;
            viewActions?: string;
          };
          riddor: Record<string, unknown>;
        };
      };
      const journey = bundle.incidents.journey;
      expect(journey, `${file}: incidents.journey missing`).toBeDefined();
      for (const key of stepKeys) {
        expect(journey?.steps?.[key], `${file}: journey.steps.${key}`).toBeTruthy();
      }
      for (const kind of nextKinds) {
        expect(journey?.next?.[kind], `${file}: journey.next.${kind}`).toBeTruthy();
      }
      for (const key of ['nextLabel', 'youAreHere', 'viewActions'] as const) {
        expect(journey?.[key], `${file}: journey.${key}`).toBeTruthy();
      }
      // The RIDDOR duty explainer: the fix for "record it here" pointing
      // at nothing. Its <link> chunk is what carries the HSE link.
      for (const key of [
        'dutyHeading',
        'stepSubmitHse',
        'stepRecordHere',
        'dutyFootnote',
        'submitPanelHint',
      ]) {
        expect(bundle.incidents.riddor[key], `${file}: riddor.${key}`).toBeTruthy();
      }
      expect(
        String(bundle.incidents.riddor['stepSubmitHse']),
        `${file}: riddor.stepSubmitHse must carry the <link> chunk`,
      ).toMatch(/<link>.+<\/link>/u);
    }
  });
});
