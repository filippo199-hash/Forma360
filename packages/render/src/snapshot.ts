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
  actions,
  dashboards,
  incidentAbsences,
  incidentEvents,
  incidentEvidence,
  incidentFindings,
  incidentInvestigations,
  incidentPersons,
  incidentWitnessStatements,
  incidents,
  inspectionApprovals,
  inspectionSignatures,
  inspections,
  permitEvents,
  permits,
  permitTypes,
  riskAssessmentControls,
  riskAssessmentHazards,
  riskAssessments,
  riskAssessmentVersions,
  sites,
  templateVersions,
  templates,
  tenants,
  user,
  fireBuildings,
  fireDrills,
  fireFraReviews,
  fireFraVersions,
  fireRiskAssessments,
  fireSignificantFindings,
  ramsBriefings,
  ramsClientLinks,
  ramsPacks,
  ramsPackVersions,
} from '@forma360/db/schema';
import { totalDaysLost } from '@forma360/shared/incidents';
import type {
  GasLimit,
  GasReading,
  PermitAttachment,
  PermitEntryLogRow,
  PermitPreconditionState,
  PermitWorker,
} from '@forma360/shared/permits';
import type { RiskMatrixConfig } from '@forma360/shared/risk-matrix';
import type { RamsPackVersionContent } from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
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
  // Fall back to whoever created the run when `conductedBy` is null —
  // the same fallback `inspections.get` applies, so the screen and the
  // printed document name the same person. A report that prints
  // "Prepared by —" is not much use to whoever it is handed to.
  const conductorId = insp.conductedBy ?? insp.createdBy;
  const [conductedByRow] = conductorId
    ? await db.select({ name: user.name }).from(user).where(eq(user.id, conductorId)).limit(1)
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
    matrix: RiskMatrixConfig;
    createdByName: string | null;
    publishedAt: string | null;
    nextReviewAt: string | null;
    createdAt: string;
    /** Current published version + its first-class sign-off (M-2) —
     * null until the assessment has been published. */
    currentVersion: number;
    signedOffByName: string | null;
    signedOffAt: string | null;
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
    residualJustification: string;
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

  // The sign-off belongs to the current version's signer, not the creator
  // (M-2) — the printed record must attribute the attestation correctly.
  let signedOffByName: string | null = null;
  let signedOffAt: string | null = null;
  if (ra.currentVersion > 0) {
    const versionRows = await db
      .select({
        signedOffBy: riskAssessmentVersions.signedOffBy,
        signedOffByName: riskAssessmentVersions.signedOffByName,
        signedOffAt: riskAssessmentVersions.signedOffAt,
      })
      .from(riskAssessmentVersions)
      .where(
        and(
          eq(riskAssessmentVersions.assessmentId, ra.id),
          eq(riskAssessmentVersions.versionNumber, ra.currentVersion),
        ),
      )
      .limit(1);
    const version = versionRows[0];
    if (version !== undefined) {
      signedOffByName = version.signedOffByName ?? version.signedOffBy;
      signedOffAt = version.signedOffAt.toISOString();
    }
  }

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
      currentVersion: ra.currentVersion,
      signedOffByName,
      signedOffAt,
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
      residualJustification: h.residualJustification,
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

// ─── Permits (FreeHS module B3, HSE review PW-6) ────────────────────────────

export interface PermitRenderSnapshot {
  permit: {
    id: string;
    tenantId: string;
    referenceNumber: string | null;
    title: string;
    workDescription: string;
    status: string;
    siteName: string | null;
    locationText: string;
    validFrom: string;
    validTo: string;
    extensionCount: number;
    typeName: string;
    typeCategory: string;
    isolationCertificateRef: string;
    rescuePlan: string;
    riskAssessmentRef: string | null;
    methodStatementName: string | null;
    suspensionReason: string;
    closureNotes: string;
    closureChecks: Record<string, boolean> | null;
    cancellationReason: string;
    createdAt: string;
  };
  parties: {
    issuerName: string | null;
    issuedAt: string | null;
    acceptorName: string | null;
    acceptedAt: string | null;
    authoriserName: string | null;
    authorisedAt: string | null;
    closedByName: string | null;
    closedAt: string | null;
    cancelledByName: string | null;
    cancelledAt: string | null;
  };
  preconditions: ReadonlyArray<PermitPreconditionState>;
  gasLimits: ReadonlyArray<GasLimit>;
  gasReadings: ReadonlyArray<GasReading>;
  attachments: ReadonlyArray<PermitAttachment>;
  workers: ReadonlyArray<PermitWorker>;
  entryLog: ReadonlyArray<PermitEntryLogRow>;
  events: Array<{
    id: string;
    kind: string;
    detail: string;
    actorName: string | null;
    createdAt: string;
  }>;
}

/**
 * Load a permit into a renderer-ready snapshot — the fixed record the
 * printed permit and the audit bundle carry. Returns `null` when the
 * permit doesn't exist in the requested tenant.
 */
export async function loadPermitSnapshot(
  db: Database,
  input: { tenantId: string; permitId: string },
): Promise<PermitRenderSnapshot | null> {
  const permitRows = await db
    .select()
    .from(permits)
    .where(and(eq(permits.tenantId, input.tenantId), eq(permits.id, input.permitId)))
    .limit(1);
  const permit = permitRows[0];
  if (permit === undefined) return null;

  const typeRows = await db
    .select({
      name: permitTypes.name,
      category: permitTypes.category,
      gasLimits: permitTypes.gasLimits,
    })
    .from(permitTypes)
    .where(eq(permitTypes.id, permit.permitTypeId))
    .limit(1);
  const type = typeRows[0];

  let siteName: string | null = null;
  if (permit.siteId !== null) {
    const siteRows = await db
      .select({ name: sites.name })
      .from(sites)
      .where(eq(sites.id, permit.siteId))
      .limit(1);
    siteName = siteRows[0]?.name ?? null;
  }

  let riskAssessmentRef: string | null = null;
  if (permit.riskAssessmentId !== null) {
    const raRows = await db
      .select({ title: riskAssessments.title, referenceNumber: riskAssessments.referenceNumber })
      .from(riskAssessments)
      .where(eq(riskAssessments.id, permit.riskAssessmentId))
      .limit(1);
    const ra = raRows[0];
    if (ra !== undefined) {
      riskAssessmentRef =
        ra.referenceNumber !== null ? `${ra.referenceNumber} — ${ra.title}` : ra.title;
    }
  }

  const eventRows = await db
    .select()
    .from(permitEvents)
    .where(and(eq(permitEvents.tenantId, input.tenantId), eq(permitEvents.permitId, permit.id)))
    .orderBy(permitEvents.createdAt);

  const nameIds = [
    permit.issuerUserId,
    permit.acceptorUserId,
    permit.authoriserUserId,
    permit.closedBy,
    permit.cancelledBy,
    ...eventRows.map((e) => e.actorUserId),
  ].filter((v): v is string => v !== null && v !== 'system');
  const nameMap = new Map<string, string>();
  for (const id of [...new Set(nameIds)]) {
    const rows = await db.select({ name: user.name }).from(user).where(eq(user.id, id)).limit(1);
    const found = rows[0];
    if (found !== undefined) nameMap.set(id, found.name);
  }
  const nameOf = (id: string | null): string | null =>
    id === null ? null : (nameMap.get(id) ?? null);
  const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

  return {
    permit: {
      id: permit.id,
      tenantId: permit.tenantId,
      referenceNumber: permit.referenceNumber,
      title: permit.title,
      workDescription: permit.workDescription,
      status: permit.status,
      siteName,
      locationText: permit.locationText,
      validFrom: permit.validFrom.toISOString(),
      validTo: permit.validTo.toISOString(),
      extensionCount: permit.extensionCount,
      typeName: type?.name ?? '',
      typeCategory: type?.category ?? 'other',
      isolationCertificateRef: permit.isolationCertificateRef,
      rescuePlan: permit.rescuePlan,
      riskAssessmentRef,
      methodStatementName: null,
      suspensionReason: permit.suspensionReason,
      closureNotes: permit.closureNotes,
      closureChecks: permit.closureChecks,
      cancellationReason: permit.cancellationReason,
      createdAt: permit.createdAt.toISOString(),
    },
    parties: {
      issuerName: nameOf(permit.issuerUserId),
      issuedAt: iso(permit.issuedAt),
      acceptorName: nameOf(permit.acceptorUserId),
      acceptedAt: iso(permit.acceptedAt),
      authoriserName: nameOf(permit.authoriserUserId),
      authorisedAt: iso(permit.authorisedAt),
      closedByName: nameOf(permit.closedBy),
      closedAt: iso(permit.closedAt),
      cancelledByName: nameOf(permit.cancelledBy),
      cancelledAt: iso(permit.cancelledAt),
    },
    preconditions: permit.preconditions,
    gasLimits: type?.gasLimits ?? [],
    gasReadings: permit.gasReadings,
    attachments: permit.attachments,
    workers: permit.workers,
    entryLog: permit.entryLog,
    events: eventRows.map((e) => ({
      id: e.id,
      kind: e.kind,
      detail: e.detail,
      actorName: e.actorUserId === 'system' ? null : (nameMap.get(e.actorUserId) ?? null),
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/** Stable content hash for the permit PDF cache key. */
export function hashPermitSnapshot(snap: PermitRenderSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snap)).digest('hex');
}

// ─── Fire risk assessment (FreeHS module B4, HSE review FS-5) ───────────────

export interface FraRenderSnapshot {
  fra: {
    id: string;
    tenantId: string;
    referenceNumber: string | null;
    title: string;
    status: string;
    methodology: string;
    premisesDescription: string;
    responsiblePersonName: string;
    assessorName: string;
    personsAtRisk: ReadonlyArray<string>;
    maxOccupancy: number | null;
    sleepingOccupants: boolean;
    ignitionSources: string;
    fuelSources: string;
    oxygenSources: string;
    evaluationNotes: string;
    riskRating: string | null;
    publishedAt: string | null;
    publishedByName: string | null;
    nextReviewAt: string | null;
    reviewFrequencyMonths: number | null;
    createdAt: string;
    /** FS-7: true when content changed after the recorded sign-off. */
    attestationStale: boolean;
  };
  building: {
    name: string;
    address: string;
    isResidential: boolean;
    heightMetres: number | null;
    storeys: number | null;
  } | null;
  findings: Array<{
    id: string;
    category: string;
    priority: string;
    description: string;
    requiresAction: boolean;
    resolvedAt: string | null;
    hasAction: boolean;
  }>;
  reviews: Array<{
    trigger: string;
    outcome: string;
    note: string;
    reviewedAt: string;
    reviewedByName: string | null;
  }>;
}

/**
 * Load a fire risk assessment into a renderer-ready snapshot — the
 * document the Responsible Person files or hands to the enforcing
 * authority. Returns `null` when the FRA doesn't exist in the tenant.
 */
export async function loadFraSnapshot(
  db: Database,
  input: { tenantId: string; fraId: string },
): Promise<FraRenderSnapshot | null> {
  const fraRows = await db
    .select()
    .from(fireRiskAssessments)
    .where(
      and(
        eq(fireRiskAssessments.tenantId, input.tenantId),
        eq(fireRiskAssessments.id, input.fraId),
      ),
    )
    .limit(1);
  const fraRow = fraRows[0];
  if (fraRow === undefined) return null;

  /**
   * FS-G05: a signed FRA renders the SIGNED content, not the live row.
   *
   * The PDF is the artefact that leaves the building — filed with the
   * managing agent, emailed to the enforcing authority. Rendering the
   * mutable working row under the original `publishedAt` / `publishedBy`
   * header is the same defect the version table exists to close, wearing a
   * different hat: the reader sees today's text above yesterday's
   * signature and has no way to tell.
   *
   * A draft renders live (there is nothing signed yet), and an FRA signed
   * before versioning existed has no snapshot to fall back on — it renders
   * live too, which is the honest best available.
   */
  const versionRows =
    fraRow.currentVersion > 0
      ? await db
          .select({ content: fireFraVersions.content })
          .from(fireFraVersions)
          .where(and(eq(fireFraVersions.fraId, fraRow.id), isNull(fireFraVersions.supersededAt)))
          .limit(1)
      : [];
  const signed = versionRows[0]?.content ?? null;
  const fra = fraRow;

  const [liveFindings, reviewRows] = await Promise.all([
    db.select().from(fireSignificantFindings).where(eq(fireSignificantFindings.fraId, fra.id)),
    db.select().from(fireFraReviews).where(eq(fireFraReviews.fraId, fra.id)),
  ]);
  const findingRows = liveFindings;
  findingRows.sort((a, b) => a.sortOrder - b.sortOrder || (a.createdAt < b.createdAt ? -1 : 1));
  reviewRows.sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1));

  let building: FraRenderSnapshot['building'] = null;
  if (fra.buildingId !== null) {
    const buildingRows = await db
      .select({
        name: fireBuildings.name,
        address: fireBuildings.address,
        isResidential: fireBuildings.isResidential,
        heightMetres: fireBuildings.heightMetres,
        storeys: fireBuildings.storeys,
      })
      .from(fireBuildings)
      .where(eq(fireBuildings.id, fra.buildingId))
      .limit(1);
    building = buildingRows[0] ?? null;
  }

  const nameIds = [fra.publishedBy, ...reviewRows.map((r) => r.reviewedBy)].filter(
    (v): v is string => v !== null,
  );
  const nameRows =
    nameIds.length > 0
      ? await db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(and(eq(user.tenantId, input.tenantId), inArray(user.id, nameIds)))
      : [];
  const names = new Map(nameRows.map((r) => [r.id, r.name]));

  return {
    fra: {
      id: fra.id,
      tenantId: fra.tenantId,
      referenceNumber: fra.referenceNumber,
      title: signed?.title ?? fra.title,
      status: fra.status,
      methodology: signed?.methodology ?? fra.methodology,
      // FS-G05: every content field prefers the SIGNED copy. The PDF is
      // the artefact that leaves the building — filed with the managing
      // agent, emailed to the enforcing authority — so rendering the
      // mutable working row under the original sign-off header would be
      // the same defect the version table exists to close, wearing a
      // different hat: today's text above yesterday's signature, with no
      // way for the reader to tell. A draft has nothing signed yet, and an
      // FRA signed before versioning existed has no snapshot, so both fall
      // back to live — the honest best available.
      premisesDescription: signed?.premisesDescription ?? fra.premisesDescription,
      responsiblePersonName: signed?.responsiblePersonName ?? fra.responsiblePersonName,
      assessorName: signed?.assessorName ?? fra.assessorName,
      personsAtRisk: signed?.personsAtRisk ?? fra.personsAtRisk,
      maxOccupancy: signed?.maxOccupancy ?? fra.maxOccupancy,
      sleepingOccupants: signed?.sleepingOccupants ?? fra.sleepingOccupants,
      ignitionSources: signed?.ignitionSources ?? fra.ignitionSources,
      fuelSources: signed?.fuelSources ?? fra.fuelSources,
      oxygenSources: signed?.oxygenSources ?? fra.oxygenSources,
      evaluationNotes: signed?.evaluationNotes ?? fra.evaluationNotes,
      riskRating: signed?.riskRating ?? fra.riskRating,
      publishedAt: fra.publishedAt?.toISOString() ?? null,
      publishedByName: fra.publishedBy !== null ? (names.get(fra.publishedBy) ?? null) : null,
      nextReviewAt: fra.nextReviewAt?.toISOString() ?? null,
      reviewFrequencyMonths: fra.reviewFrequencyMonths,
      createdAt: fra.createdAt.toISOString(),
      attestationStale:
        fra.status === 'active' &&
        fra.publishedAt !== null &&
        fra.contentUpdatedAt !== null &&
        fra.contentUpdatedAt.getTime() > fra.publishedAt.getTime(),
    },
    building,
    // Findings are content too — the schema comment names them alongside
    // the narrative and the rating — so the signed copy wins for them as
    // well. `hasAction` is deliberately read from the LIVE row: whether a
    // finding produced an action is a fact about the world after
    // sign-off, not part of what was signed.
    findings: (signed?.findings ?? findingRows).map((f) => ({
      id: f.id,
      category: f.category,
      priority: f.priority,
      description: f.description,
      requiresAction: f.requiresAction,
      resolvedAt:
        typeof f.resolvedAt === 'string' ? f.resolvedAt : (f.resolvedAt?.toISOString() ?? null),
      hasAction: findingRows.find((l) => l.id === f.id)?.actionId != null,
    })),
    reviews: reviewRows.map((r) => ({
      trigger: r.trigger,
      outcome: r.outcome,
      note: r.note,
      reviewedAt: r.reviewedAt.toISOString(),
      reviewedByName: names.get(r.reviewedBy) ?? null,
    })),
  };
}

export function hashFraSnapshot(snap: FraRenderSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snap)).digest('hex');
}

// ─── Fire drill record (FreeHS module B4) ───────────────────────────────────

export interface DrillRenderSnapshot {
  drill: {
    id: string;
    tenantId: string;
    conductedAt: string;
    conductedByName: string | null;
    /** Alarm-to-clear time; null when not measured. */
    evacuationSeconds: number | null;
    peoplePresent: number | null;
    peopleAccountedFor: number | null;
    rollComplete: boolean;
    notes: string;
    lessonsLearned: string;
    createdAt: string;
  };
  building: {
    name: string;
    address: string;
  };
  tenantName: string | null;
}

/**
 * Load a fire drill into a renderer-ready snapshot — the drill record
 * as it goes into the logbook file: when, who ran it, evacuation time,
 * muster roll and lessons learned. Returns `null` when the drill
 * doesn't exist in the tenant.
 */
export async function loadDrillSnapshot(
  db: Database,
  input: { tenantId: string; drillId: string },
): Promise<DrillRenderSnapshot | null> {
  const rows = await db
    .select({
      drill: fireDrills,
      buildingName: fireBuildings.name,
      buildingAddress: fireBuildings.address,
    })
    .from(fireDrills)
    .innerJoin(fireBuildings, eq(fireDrills.buildingId, fireBuildings.id))
    .where(and(eq(fireDrills.tenantId, input.tenantId), eq(fireDrills.id, input.drillId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;

  const [tenantRows, nameRows] = await Promise.all([
    db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, input.tenantId)).limit(1),
    db
      .select({ name: user.name })
      .from(user)
      .where(and(eq(user.tenantId, input.tenantId), eq(user.id, row.drill.conductedBy)))
      .limit(1),
  ]);

  return {
    drill: {
      id: row.drill.id,
      tenantId: row.drill.tenantId,
      conductedAt: row.drill.conductedAt.toISOString(),
      conductedByName: nameRows[0]?.name ?? null,
      evacuationSeconds: row.drill.evacuationSeconds,
      peoplePresent: row.drill.peoplePresent,
      peopleAccountedFor: row.drill.peopleAccountedFor,
      rollComplete: row.drill.rollComplete,
      notes: row.drill.notes,
      lessonsLearned: row.drill.lessonsLearned,
      createdAt: row.drill.createdAt.toISOString(),
    },
    building: {
      name: row.buildingName,
      address: row.buildingAddress,
    },
    tenantName: tenantRows[0]?.name ?? null,
  };
}

/** Stable content hash for the drill PDF cache key. */
export function hashDrillSnapshot(snap: DrillRenderSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snap)).digest('hex');
}

// ─── Incident report (FreeHS module B5) ─────────────────────────────────────

export interface IncidentRenderSnapshot {
  incident: {
    id: string;
    tenantId: string;
    referenceNumber: string;
    title: string;
    description: string;
    kind: string;
    severity: string;
    potentialSeverity: string | null;
    status: string;
    confidential: boolean;
    occurredAt: string;
    reportedAt: string;
    reportedByName: string | null;
    siteName: string | null;
    locationText: string;
    details: Record<string, unknown>;
    investigationLevel: string | null;
    leadInvestigatorName: string | null;
    riddorCategory: string | null;
    riddorDeterminationNote: string;
    riddorScreenedByName: string | null;
    riddorScreenedAt: string | null;
    riddorDeadlineAt: string | null;
    riddorSubmittedAt: string | null;
    riddorSubmittedByName: string | null;
    riddorSubmissionRoute: string | null;
    riddorHseReference: string | null;
    closedByName: string | null;
    closedAt: string | null;
    effectivenessDueAt: string | null;
    effectivenessVerdict: string | null;
    effectivenessNote: string;
    createdAt: string;
  };
  persons: Array<{
    name: string;
    category: string;
    injury: Record<string, unknown>;
    ohFollowUpRequired: boolean;
    returnedToWork: boolean;
    onRestrictedDuties: boolean;
    daysLost: number;
  }>;
  totalDaysLost: number;
  investigations: Array<{
    revision: number;
    method: string | null;
    immediateCause: string;
    underlyingCause: string;
    contributingFactors: ReadonlyArray<string>;
    whyChain: ReadonlyArray<{ text: string; isRootCause: boolean }> | null;
    causalFactors: ReadonlyArray<{ category: string; narrative: string }> | null;
    timelineEntries: ReadonlyArray<{ at: string; text: string }>;
    conclusionSummary: string;
    rootCauseStatement: string;
    recurrenceLikelihood: string | null;
    lessonsLearned: string;
    status: string;
    submittedByName: string | null;
    submittedAt: string | null;
    approvedByName: string | null;
    approvedAt: string | null;
  }>;
  findings: Array<{
    category: string;
    priority: string;
    description: string;
    requiresAction: boolean;
    actionReference: string | null;
    actionStatus: string | null;
  }>;
  evidence: Array<{
    kind: string;
    filename: string | null;
    caption: string;
    collectedByName: string | null;
    collectedAt: string;
  }>;
  witnesses: Array<{
    witnessName: string;
    statement: string;
    takenByName: string | null;
    takenAt: string;
    signed: boolean;
  }>;
  linkedActions: Array<{
    referenceNumber: string | null;
    title: string;
    status: string;
    assigneeName: string | null;
    dueAt: string | null;
  }>;
  events: Array<{
    id: string;
    kind: string;
    detail: Record<string, unknown>;
    actorName: string | null;
    createdAt: string;
  }>;
}

/**
 * Load an incident into a renderer-ready snapshot — the single-document
 * record (incident + investigation + signatures) an insurer pack or an
 * audit sample needs. Returns `null` when the incident doesn't exist in
 * the requested tenant.
 */
export async function loadIncidentSnapshot(
  db: Database,
  input: { tenantId: string; incidentId: string },
): Promise<IncidentRenderSnapshot | null> {
  const incidentRows = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.tenantId, input.tenantId), eq(incidents.id, input.incidentId)))
    .limit(1);
  const incident = incidentRows[0];
  if (incident === undefined) return null;

  const [
    personRows,
    absenceRows,
    investigationRows,
    findingRows,
    evidenceRows,
    witnessRows,
    actionRows,
    eventRows,
    siteRow,
  ] = await Promise.all([
    db
      .select()
      .from(incidentPersons)
      .where(
        and(
          eq(incidentPersons.tenantId, input.tenantId),
          eq(incidentPersons.incidentId, incident.id),
        ),
      )
      .orderBy(asc(incidentPersons.createdAt)),
    db
      .select()
      .from(incidentAbsences)
      .where(
        and(
          eq(incidentAbsences.tenantId, input.tenantId),
          eq(incidentAbsences.incidentId, incident.id),
        ),
      ),
    db
      .select()
      .from(incidentInvestigations)
      .where(
        and(
          eq(incidentInvestigations.tenantId, input.tenantId),
          eq(incidentInvestigations.incidentId, incident.id),
        ),
      )
      .orderBy(asc(incidentInvestigations.revision)),
    db
      .select()
      .from(incidentFindings)
      .where(
        and(
          eq(incidentFindings.tenantId, input.tenantId),
          eq(incidentFindings.incidentId, incident.id),
        ),
      )
      .orderBy(asc(incidentFindings.createdAt)),
    db
      .select()
      .from(incidentEvidence)
      .where(
        and(
          eq(incidentEvidence.tenantId, input.tenantId),
          eq(incidentEvidence.incidentId, incident.id),
        ),
      )
      .orderBy(asc(incidentEvidence.createdAt)),
    db
      .select()
      .from(incidentWitnessStatements)
      .where(
        and(
          eq(incidentWitnessStatements.tenantId, input.tenantId),
          eq(incidentWitnessStatements.incidentId, incident.id),
        ),
      )
      .orderBy(asc(incidentWitnessStatements.createdAt)),
    db
      .select({
        referenceNumber: actions.referenceNumber,
        title: actions.title,
        status: actions.status,
        assigneeUserId: actions.assigneeUserId,
        dueAt: actions.dueAt,
        id: actions.id,
      })
      .from(actions)
      .where(
        and(
          eq(actions.tenantId, input.tenantId),
          eq(actions.sourceType, 'incident'),
          eq(actions.sourceId, incident.id),
        ),
      )
      .orderBy(asc(actions.createdAt)),
    db
      .select()
      .from(incidentEvents)
      .where(
        and(
          eq(incidentEvents.tenantId, input.tenantId),
          eq(incidentEvents.incidentId, incident.id),
        ),
      )
      .orderBy(asc(incidentEvents.createdAt))
      .limit(300),
    incident.siteId === null
      ? Promise.resolve(null)
      : db
          .select({ name: sites.name })
          .from(sites)
          .where(and(eq(sites.tenantId, input.tenantId), eq(sites.id, incident.siteId)))
          .limit(1)
          .then((rows) => rows[0] ?? null),
  ]);

  // Resolve display names in one query.
  const nameIds = new Set<string>([incident.reportedByUserId]);
  if (incident.leadInvestigatorUserId !== null) nameIds.add(incident.leadInvestigatorUserId);
  if (incident.riddorScreenedByUserId !== null) nameIds.add(incident.riddorScreenedByUserId);
  if (incident.riddorSubmittedByUserId !== null) nameIds.add(incident.riddorSubmittedByUserId);
  if (incident.closedByUserId !== null) nameIds.add(incident.closedByUserId);
  for (const row of investigationRows) {
    if (row.submittedByUserId !== null) nameIds.add(row.submittedByUserId);
    if (row.approvedByUserId !== null) nameIds.add(row.approvedByUserId);
  }
  for (const row of evidenceRows) nameIds.add(row.collectedByUserId);
  for (const row of witnessRows) nameIds.add(row.takenByUserId);
  for (const row of eventRows) nameIds.add(row.actorUserId);
  for (const row of actionRows) {
    if (row.assigneeUserId !== null) nameIds.add(row.assigneeUserId);
  }
  const userRows =
    nameIds.size === 0
      ? []
      : await db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(and(eq(user.tenantId, input.tenantId), inArray(user.id, [...nameIds])));
  const names = new Map(userRows.map((row) => [row.id, row.name]));
  const nameOf = (id: string | null): string | null =>
    id === null ? null : (names.get(id) ?? null);

  const nowIso = new Date().toISOString().slice(0, 10);
  const occurredIso = incident.occurredAt.toISOString().slice(0, 10);
  const absencesByPerson = new Map<string, Array<{ fromDate: string; toDate: string | null }>>();
  for (const row of absenceRows) {
    const list = absencesByPerson.get(row.personId) ?? [];
    list.push({ fromDate: row.fromDate, toDate: row.toDate });
    absencesByPerson.set(row.personId, list);
  }

  const actionRefById = new Map(actionRows.map((row) => [row.id, row]));

  return {
    incident: {
      id: incident.id,
      tenantId: incident.tenantId,
      referenceNumber: incident.referenceNumber,
      title: incident.title,
      description: incident.description,
      kind: incident.kind,
      severity: incident.severity,
      potentialSeverity: incident.potentialSeverity,
      status: incident.status,
      confidential: incident.confidential,
      occurredAt: incident.occurredAt.toISOString(),
      reportedAt: incident.reportedAt.toISOString(),
      reportedByName: nameOf(incident.reportedByUserId),
      siteName: siteRow?.name ?? null,
      locationText: incident.locationText,
      details: incident.details,
      investigationLevel: incident.investigationLevel,
      leadInvestigatorName: nameOf(incident.leadInvestigatorUserId),
      riddorCategory: incident.riddorCategory,
      riddorDeterminationNote: incident.riddorDeterminationNote,
      riddorScreenedByName: nameOf(incident.riddorScreenedByUserId),
      riddorScreenedAt: incident.riddorScreenedAt?.toISOString() ?? null,
      riddorDeadlineAt: incident.riddorDeadlineAt?.toISOString() ?? null,
      riddorSubmittedAt: incident.riddorSubmittedAt?.toISOString() ?? null,
      riddorSubmittedByName: nameOf(incident.riddorSubmittedByUserId),
      riddorSubmissionRoute: incident.riddorSubmissionRoute,
      riddorHseReference: incident.riddorHseReference,
      closedByName: nameOf(incident.closedByUserId),
      closedAt: incident.closedAt?.toISOString() ?? null,
      effectivenessDueAt: incident.effectivenessDueAt?.toISOString() ?? null,
      effectivenessVerdict: incident.effectivenessVerdict,
      effectivenessNote: incident.effectivenessNote,
      createdAt: incident.createdAt.toISOString(),
    },
    persons: personRows.map((row) => ({
      name: row.name,
      category: row.category,
      injury: row.injury as Record<string, unknown>,
      ohFollowUpRequired: row.ohFollowUpRequired,
      returnedToWork: row.returnedToWork,
      onRestrictedDuties: row.onRestrictedDuties,
      daysLost: totalDaysLost(absencesByPerson.get(row.id) ?? [], occurredIso, nowIso),
    })),
    totalDaysLost: totalDaysLost(
      absenceRows.map((row) => ({ fromDate: row.fromDate, toDate: row.toDate })),
      occurredIso,
      nowIso,
    ),
    investigations: investigationRows.map((row) => ({
      revision: row.revision,
      method: row.method,
      immediateCause: row.immediateCause,
      underlyingCause: row.underlyingCause,
      contributingFactors: row.contributingFactors,
      whyChain: row.whyChain,
      causalFactors: row.causalFactors,
      timelineEntries: row.timelineEntries,
      conclusionSummary: row.conclusionSummary,
      rootCauseStatement: row.rootCauseStatement,
      recurrenceLikelihood: row.recurrenceLikelihood,
      lessonsLearned: row.lessonsLearned,
      status: row.status,
      submittedByName: nameOf(row.submittedByUserId),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      approvedByName: nameOf(row.approvedByUserId),
      approvedAt: row.approvedAt?.toISOString() ?? null,
    })),
    findings: findingRows.map((row) => {
      const action = row.actionId === null ? undefined : actionRefById.get(row.actionId);
      return {
        category: row.category,
        priority: row.priority,
        description: row.description,
        requiresAction: row.requiresAction,
        actionReference: action?.referenceNumber ?? null,
        actionStatus: action?.status ?? null,
      };
    }),
    evidence: evidenceRows.map((row) => ({
      kind: row.kind,
      filename: row.filename,
      caption: row.caption,
      collectedByName: nameOf(row.collectedByUserId),
      collectedAt: row.collectedAt.toISOString(),
    })),
    witnesses: witnessRows.map((row) => ({
      witnessName: row.witnessName,
      statement: row.statement,
      takenByName: nameOf(row.takenByUserId),
      takenAt: row.takenAt.toISOString(),
      signed: row.signatureData !== null,
    })),
    linkedActions: actionRows.map((row) => ({
      referenceNumber: row.referenceNumber,
      title: row.title,
      status: row.status,
      assigneeName: nameOf(row.assigneeUserId),
      dueAt: row.dueAt?.toISOString() ?? null,
    })),
    events: eventRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      detail: row.detail,
      actorName: row.actorUserId === 'system' ? null : nameOf(row.actorUserId),
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/** Stable content hash for the incident PDF cache key. */
export function hashIncidentSnapshot(snap: IncidentRenderSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snap)).digest('hex');
}

// ─── RAMS pack (FreeHS module B6) ───────────────────────────────────────────

export interface RamsRenderSnapshot {
  pack: {
    id: string;
    tenantId: string;
    referenceNumber: string | null;
    title: string;
    status: string;
    withdrawnReason: string;
  };
  version: {
    id: string;
    versionNumber: number;
    issuedAt: string;
    issuedByName: string | null;
    attestationText: string;
    supersededAt: string | null;
    /** The frozen snapshot — job context, steps, bindings, documents. */
    content: RamsPackVersionContent;
  };
  /** Briefings against THIS version — the "who was briefed" page. */
  briefings: Array<{
    name: string;
    organisation: string;
    category: string;
    briefedByName: string;
    briefedAt: string;
    hasSignature: boolean;
    questionsNote: string;
  }>;
  /** Client acceptance recorded against this version, if any. */
  acceptance: {
    decision: string;
    acceptedByName: string;
    acceptedByOrganisation: string;
    decidedAt: string | null;
    comment: string;
  } | null;
}

/**
 * Load everything the RAMS pack PDF prints. Reads the FROZEN version
 * row, never the mutable pack content — a pack issued at v1 always
 * renders as it was issued (ADR 0007 / RS-E07). Returns null when the
 * version does not exist in this tenant.
 */
export async function loadRamsSnapshot(
  db: Database,
  input: { tenantId: string; packVersionId: string },
): Promise<RamsRenderSnapshot | null> {
  const rows = await db
    .select({
      packId: ramsPacks.id,
      tenantId: ramsPacks.tenantId,
      referenceNumber: ramsPacks.referenceNumber,
      title: ramsPacks.title,
      status: ramsPacks.status,
      withdrawnReason: ramsPacks.withdrawnReason,
      versionId: ramsPackVersions.id,
      versionNumber: ramsPackVersions.versionNumber,
      issuedAt: ramsPackVersions.issuedAt,
      issuedByName: ramsPackVersions.issuedByName,
      attestationText: ramsPackVersions.attestationText,
      supersededAt: ramsPackVersions.supersededAt,
      content: ramsPackVersions.content,
    })
    .from(ramsPackVersions)
    .innerJoin(ramsPacks, eq(ramsPacks.id, ramsPackVersions.packId))
    .where(
      and(
        eq(ramsPackVersions.tenantId, input.tenantId),
        eq(ramsPackVersions.id, input.packVersionId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;

  const [briefingRows, linkRows] = await Promise.all([
    db
      .select()
      .from(ramsBriefings)
      .where(
        and(
          eq(ramsBriefings.tenantId, input.tenantId),
          eq(ramsBriefings.packVersionId, row.versionId),
        ),
      )
      .orderBy(asc(ramsBriefings.briefedAt)),
    db
      .select()
      .from(ramsClientLinks)
      .where(
        and(
          eq(ramsClientLinks.tenantId, input.tenantId),
          eq(ramsClientLinks.packVersionId, row.versionId),
        ),
      )
      .orderBy(desc(ramsClientLinks.decidedAt)),
  ]);

  const decided = linkRows.find((l) => l.decision !== 'pending');

  return {
    pack: {
      id: row.packId,
      tenantId: row.tenantId,
      referenceNumber: row.referenceNumber,
      title: row.title,
      status: row.status,
      withdrawnReason: row.withdrawnReason,
    },
    version: {
      id: row.versionId,
      versionNumber: row.versionNumber,
      issuedAt: row.issuedAt.toISOString(),
      issuedByName: row.issuedByName,
      attestationText: row.attestationText,
      supersededAt: row.supersededAt?.toISOString() ?? null,
      content: row.content,
    },
    briefings: briefingRows.map((b) => ({
      name: b.briefeeName,
      organisation: b.briefeeOrganisation,
      category: b.briefeeCategory,
      briefedByName: b.briefedByName,
      briefedAt: b.briefedAt.toISOString(),
      hasSignature: b.signatureData !== null && b.signatureData.length > 0,
      questionsNote: b.questionsNote,
    })),
    acceptance:
      decided === undefined
        ? null
        : {
            decision: decided.decision,
            acceptedByName: decided.acceptedByName,
            acceptedByOrganisation: decided.acceptedByOrganisation,
            decidedAt: decided.decidedAt?.toISOString() ?? null,
            comment: decided.decisionComment,
          },
  };
}

/** Stable content hash for the RAMS pack PDF cache key. */
export function hashRamsSnapshot(snap: RamsRenderSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snap)).digest('hex');
}

// ─── Custom dashboard (ADR 0018) ────────────────────────────────────────────

export interface DashboardRenderSnapshot {
  dashboard: {
    id: string;
    tenantId: string;
    title: string;
    description: string | null;
    status: string;
    /**
     * The raw spec jsonb. Deliberately `unknown`: the print route (the
     * only renderer) narrows through `parseDashboardSpec` and 404s on an
     * invalid row rather than half-rendering it.
     */
    spec: unknown;
    updatedAt: string;
  };
  tenantName: string;
}

/**
 * Load a dashboard into a renderer-ready snapshot. Unlike the module
 * documents above, a dashboard PDF has no frozen version — the widgets
 * are re-queried live at render time — so the snapshot is just the row
 * plus the tenant name for the header. Returns `null` when the
 * dashboard doesn't exist in the tenant.
 */
export async function loadDashboardSnapshot(
  db: Database,
  input: { tenantId: string; dashboardId: string },
): Promise<DashboardRenderSnapshot | null> {
  const rows = await db
    .select({
      id: dashboards.id,
      tenantId: dashboards.tenantId,
      title: dashboards.title,
      description: dashboards.description,
      status: dashboards.status,
      spec: dashboards.spec,
      updatedAt: dashboards.updatedAt,
      tenantName: tenants.name,
    })
    .from(dashboards)
    .innerJoin(tenants, eq(tenants.id, dashboards.tenantId))
    .where(and(eq(dashboards.tenantId, input.tenantId), eq(dashboards.id, input.dashboardId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    dashboard: {
      id: row.id,
      tenantId: row.tenantId,
      title: row.title,
      description: row.description,
      status: row.status,
      spec: row.spec,
      updatedAt: row.updatedAt.toISOString(),
    },
    tenantName: row.tenantName,
  };
}

/**
 * Stable content hash for the dashboard PDF cache key. Hashes (spec +
 * updatedAt + title) only: the widget DATA is live and time-varying, so
 * the key identifies the dashboard definition, not one execution — a
 * re-render of an unchanged dashboard overwrites the same object with a
 * fresher artefact instead of accreting one file per run.
 */
export function hashDashboardSnapshot(snap: DashboardRenderSnapshot): string {
  const stable = {
    spec: snap.dashboard.spec,
    updatedAt: snap.dashboard.updatedAt,
    title: snap.dashboard.title,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
