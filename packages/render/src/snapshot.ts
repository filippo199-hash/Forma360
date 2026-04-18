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
  templateVersions,
  templates,
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
    siteId: string | null;
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
    .where(
      and(eq(inspections.tenantId, input.tenantId), eq(inspections.id, input.inspectionId)),
    )
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

  return {
    inspection: {
      id: insp.id,
      tenantId: insp.tenantId,
      title: insp.title,
      documentNumber: insp.documentNumber,
      status: insp.status,
      conductedBy: insp.conductedBy,
      siteId: insp.siteId,
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
