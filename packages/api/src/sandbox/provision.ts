/**
 * Try-it-now workspace provisioning (ADR 0017).
 *
 * Creates a complete, signed-in-able tenant for a visitor who has given
 * us nothing — no email, no company, no password. The workspace is a
 * real tenant in every respect: `tenantProcedure` scopes to it,
 * permission sets gate it, and the module routers cannot tell it apart
 * from one that arrived through sign-up. The only difference is the
 * `settings.sandbox` marker, which records what the visitor asked for
 * and whether they have since claimed the workspace with an email.
 *
 * Seeding writes directly rather than driving the module routers. That
 * is deliberate: the routers enforce *lifecycle* (a permit starts as a
 * draft, an incident starts as reported), and the whole point of the
 * seed is to hand the visitor a workspace already mid-story — a permit
 * awaiting their authorisation, a risk assessment with one hazard left
 * to rate. Reaching that state through the routers would mean
 * impersonating three people in sequence; writing the end state is
 * honest about what it is. Every row still goes through the same schema
 * constraints, and the whole provision runs in one transaction.
 *
 * What the visitor never gets: anything another tenant can see. The
 * sandbox is an ordinary tenant boundary, so ADR 0002 holds unchanged.
 */
import type { Database } from '@forma360/db/client';
import {
  contractors,
  incidents,
  issueCategories,
  issues,
  permits,
  permitTypes,
  riskAssessmentControls,
  riskAssessmentHazards,
  riskAssessments,
  sites,
  tenants,
  user,
  type IssueAccessSnapshot,
  type IssueCategorySnapshot,
} from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import type { BrandId } from '@forma360/shared/brand';
import { newId } from '@forma360/shared/id';
import type { Logger } from '@forma360/shared/logger';
import {
  resolveSandboxChoice,
  type ResolvedSandboxChoice,
  type SandboxChoice,
} from '@forma360/shared/sandbox-scenarios';
import { and, eq } from 'drizzle-orm';
import { ensureSeededTypes } from '../routers/permits';
import { nextReferenceValue } from '../reference-counter';
import { formatIncidentReference } from '@forma360/shared/incidents';
import {
  SANDBOX_COLLEAGUE,
  SANDBOX_CONTRACTORS,
  SANDBOX_INCIDENT,
  SANDBOX_OBSERVATIONS,
  SANDBOX_PERMITS,
  SANDBOX_RISK_ASSESSMENTS,
  SANDBOX_SITES,
} from './seed-data';

/**
 * Reserved domain (RFC 2606) for the placeholder address a sandbox user
 * carries until the visitor claims the workspace. It can never collide
 * with a real inbox, and `claimWorkspace` is the only thing that
 * replaces it.
 */
export const SANDBOX_EMAIL_DOMAIN = 'sandbox.invalid';

/** True when this address is a placeholder rather than a real inbox. */
export function isSandboxEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${SANDBOX_EMAIL_DOMAIN}`);
}

/** Default observation categories, mirroring `auth.signUpWithTenant`. */
const OBSERVATION_CATEGORIES = ['Hazard', 'Near miss', 'Quality', 'Environmental'] as const;

export interface ProvisionSandboxInput {
  readonly brand: BrandId;
  readonly choice: SandboxChoice;
}

export interface ProvisionedSandbox {
  readonly tenantId: string;
  readonly userId: string;
  /** Locale-relative route the visitor should land on. */
  readonly landingPath: string;
}

export class SandboxChoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxChoiceError';
  }
}

/**
 * Provision and seed a sandbox workspace. Throws {@link SandboxChoiceError}
 * when the tile/refinement pair is not one this brand offers — the
 * caller turns that into a 400 rather than quietly substituting a
 * default, so a stale link never builds the wrong workspace.
 */
export async function provisionSandbox(
  db: Database,
  logger: Logger,
  input: ProvisionSandboxInput,
): Promise<ProvisionedSandbox> {
  const resolved = resolveSandboxChoice(input.brand, input.choice);
  if (resolved === null) {
    throw new SandboxChoiceError(
      `scenario "${input.choice.scenarioId}" / refinement "${input.choice.refinementId}" is not offered by brand "${input.brand}"`,
    );
  }

  const tenantId = newId();
  const userId = `usr_${newId()}`;
  const colleagueId = `usr_${newId()}`;

  await db.transaction(async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: 'Demo workspace',
      slug: `demo-${tenantId.slice(-10).toLowerCase()}`,
      settings: {
        sandbox: {
          scenarioId: resolved.scenario.id,
          refinementId: resolved.refinement.id,
        },
      },
    });

    const sets = await seedDefaultPermissionSets(tx as unknown as Database, tenantId);

    await tx.insert(user).values([
      {
        id: userId,
        name: 'You',
        firstName: 'You',
        email: `${tenantId.toLowerCase()}@${SANDBOX_EMAIL_DOMAIN}`,
        emailVerified: false,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: colleagueId,
        name: `${SANDBOX_COLLEAGUE.firstName} ${SANDBOX_COLLEAGUE.lastName}`,
        firstName: SANDBOX_COLLEAGUE.firstName,
        lastName: SANDBOX_COLLEAGUE.lastName,
        email: `priya.${tenantId.toLowerCase()}@${SANDBOX_EMAIL_DOMAIN}`,
        emailVerified: false,
        tenantId,
        permissionSetId: sets.manager,
      },
    ]);

    const siteIds = new Map<string, string>();
    for (const site of SANDBOX_SITES) {
      const id = newId();
      siteIds.set(site.ref, id);
      await tx.insert(sites).values({ id, tenantId, name: site.name });
    }

    const contractorIds = new Map<string, string>();
    for (const c of SANDBOX_CONTRACTORS) {
      const id = newId();
      contractorIds.set(c.ref, id);
      await tx.insert(contractors).values({ id, tenantId, name: c.name });
    }

    const categoryIds = new Map<string, string>();
    const now = new Date();
    for (const name of OBSERVATION_CATEGORIES) {
      const id = newId();
      categoryIds.set(name, id);
      await tx.insert(issueCategories).values({
        id,
        tenantId,
        name,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    const ctx: SeedContext = {
      tx,
      tenantId,
      userId,
      colleagueId,
      siteIds,
      contractorIds,
      categoryIds,
      resolved,
    };

    await seedScenario(ctx);
  });

  logger.info(
    {
      tenantId,
      scenarioId: resolved.scenario.id,
      refinementId: resolved.refinement.id,
    },
    '[sandbox] workspace provisioned',
  );

  return { tenantId, userId, landingPath: resolved.landingPath };
}

interface SeedContext {
  readonly tx: Parameters<Parameters<Database['transaction']>[0]>[0];
  readonly tenantId: string;
  readonly userId: string;
  readonly colleagueId: string;
  readonly siteIds: ReadonlyMap<string, string>;
  readonly contractorIds: ReadonlyMap<string, string>;
  readonly categoryIds: ReadonlyMap<string, string>;
  readonly resolved: ResolvedSandboxChoice;
}

async function seedScenario(ctx: SeedContext): Promise<void> {
  switch (ctx.resolved.scenario.id) {
    case 'riskAssessment':
      await seedRiskAssessment(ctx);
      return;
    case 'hazard':
      await seedObservations(ctx);
      return;
    case 'incident':
      await seedIncident(ctx);
      return;
    case 'permit':
      await seedPermit(ctx);
      return;
    case 'inspection':
    case 'rams':
      // Inspections and RAMS land on a register furnished with the
      // shared org context above; their own content is authored in the
      // module, which is where their start screens already lead.
      return;
  }
}

/**
 * Seed a risk assessment whose last hazard has no controls and no
 * residual rating. That gap is the visitor's decision — and completing
 * it is what puts their judgement into the document they then publish.
 */
async function seedRiskAssessment(ctx: SeedContext): Promise<void> {
  // No fallback. The COSHH and fire refinements land on their own
  // modules, and seeding a warehouse loading-bay assessment there would
  // promise one thing and deliver another.
  const content = SANDBOX_RISK_ASSESSMENTS[ctx.resolved.refinement.id];
  if (content === undefined) return;

  const assessmentId = newId();
  // Claim the reference through the shared counter, exactly as the
  // router does. Stamping one by hand would leave the counter at zero,
  // and the visitor's first self-created assessment would collide with
  // this one.
  const raRef = await nextReferenceValue(
    ctx.tx as unknown as Database,
    ctx.tenantId,
    'riskAssessment',
  );
  await ctx.tx.insert(riskAssessments).values({
    id: assessmentId,
    tenantId: ctx.tenantId,
    referenceNumber: `RA-${String(raRef).padStart(4, '0')}`,
    title: content.title,
    activity: content.activity,
    type: 'standing',
    status: 'draft',
    ...(ctx.siteIds.get('eastgate') !== undefined
      ? { siteId: ctx.siteIds.get('eastgate') as string }
      : {}),
    assessorUserId: ctx.userId,
    reviewFrequencyMonths: 12,
    createdBy: ctx.userId,
  });

  let sortOrder = 0;
  for (const hazard of content.hazards) {
    const hazardId = newId();
    await ctx.tx.insert(riskAssessmentHazards).values({
      id: hazardId,
      tenantId: ctx.tenantId,
      assessmentId,
      sortOrder: sortOrder++,
      hazard: hazard.hazard,
      harmDescription: hazard.harmDescription,
      affectedGroups: [...hazard.affectedGroups],
      initialLikelihood: hazard.initialLikelihood,
      initialSeverity: hazard.initialSeverity,
      existingControls: hazard.existingControls,
      residualLikelihood: hazard.residualLikelihood,
      residualSeverity: hazard.residualSeverity,
      residualJustification: '',
    });

    for (const control of hazard.controls) {
      await ctx.tx.insert(riskAssessmentControls).values({
        id: newId(),
        tenantId: ctx.tenantId,
        assessmentId,
        hazardId,
        description: control.description,
        tier: control.tier,
        status: 'in_place',
      });
    }
  }
}

/** Seed the observation register with two open items and one closed. */
async function seedObservations(ctx: SeedContext): Promise<void> {
  const accessSnapshot: IssueAccessSnapshot = {
    groupIds: [],
    siteIds: [],
    permissions: [],
    snapshotAt: new Date().toISOString(),
  };

  let n = 1;
  for (const obs of SANDBOX_OBSERVATIONS) {
    const categoryId = ctx.categoryIds.get(obs.categoryName);
    if (categoryId === undefined) continue;

    // Same contract as the issues router: OBS-, six digits, claimed
    // through the counter so the visitor's next report cannot collide.
    const ref = await nextReferenceValue(ctx.tx as unknown as Database, ctx.tenantId, 'issue');

    const categorySnapshot: IssueCategorySnapshot = {
      categoryId,
      name: obs.categoryName,
      customFields: [],
      customQuestions: [],
    };

    await ctx.tx.insert(issues).values({
      id: newId(),
      tenantId: ctx.tenantId,
      categoryId,
      categorySnapshot,
      accessSnapshot,
      referenceNumber: `OBS-${String(ref).padStart(6, '0')}`,
      title: obs.title,
      description: obs.description,
      ...(ctx.siteIds.get('northfield') !== undefined
        ? { siteId: ctx.siteIds.get('northfield') as string }
        : {}),
      priority: obs.needsAction ? 'high' : 'low',
      reportedByUserId: n === 1 ? ctx.colleagueId : ctx.userId,
    });
    n++;
  }
}

/**
 * Seed one incident sitting at `reported` — triage is the visitor's
 * first decision, and the injury facts are chosen so the RIDDOR
 * screening is a real judgement rather than a demo prop: nine days off
 * work puts it over the over-7-day threshold.
 */
async function seedIncident(ctx: SeedContext): Promise<void> {
  const ref = await nextReferenceValue(ctx.tx as unknown as Database, ctx.tenantId, 'incident');
  const occurredAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  await ctx.tx.insert(incidents).values({
    id: newId(),
    tenantId: ctx.tenantId,
    referenceNumber: formatIncidentReference(ref),
    title: SANDBOX_INCIDENT.title,
    kind: SANDBOX_INCIDENT.kind,
    description: SANDBOX_INCIDENT.description,
    locationText: SANDBOX_INCIDENT.locationText,
    ...(ctx.siteIds.get('northfield') !== undefined
      ? { siteId: ctx.siteIds.get('northfield') as string }
      : {}),
    occurredAt,
    status: 'reported',
    reportedByUserId: ctx.colleagueId,
  });
}

/**
 * Seed one permit for the visitor to walk through. Runs inside the
 * provisioning transaction so a failure here rolls the whole workspace
 * back rather than leaving a half-built tenant behind.
 *
 * The nine default permit types come from the same `ensureSeededTypes`
 * the permits router uses, so the sandbox catalogue and a real tenant's
 * catalogue can never drift.
 */
async function seedPermit(ctx: SeedContext): Promise<void> {
  const content = SANDBOX_PERMITS[ctx.resolved.refinement.id] ?? SANDBOX_PERMITS['hotWork'];
  if (content === undefined) return;

  const tx = ctx.tx as unknown as Database;
  await ensureSeededTypes(tx, ctx.tenantId, ctx.userId);

  const typeRows = await tx
    .select({ id: permitTypes.id })
    .from(permitTypes)
    .where(and(eq(permitTypes.tenantId, ctx.tenantId), eq(permitTypes.category, content.category)))
    .limit(1);
  const permitTypeId = typeRows[0]?.id;
  if (permitTypeId === undefined) return;

  const validFrom = new Date();
  const validTo = new Date(validFrom.getTime() + 8 * 60 * 60 * 1000);

  // Same contract as the permits router: PTW-, four digits, claimed
  // through the counter.
  const ref = await nextReferenceValue(tx, ctx.tenantId, 'permit');

  await ctx.tx.insert(permits).values({
    id: newId(),
    tenantId: ctx.tenantId,
    permitTypeId,
    referenceNumber: `PTW-${String(ref).padStart(4, '0')}`,
    title: content.title,
    workDescription: content.description,
    locationText: content.locationText,
    ...(ctx.siteIds.get('northfield') !== undefined
      ? { siteId: ctx.siteIds.get('northfield') as string }
      : {}),
    status: 'draft',
    validFrom,
    validTo,
    createdBy: ctx.userId,
  });
}
