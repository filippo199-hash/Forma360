/**
 * The signed COSHH assessment snapshot (BUG-03).
 *
 * Risk assessments freeze an immutable version on publish, and fire risk
 * assessments do the same. COSHH did not: an Active, signed assessment
 * stayed freely editable and there was no version behind it, so an edit
 * destroyed the only copy of what an assessor had attested as suitable and
 * sufficient. An HSE evaluation found it by opening a signed assessment and
 * typing into it. That is a documented-information-control gap under
 * ISO 45001 as much as a product bug, and it made COSHH the odd one out
 * among three modules that otherwise share a model.
 *
 * The fix follows the sibling modules rather than inventing a fourth
 * pattern: publishing freezes a version, editing a live assessment stays
 * legal (ADR 0011 §1 — the amber "changed since publish" banner is the whole
 * point, and COSHH already had it), and the version is what proves what was
 * signed.
 *
 * This module lives in `packages/api` rather than in the router because the
 * vocabularies it needs (`CoshhControlTier`, `ExposureRoute`, …) are defined
 * by the db schema, which `packages/shared` deliberately does not depend on —
 * the same placement decision `marshal-competence.ts` made.
 *
 * RS-A6 is on record as the bug where a snapshot builder silently omitted a
 * field and shipped versions that could not be read back. So: one interface,
 * one builder, one call site.
 */
import type { Database } from '@forma360/db/client';
import {
  coshhAssessmentControls,
  type CoshhAssessment,
  type CoshhVersionContent,
} from '@forma360/db/schema';
import { eq } from 'drizzle-orm';

export type { CoshhVersionContent, CoshhVersionControl } from '@forma360/db/schema';

/**
 * Build the snapshot. THE single call site is `coshh.assessments.publish`,
 * inside its transaction, so the version and the status change cannot
 * disagree.
 */
export async function buildCoshhVersionContent(
  db: Database,
  assessment: CoshhAssessment,
  substanceName: string,
): Promise<CoshhVersionContent> {
  const controls = await db
    .select()
    .from(coshhAssessmentControls)
    .where(eq(coshhAssessmentControls.assessmentId, assessment.id));

  return {
    taskDescription: assessment.taskDescription,
    referenceNumber: assessment.referenceNumber,
    substanceId: assessment.substanceId,
    substanceName,
    kind: assessment.kind,
    routesOfExposure: [...assessment.routesOfExposure],
    personsExposed: [...assessment.personsExposed],
    personsCount: assessment.personsCount,
    quantityBand: assessment.quantityBand,
    frequencyBand: assessment.frequencyBand,
    durationBand: assessment.durationBand,
    levRequired: assessment.levRequired,
    healthSurveillanceRequired: assessment.healthSurveillanceRequired,
    exposureMonitoringRequired: assessment.exposureMonitoringRequired,
    emergencyNotes: assessment.emergencyNotes,
    plainSummary: assessment.plainSummary,
    assessorUserId: assessment.assessorUserId,
    reviewFrequencyMonths: assessment.reviewFrequencyMonths,
    nextReviewAt: assessment.nextReviewAt?.toISOString() ?? null,
    controls: controls.map((c) => ({
      tier: c.tier,
      description: c.description,
      status: c.status,
      ppeJustification: c.ppeJustification,
      rpeType: c.rpeType,
      rpeApf: c.rpeApf,
    })),
  };
}
