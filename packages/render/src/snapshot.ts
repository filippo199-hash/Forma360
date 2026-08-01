/**
 * Read an inspection into the shape every renderer (PDF, Word, the
 * in-browser print layout) consumes. One source of truth for the
 * fields and ordering we expose to the outside world.
 *
 * We deliberately return a flat, JSON-serialisable object — renderers
 * run in worker threads / chromium / client browsers, none of which
 * have ambient Drizzle access. Keeping the shape JSON means the same
 * snapshot can be cached, hashed, and shipped to any renderer.
 */
import {
  inspectionApprovals,
  inspectionSignatures,
  inspections,
  riskAssessmentControls,
  riskAssessmentHazards,
  riskAssessments,
  sites,
  templateVersions,
  templates,
  user,
} from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

export interface InspectionRenderSnapshot {
  inspection: {
    id: string;
    tenantId: string;
    title: string;
    documentNumber: string | null;
    status: string;
    conductedBy: string | null;
    conductedByName: string | null;
    siteId: string | null;
    siteName: string | null;
    responses: Record<string, unknown>;
    score: { total: number; max: number; percentage: number } | null;
    startedAt: string;
    submittedAt: string | null;
    completedAt: string | null;
    rejectedAt: string | null;
    rejectedReason: string | null;
    createdBy: string;
  };
  template: {
    id: string;
    name: string;
    versionId: string;
    versionNumber: number;
    /** The raw TemplateContent — renderers walk pages/sections/items. */
    content: unknown;
  };
  signatures: Array<{
    id: string;
    slotIndex: number;
    slotId: string;
    signerUserId: string;
    signerName: string;
    signerRole: string | null;
    signatureData: string;
    signedAt: string;
  }>;
  approvals: Array<{
    id: string;
    decision: string;
    approverUserId: string;
    comment: string | null;
    decidedAt: string;
  }>;
}

/**
 * Load an inspection and every dependent row into a renderer-ready
 * snapshot. Returns `null` if the inspection doesn't exist in the
 * requested tenant — share-link code maps this to 404.
 */
export async function loadInspectionSnapshot(
  db: Database,
  input: { tenantId: string; inspectionId: string },
): Promise<InspectionRenderSnapshot | null> {
  const inspRows = await db
    .select()
    .from(inspections)
    .where(and(eq(inspections.tenantId, input.tenantId), eq(inspections.id, input.inspectionId)))
    .limit(1);
  const insp = inspRows[0];
  if (insp === undefined) return null;

  const verRows = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.id, insp.templateVersionId))
    .limit(1);
  const ver = verRows[0];
  if (ver === undefined) return null;

  const tplRows = await db
    .select({ id: templates.id, name: templates.name })
    .from(templates)
    .where(eq(templates.id, insp.templateId))
    .limit(1);
  const tpl = tplRows[0];
  if (tpl === undefined) return null;

  const sigs = await db
    .select()
    .from(inspectionSignatures)
    .where(
      and(
        eq(inspectionSignatures.tenantId, input.tenantId),
        eq(inspectionSignatures.inspectionId, insp.id),
      ),
    )
    .orderBy(inspectionSignatures.slotIndex);

  const apps = await db
    .select()
    .from(inspectionApprovals)
    .where(
      and(
        eq(inspectionApprovals.tenantId, input.tenantId),
        eq(inspectionApprovals.inspectionId, insp.id),
      ),
    )
    .orderBy(inspectionApprovals.decidedAt);

  // Resolve names for the report's title page.
  const [siteRow] = insp.siteId
    ? await db.select({ name: sites.name }).from(sites).where(eq(sites.id, insp.siteId)).limit(1)
    : [];
  const [conductedByRow] = insp.conductedBy
    ? await db.select({ name: user.name }).from(user).where(eq(user.id, insp.conductedBy)).limit(1)
    : [];

  return {
    inspection: {
      id: insp.id,
      tenantId: insp.tenantId,
      title: insp.title,
      documentNumber: insp.documentNumber,
      status: insp.status,
      conductedBy: insp.conductedBy,
      conductedByName: conductedByRow?.name ?? null,
      siteId: insp.siteId,
      siteName: siteRow?.name ?? null,
      responses: insp.responses,
      score: insp.score,
      startedAt: insp.startedAt.toISOString(),
      submittedAt: insp.submittedAt?.toISOString() ?? null,
      completedAt: insp.completedAt?.toISOString() ?? null,
      rejectedAt: insp.rejectedAt?.toISOString() ?? null,
      rejectedReason: insp.rejectedReason,
      createdBy: insp.createdBy,
    },
    template: {
      id: tpl.id,
      name: tpl.name,
      versionId: ver.id,
      versionNumber: ver.versionNumber,
      content: ver.content,
    },
    signatures: sigs.map((s) => ({
      id: s.id,
      slotIndex: s.slotIndex,
      slotId: s.slotId,
      signerUserId: s.signerUserId,
      signerName: s.signerName,
      signerRole: s.signerRole,
      signatureData: s.signatureData,
      signedAt: s.signedAt.toISOString(),
    })),
    approvals: apps.map((a) => ({
      id: a.id,
      decision: a.decision,
      approverUserId: a.approverUserId,
      comment: a.comment,
      decidedAt: a.decidedAt.toISOString(),
    })),
  };
}

/**
 * Stable content hash for cache keys. Hashes the fields that could
 * plausibly change the rendered output. We deliberately omit the
 * `tenantId` (already in the R2 path) and `updatedAt` (updated on
 * autosaves that do not affect completed content).
 */
export function hashInspectionSnapshot(snap: InspectionRenderSnapshot): string {
  const stable = {
    inspection: {
      id: snap.inspection.id,
      title: snap.inspection.title,
      documentNumber: snap.inspection.documentNumber,
      status: snap.inspection.status,
      conductedBy: snap.inspection.conductedBy,
      siteId: snap.inspection.siteId,
      responses: snap.inspection.responses,
      score: snap.inspection.score,
      completedAt: snap.inspection.completedAt,
      rejectedAt: snap.inspection.rejectedAt,
      rejectedReason: snap.inspection.rejectedReason,
    },
    templateVersionId: snap.template.versionId,
    signatures: snap.signatures.map((s) => ({
      slotIndex: s.slotIndex,
      slotId: s.slotId,
      signerUserId: s.signerUserId,
      signerName: s.signerName,
      signerRole: s.signerRole,
      signedAt: s.signedAt,
    })),
    approvals: snap.approvals.map((a) => ({
      decision: a.decision,
      approverUserId: a.approverUserId,
      decidedAt: a.decidedAt,
    })),
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

// ── Risk assessments (FreeHS module B1) ─────────────────────────────────────

export interface RiskAssessmentRenderSnapshot {
  assessment: {
    id: string;
    tenantId: string;
    referenceNumber: string | null;
    title: string;
    activity: string;
    type: string;
    status: string;
    siteName: string | null;
    matrix: { lowMax: number; mediumMax: number; highMax: number };
    createdByName: string | null;
    publishedAt: string | null;
    nextReviewAt: string | null;
    createdAt: string;
  };
  hazards: Array<{
    id: string;
    hazard: string;
    harmDescription: string;
    affectedGroups: ReadonlyArray<string>;
    initialLikelihood: number | null;
    initialSeverity: number | null;
    existingControls: string;
    residualLikelihood: number | null;
    residualSeverity: number | null;
    controls: Array<{
      id: string;
      description: string;
      tier: string;
      status: string;
      ppeJustification: string | null;
    }>;
  }>;
}

/**
 * Load a risk assessment into a renderer-ready snapshot. Returns `null`
 * when the assessment doesn't exist in the requested tenant.
 */
export async function loadRiskAssessmentSnapshot(
  db: Database,
  input: { tenantId: string; assessmentId: string },
): Promise<RiskAssessmentRenderSnapshot | null> {
  const raRows = await db
    .select()
    .from(riskAssessments)
    .where(
      and(eq(riskAssessments.tenantId, input.tenantId), eq(riskAssessments.id, input.assessmentId)),
    )
    .limit(1);
  const ra = raRows[0];
  if (ra === undefined) return null;

  const hazardRows = await db
    .select()
    .from(riskAssessmentHazards)
    .where(eq(riskAssessmentHazards.assessmentId, ra.id))
    .orderBy(riskAssessmentHazards.sortOrder, riskAssessmentHazards.createdAt);
  const controlRows = await db
    .select()
    .from(riskAssessmentControls)
    .where(eq(riskAssessmentControls.assessmentId, ra.id))
    .orderBy(riskAssessmentControls.createdAt);

  let siteName: string | null = null;
  if (ra.siteId !== null) {
    const siteRows = await db
      .select({ name: sites.name })
      .from(sites)
      .where(eq(sites.id, ra.siteId))
      .limit(1);
    siteName = siteRows[0]?.name ?? null;
  }
  const creatorRows = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, ra.createdBy))
    .limit(1);

  return {
    assessment: {
      id: ra.id,
      tenantId: ra.tenantId,
      referenceNumber: ra.referenceNumber,
      title: ra.title,
      activity: ra.activity,
      type: ra.type,
      status: ra.status,
      siteName,
      matrix: ra.matrix,
      createdByName: creatorRows[0]?.name ?? null,
      publishedAt: ra.publishedAt?.toISOString() ?? null,
      nextReviewAt: ra.nextReviewAt?.toISOString() ?? null,
      createdAt: ra.createdAt.toISOString(),
    },
    hazards: hazardRows.map((h) => ({
      id: h.id,
      hazard: h.hazard,
      harmDescription: h.harmDescription,
      affectedGroups: h.affectedGroups,
      initialLikelihood: h.initialLikelihood,
      initialSeverity: h.initialSeverity,
      existingControls: h.existingControls,
      residualLikelihood: h.residualLikelihood,
      residualSeverity: h.residualSeverity,
      controls: controlRows
        .filter((c) => c.hazardId === h.id)
        .map((c) => ({
          id: c.id,
          description: c.description,
          tier: c.tier,
          status: c.status,
          ppeJustification: c.ppeJustification,
        })),
    })),
  };
}

/** Stable content hash for the risk-assessment PDF cache key. */
export function hashRiskAssessmentSnapshot(snap: RiskAssessmentRenderSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snap)).digest('hex');
}
