/**
 * Unit tests for the RAMS domain helpers (FreeHS module B6).
 *
 * Edge cases covered here (the router halves live in
 * `packages/api/src/routers/rams.test.ts`):
 *   - RS-E01 both lifecycle matrices — every illegal transition refused
 *   - RS-E02 step content Zod round-trip; `sequence` dense and reorderable
 *   - RS-E03 issue gate: no steps / step missing description → refused
 *   - RS-E05 issue gate: high-residual RA hazard unreferenced by any step
 *   - RS-E06 issue gate: emergency block incomplete → refused
 *   - RS-E13 (helper half): acceptance validity windows
 *   - RS-E16 reference-number continuity past 999999
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RISK_MATRIX } from './risk-matrix';
import {
  canTransitionMethodStatement,
  canTransitionPack,
  DEFAULT_METHOD_STATEMENT_TEMPLATES,
  emergencyBlockComplete,
  emptyMethodStatementContent,
  evaluateIssueGate,
  formatMethodStatementReference,
  formatRamsPackReference,
  isLivePackStatus,
  METHOD_STATEMENT_STATUSES,
  methodStatementContentSchema,
  parseMethodStatementContent,
  RAMS_PACK_STATUSES,
  RAMS_REVIEW_CHECKLIST,
  RAMS_CONTENT_SCHEMA_VERSION,
  resequenceSteps,
  reviewAcceptanceValid,
  reviewHasFailures,
  snapshotReviewChecklist,
  unansweredReviewItems,
  unreferencedHighRiskHazards,
  type BoundRaVersion,
  type MethodStatementContent,
  type MethodStatementStatus,
  type MethodStatementStep,
  type RamsPackStatus,
} from './rams';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function step(overrides?: Partial<MethodStatementStep>): MethodStatementStep {
  return methodStatementContentSchema.parse({
    steps: [
      {
        id: overrides?.id ?? 'step-1',
        sequence: overrides?.sequence ?? 1,
        title: overrides?.title ?? 'Isolate and prove dead',
        description: overrides?.description ?? 'Lock off, tag and prove dead at the point of work.',
        ...(overrides?.hazardRefs !== undefined ? { hazardRefs: overrides.hazardRefs } : {}),
      },
    ],
  }).steps[0] as MethodStatementStep;
}

function contentWith(steps: ReadonlyArray<MethodStatementStep>): MethodStatementContent {
  return methodStatementContentSchema.parse({
    steps: resequenceSteps(steps),
    emergency: {
      firstAid: 'Crew first aider on site.',
      emergencyProcedure: 'Raise the alarm, evacuate to the muster point, call 999.',
    },
  });
}

const RA_VERSION_ID = '01JXRAVERSION0000000000001';

function boundRa(overrides?: Partial<BoundRaVersion>): BoundRaVersion {
  return {
    raVersionId: overrides?.raVersionId ?? RA_VERSION_ID,
    assessmentId: overrides?.assessmentId ?? '01JXRAASSESSMENT000000001',
    referenceNumber: overrides?.referenceNumber ?? 'RA-000001',
    title: overrides?.title ?? 'Working at height',
    versionNumber: overrides?.versionNumber ?? 1,
    matrix: overrides?.matrix ?? DEFAULT_RISK_MATRIX,
    hazards: overrides?.hazards ?? [
      // 5 × 4 = 20 → critical under the default matrix.
      { index: 0, hazard: 'Fall from height', residualLikelihood: 5, residualSeverity: 4 },
      // 1 × 2 = 2 → low.
      { index: 1, hazard: 'Minor hand abrasion', residualLikelihood: 1, residualSeverity: 2 },
    ],
  };
}

// ─── RS-E01 · lifecycle matrices ────────────────────────────────────────────

describe('RS-E01 lifecycle state machines', () => {
  it('permits only the documented method-statement transitions', () => {
    const legal = new Set([
      'draft>published',
      'draft>archived',
      // Republication — version n+1 of an already published statement.
      'published>published',
      'published>archived',
      'archived>draft',
      'archived>published',
    ]);
    for (const from of METHOD_STATEMENT_STATUSES) {
      for (const to of METHOD_STATEMENT_STATUSES) {
        expect(canTransitionMethodStatement(from, to)).toBe(legal.has(`${from}>${to}`));
      }
    }
  });

  it('refuses to move a published method statement back to draft', () => {
    // Editing a published method statement creates a NEW draft version;
    // the header never walks backwards.
    expect(canTransitionMethodStatement('published', 'draft')).toBe(false);
  });

  it('permits only the documented pack transitions', () => {
    const legal = new Set([
      'draft>issued',
      'draft>cancelled',
      // Re-issue: the pack row stays issued at version n+1.
      'issued>issued',
      'issued>superseded',
      'issued>withdrawn',
    ]);
    for (const from of RAMS_PACK_STATUSES) {
      for (const to of RAMS_PACK_STATUSES) {
        expect(canTransitionPack(from, to)).toBe(legal.has(`${from}>${to}`));
      }
    }
  });

  it('treats terminal pack states as terminal', () => {
    const terminal: ReadonlyArray<RamsPackStatus> = ['superseded', 'withdrawn', 'cancelled'];
    for (const from of terminal) {
      for (const to of RAMS_PACK_STATUSES) {
        expect(canTransitionPack(from, to)).toBe(false);
      }
    }
  });

  it('never lets a draft pack skip straight to superseded or withdrawn', () => {
    expect(canTransitionPack('draft', 'superseded')).toBe(false);
    expect(canTransitionPack('draft', 'withdrawn')).toBe(false);
  });

  it('marks only issued packs as live', () => {
    for (const status of RAMS_PACK_STATUSES) {
      expect(isLivePackStatus(status)).toBe(status === 'issued');
    }
  });

  it('exposes an archived → draft un-archive path for method statements', () => {
    const archived: MethodStatementStatus = 'archived';
    expect(canTransitionMethodStatement(archived, 'draft')).toBe(true);
  });
});

// ─── RS-E02 · content schema round-trip + density ───────────────────────────

describe('RS-E02 step content schema', () => {
  it('round-trips a full content blob through parse', () => {
    const content = methodStatementContentSchema.parse({
      scopeOfWorks: 'Replace AHU filters in the plant room.',
      steps: [
        {
          id: 's1',
          sequence: 1,
          title: 'Isolate and prove dead',
          description: 'Lock off and prove dead at the point of work.',
          hazardRefs: [
            { raVersionId: RA_VERSION_ID, hazardIndex: 0, hazardLabel: 'Electrocution' },
          ],
          controlNotes: 'Use a proving unit before and after.',
          plant: [{ name: 'Voltage indicator', assetId: null, note: 'Calibrated' }],
          substanceRefs: [],
          ppe: ['safety_helmet', 'gloves'],
          personnel: [{ role: 'competent_person', count: 1, competenceNote: 'City & Guilds 2391' }],
          holdPoint: {
            kind: 'isolation_proved',
            description: 'Proved dead before work starts.',
            responsibleRole: 'Supervisor',
          },
          environmentalNotes: 'No waste generated.',
        },
      ],
    });

    expect(content.schemaVersion).toBe(RAMS_CONTENT_SCHEMA_VERSION);
    expect(content.steps).toHaveLength(1);
    const only = content.steps[0];
    expect(only?.holdPoint?.kind).toBe('isolation_proved');
    expect(only?.ppe).toEqual(['safety_helmet', 'gloves']);
    expect(only?.personnel[0]?.count).toBe(1);
    // Defaults fill in without being supplied.
    expect(only?.personnel[0]?.roleOther).toBe('');

    // A parsed blob re-parses identically — the persisted jsonb round-trips.
    expect(parseMethodStatementContent(JSON.parse(JSON.stringify(content)))).toEqual(content);
  });

  it('produces a valid empty blob for a blank method statement', () => {
    const empty = emptyMethodStatementContent();
    expect(empty.steps).toEqual([]);
    expect(empty.emergency.firstAid).toBe('');
    expect(empty.logistics.welfare).toBe('');
  });

  it('refuses a sparse sequence', () => {
    const parsed = methodStatementContentSchema.safeParse({
      steps: [
        { id: 'a', sequence: 1, title: 'One', description: 'x' },
        { id: 'b', sequence: 3, title: 'Three', description: 'x' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses an out-of-order sequence', () => {
    const parsed = methodStatementContentSchema.safeParse({
      steps: [
        { id: 'a', sequence: 2, title: 'Two', description: 'x' },
        { id: 'b', sequence: 1, title: 'One', description: 'x' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses duplicate step ids', () => {
    const parsed = methodStatementContentSchema.safeParse({
      steps: [
        { id: 'dup', sequence: 1, title: 'One', description: 'x' },
        { id: 'dup', sequence: 2, title: 'Two', description: 'x' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('resequences densely after a reorder so the schema stays satisfied', () => {
    const a = step({ id: 'a', title: 'A' });
    const b = step({ id: 'b', title: 'B' });
    const c = step({ id: 'c', title: 'C' });
    // Move C to the front — the raw array now has sequences 1,1,1.
    const reordered = resequenceSteps([c, a, b]);
    expect(reordered.map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(reordered.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(methodStatementContentSchema.safeParse({ steps: reordered }).success).toBe(true);
  });

  it('resequences densely after a deletion', () => {
    const kept = resequenceSteps([step({ id: 'a' }), step({ id: 'c' })]);
    expect(kept.map((s) => s.sequence)).toEqual([1, 2]);
  });
});

// ─── RS-E03 / RS-E06 · the issue gate ───────────────────────────────────────

describe('RS-E03 issue gate — steps', () => {
  it('refuses a pack with no steps', () => {
    const result = evaluateIssueGate({
      content: contentWith([]),
      raVersions: [boundRa({ hazards: [] })],
      allRaVersionsPublished: true,
      attestationConfirmed: true,
    });
    expect(result.errors).toContain('no-steps');
  });

  it('refuses a step with no description', () => {
    const bare = { ...step({ id: 'a' }), description: '   ' };
    const result = evaluateIssueGate({
      content: contentWith([bare]),
      raVersions: [boundRa({ hazards: [] })],
      allRaVersionsPublished: true,
      attestationConfirmed: true,
    });
    expect(result.errors).toContain('step-missing-description');
  });

  it('refuses a step with a blank title', () => {
    // The content schema already refuses a blank title (`title` is
    // `.trim().min(1)`), so this asserts the gate's own defence-in-depth
    // check on a hand-built blob — the gate is what renders the
    // author-facing checklist, so it must catch it independently.
    const content: MethodStatementContent = {
      ...contentWith([step({ id: 'a' })]),
      steps: [{ ...step({ id: 'a' }), title: '  ' }],
    };
    const result = evaluateIssueGate({
      content,
      raVersions: [boundRa({ hazards: [] })],
      allRaVersionsPublished: true,
      attestationConfirmed: true,
    });
    expect(result.errors).toContain('step-missing-title');
  });

  it('refuses a pack with no bound risk assessment', () => {
    const result = evaluateIssueGate({
      content: contentWith([step()]),
      raVersions: [],
      allRaVersionsPublished: true,
      attestationConfirmed: true,
    });
    expect(result.errors).toContain('no-risk-assessment');
  });

  it('refuses a pack binding an unpublished RA version', () => {
    const result = evaluateIssueGate({
      content: contentWith([step()]),
      raVersions: [boundRa({ hazards: [] })],
      allRaVersionsPublished: false,
      attestationConfirmed: true,
    });
    expect(result.errors).toContain('risk-assessment-not-published');
  });

  it('refuses issue without the author attestation', () => {
    const result = evaluateIssueGate({
      content: contentWith([step()]),
      raVersions: [boundRa({ hazards: [] })],
      allRaVersionsPublished: true,
      attestationConfirmed: false,
    });
    expect(result.errors).toContain('attestation-not-confirmed');
  });

  it('reports every failure at once rather than first-fail', () => {
    const result = evaluateIssueGate({
      content: methodStatementContentSchema.parse({ steps: [] }),
      raVersions: [],
      allRaVersionsPublished: true,
      attestationConfirmed: false,
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'no-steps',
        'no-risk-assessment',
        'emergency-block-incomplete',
        'attestation-not-confirmed',
      ]),
    );
  });

  it('passes a complete pack', () => {
    const withRef: MethodStatementStep = {
      ...step({ id: 'a' }),
      hazardRefs: [{ raVersionId: RA_VERSION_ID, hazardIndex: 0, hazardLabel: 'Fall from height' }],
    };
    const result = evaluateIssueGate({
      content: contentWith([withRef]),
      raVersions: [boundRa()],
      allRaVersionsPublished: true,
      attestationConfirmed: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.unreferenced).toEqual([]);
  });
});

describe('RS-E06 issue gate — emergency block', () => {
  it('refuses when first aid is missing', () => {
    const content = methodStatementContentSchema.parse({
      steps: resequenceSteps([step()]),
      emergency: { emergencyProcedure: 'Evacuate to the muster point.' },
    });
    const result = evaluateIssueGate({
      content,
      raVersions: [boundRa({ hazards: [] })],
      allRaVersionsPublished: true,
      attestationConfirmed: true,
    });
    expect(result.errors).toContain('emergency-block-incomplete');
  });

  it('refuses when the emergency procedure is missing', () => {
    const content = methodStatementContentSchema.parse({
      steps: resequenceSteps([step()]),
      emergency: { firstAid: 'Crew first aider on site.' },
    });
    const result = evaluateIssueGate({
      content,
      raVersions: [boundRa({ hazards: [] })],
      allRaVersionsPublished: true,
      attestationConfirmed: true,
    });
    expect(result.errors).toContain('emergency-block-incomplete');
  });

  it('treats whitespace-only arrangements as missing', () => {
    expect(
      emergencyBlockComplete({
        ...emptyMethodStatementContent().emergency,
        firstAid: '   ',
        emergencyProcedure: '  ',
      }),
    ).toBe(false);
  });

  it('accepts a block with both arrangements present', () => {
    expect(
      emergencyBlockComplete({
        ...emptyMethodStatementContent().emergency,
        firstAid: 'Crew first aider.',
        emergencyProcedure: 'Call 999.',
      }),
    ).toBe(true);
  });
});

// ─── RS-E05 · the headline validation ───────────────────────────────────────

describe('RS-E05 high-residual hazards must be addressed by a step', () => {
  it('flags a critical hazard no step references', () => {
    const unreferenced = unreferencedHighRiskHazards(contentWith([step()]), [boundRa()]);
    expect(unreferenced).toHaveLength(1);
    expect(unreferenced[0]?.hazard).toBe('Fall from height');
    expect(unreferenced[0]?.band).toBe('critical');
  });

  it('is satisfied once a step references the hazard', () => {
    const withRef: MethodStatementStep = {
      ...step({ id: 'a' }),
      hazardRefs: [{ raVersionId: RA_VERSION_ID, hazardIndex: 0, hazardLabel: 'Fall from height' }],
    };
    expect(unreferencedHighRiskHazards(contentWith([withRef]), [boundRa()])).toEqual([]);
  });

  it('ignores low and medium hazards', () => {
    const lowOnly = boundRa({
      hazards: [{ index: 0, hazard: 'Minor abrasion', residualLikelihood: 1, residualSeverity: 2 }],
    });
    expect(unreferencedHighRiskHazards(contentWith([step()]), [lowOnly])).toEqual([]);
  });

  it('ignores unscored hazards — the RA module governs scoring completeness', () => {
    const unscored = boundRa({
      hazards: [
        { index: 0, hazard: 'Not yet scored', residualLikelihood: null, residualSeverity: null },
      ],
    });
    expect(unreferencedHighRiskHazards(contentWith([step()]), [unscored])).toEqual([]);
  });

  it('honours a lower threshold when the tenant configures one', () => {
    const medium = boundRa({
      // 3 × 3 = 9 → medium under the default matrix.
      hazards: [
        { index: 0, hazard: 'Manual handling', residualLikelihood: 3, residualSeverity: 3 },
      ],
    });
    expect(unreferencedHighRiskHazards(contentWith([step()]), [medium], 'high')).toEqual([]);
    expect(unreferencedHighRiskHazards(contentWith([step()]), [medium], 'medium')).toHaveLength(1);
  });

  it('applies the RA version’s own matrix, including severity floors', () => {
    // 1 × 5 = 5 → medium on thresholds alone, but the floor lifts it to high.
    const floored = boundRa({
      matrix: { ...DEFAULT_RISK_MATRIX, severityFloors: { '5': 'high' } },
      hazards: [
        { index: 0, hazard: 'Fatality potential', residualLikelihood: 1, residualSeverity: 5 },
      ],
    });
    const flagged = unreferencedHighRiskHazards(contentWith([step()]), [floored]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.band).toBe('high');
  });

  it('scopes references by RA version — a ref to another version does not satisfy it', () => {
    const otherVersion = '01JXRAVERSION0000000000002';
    const wrongRef: MethodStatementStep = {
      ...step({ id: 'a' }),
      hazardRefs: [{ raVersionId: otherVersion, hazardIndex: 0, hazardLabel: 'Fall from height' }],
    };
    expect(unreferencedHighRiskHazards(contentWith([wrongRef]), [boundRa()])).toHaveLength(1);
  });

  it('surfaces the flagged hazards on the gate result', () => {
    const result = evaluateIssueGate({
      content: contentWith([step()]),
      raVersions: [boundRa()],
      allRaVersionsPublished: true,
      attestationConfirmed: true,
    });
    expect(result.errors).toContain('high-risk-hazard-unreferenced');
    expect(result.unreferenced).toHaveLength(1);
  });

  it('spans several bound assessments', () => {
    const second = boundRa({
      raVersionId: '01JXRAVERSION0000000000002',
      title: 'Manual handling',
      hazards: [{ index: 0, hazard: 'Crush injury', residualLikelihood: 4, residualSeverity: 5 }],
    });
    const flagged = unreferencedHighRiskHazards(contentWith([step()]), [boundRa(), second]);
    expect(flagged.map((h) => h.assessmentTitle)).toEqual(['Working at height', 'Manual handling']);
  });
});

// ─── RS-E13 (helper half) · review checklist + acceptance validity ──────────

describe('RS-E13 third-party review helpers', () => {
  it('snapshots the checklist unanswered', () => {
    const snapshot = snapshotReviewChecklist();
    expect(snapshot).toHaveLength(RAMS_REVIEW_CHECKLIST.length);
    // This assertion used to read `=== 'na'` under this very name, which
    // is how the defect survived: N/A means "does not apply to this
    // job" — a finding somebody made — so a fresh checklist of N/As
    // renders as fully reviewed. A reviewer could open a contractor's
    // pack and record a complete-looking decision without reading a
    // single line.
    expect(snapshot.every((e) => e.verdict === 'unanswered')).toBe(true);
    expect(unansweredReviewItems(snapshot)).toHaveLength(RAMS_REVIEW_CHECKLIST.length);
    expect(reviewHasFailures(snapshot)).toBe(false);
  });

  it('RS-E13b — an answered line is no longer counted as unanswered', () => {
    const snapshot = snapshotReviewChecklist();
    const first = snapshot[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const worked = [{ ...first, verdict: 'na' as const }, ...snapshot.slice(1)];
    // An explicit N/A is a judgement and counts as answered.
    expect(unansweredReviewItems(worked)).toHaveLength(RAMS_REVIEW_CHECKLIST.length - 1);
  });

  it('detects a failed checklist item', () => {
    const snapshot = snapshotReviewChecklist();
    const first = snapshot[0];
    expect(first).toBeDefined();
    if (first !== undefined) first.verdict = 'fail';
    expect(reviewHasFailures(snapshot)).toBe(true);
  });

  const now = new Date('2026-06-15T09:00:00Z');

  it('treats an in-window acceptance as valid', () => {
    expect(
      reviewAcceptanceValid(
        {
          outcome: 'accepted',
          validFrom: new Date('2026-06-01T00:00:00Z'),
          validTo: new Date('2026-07-01T00:00:00Z'),
        },
        now,
      ),
    ).toBe(true);
  });

  it('treats an expired acceptance as invalid', () => {
    expect(
      reviewAcceptanceValid(
        {
          outcome: 'accepted',
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validTo: new Date('2026-06-01T00:00:00Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it('treats a not-yet-valid acceptance as invalid', () => {
    expect(
      reviewAcceptanceValid(
        { outcome: 'accepted', validFrom: new Date('2026-07-01T00:00:00Z'), validTo: null },
        now,
      ),
    ).toBe(false);
  });

  it('treats an unbounded acceptance as valid', () => {
    expect(
      reviewAcceptanceValid({ outcome: 'accepted', validFrom: null, validTo: null }, now),
    ).toBe(true);
  });

  it('accepts an accepted-with-conditions review', () => {
    expect(
      reviewAcceptanceValid(
        { outcome: 'accepted_with_conditions', validFrom: null, validTo: null },
        now,
      ),
    ).toBe(true);
  });

  it('never treats a rejected or pending review as valid', () => {
    expect(
      reviewAcceptanceValid({ outcome: 'rejected', validFrom: null, validTo: null }, now),
    ).toBe(false);
    expect(reviewAcceptanceValid({ outcome: 'pending', validFrom: null, validTo: null }, now)).toBe(
      false,
    );
  });
});

// ─── RS-E16 · reference continuity ──────────────────────────────────────────

describe('RS-E16 reference numbering', () => {
  it('zero-pads to six digits', () => {
    expect(formatMethodStatementReference(1)).toBe('MS-000001');
    expect(formatRamsPackReference(42)).toBe('RAMS-000042');
    expect(formatRamsPackReference(999_999)).toBe('RAMS-999999');
  });

  it('grows past six digits without truncating or colliding', () => {
    expect(formatRamsPackReference(1_000_000)).toBe('RAMS-1000000');
    expect(formatRamsPackReference(1_000_001)).toBe('RAMS-1000001');
    expect(formatRamsPackReference(1_000_000)).not.toBe(formatRamsPackReference(1_000_001));
    expect(formatMethodStatementReference(1_234_567)).toBe('MS-1234567');
  });
});

// ─── Seeded starter library ─────────────────────────────────────────────────

describe('seeded starter templates', () => {
  it('ships eight editable skeletons', () => {
    expect(DEFAULT_METHOD_STATEMENT_TEMPLATES).toHaveLength(8);
  });

  it('gives every template a usable step count with titles and descriptions', () => {
    for (const template of DEFAULT_METHOD_STATEMENT_TEMPLATES) {
      expect(template.steps.length).toBeGreaterThanOrEqual(6);
      expect(template.steps.length).toBeLessThanOrEqual(10);
      for (const s of template.steps) {
        expect(s.title.trim().length).toBeGreaterThan(0);
        expect(s.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('marks at least one hold point per template', () => {
    for (const template of DEFAULT_METHOD_STATEMENT_TEMPLATES) {
      expect(template.steps.some((s) => s.holdPoint !== undefined)).toBe(true);
    }
  });

  it('completes the emergency block on every template so a seeded pack can issue', () => {
    for (const template of DEFAULT_METHOD_STATEMENT_TEMPLATES) {
      expect(template.emergency.firstAid?.trim().length ?? 0).toBeGreaterThan(0);
      expect(template.emergency.emergencyProcedure?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('produces content that satisfies the content schema once sequenced', () => {
    for (const template of DEFAULT_METHOD_STATEMENT_TEMPLATES) {
      const parsed = methodStatementContentSchema.safeParse({
        scopeOfWorks: template.scopeOfWorks,
        steps: template.steps.map((s, index) => ({
          id: `seed-${index + 1}`,
          sequence: index + 1,
          title: s.title,
          description: s.description,
          ppe: s.ppe,
          ...(s.holdPoint !== undefined
            ? { holdPoint: { kind: s.holdPoint.kind, description: s.holdPoint.description } }
            : {}),
        })),
        emergency: template.emergency,
        logistics: template.logistics,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('uses unique titles so the library picker is unambiguous', () => {
    const titles = DEFAULT_METHOD_STATEMENT_TEMPLATES.map((t) => t.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
