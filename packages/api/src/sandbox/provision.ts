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
  actions,
  contractors,
  coshhAssessmentControls,
  coshhAssessments,
  coshhSubstances,
  fireBuildings,
  fireRiskAssessments,
  incidentAbsences,
  incidentPersons,
  incidents,
  inspections,
  issues,
  permissionSets,
  permits,
  permitTypes,
  permitEvents,
  riskAssessmentControls,
  riskAssessmentHazards,
  ramsPacks,
  ramsReviews,
  riskAssessments,
  sites,
  templateVersions,
  templates,
  tenants,
  user,
  type AccessSnapshot,
  type IssueAccessSnapshot,
  type IssueCategorySnapshot,
} from '@forma360/db/schema';
import { PERMISSION_KEYS, type PermissionKey } from '@forma360/permissions/catalogue';
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
import {
  readingWithinLimit,
  snapshotPreconditions,
  type GasReading,
} from '@forma360/shared/permits';
import { nextReferenceValue } from '../reference-counter';
import { formatIncidentReference, personInjurySchema } from '@forma360/shared/incidents';
import { buildTemplateContentFromSpec } from '@forma360/shared/template-builder';
import { methodStatementContentSchema, snapshotReviewChecklist } from '@forma360/shared/rams';
import { effectiveFlaggedOptionIds, type TemplateContent } from '@forma360/shared/template-schema';
import { seedTenantDefaults } from '../tenant-defaults';
import {
  SANDBOX_COLLEAGUE,
  SANDBOX_CONTRACTORS,
  SANDBOX_COSHH,
  SANDBOX_FIRE_BUILDING,
  SANDBOX_GAS_READINGS,
  SANDBOX_INCIDENT,
  SANDBOX_INSPECTION_RUN,
  SANDBOX_INSPECTION_SPECS,
  SANDBOX_OBSERVATIONS,
  SANDBOX_PERMITS,
  SANDBOX_RAMS_PACK,
  SANDBOX_RAMS_REVIEW,
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

/**
 * Permission keys withheld from a try-it-now visitor.
 *
 * A sandbox hands an Administrator session to someone who has proven
 * nothing — no email, no payment, no identity. Administrator holds
 * every key in the catalogue, and a handful of those let the holder
 * send domain-authenticated mail to an ARBITRARY external address with
 * attacker-controlled text in it (`users.invite` composes a subject
 * from the inviter's own name and the workspace name, both self-service
 * editable). That turns a one-click anonymous workspace into an
 * unmetered mailer on a verified sending domain, which costs us the
 * domain's reputation rather than costing the attacker anything.
 *
 * Derived from the catalogue by subtraction: a new key is granted by
 * default, and only the ones named here are withheld. That keeps the
 * tiles working without maintenance, but it is NOT drift-proof — the
 * opposite. Subtraction is why `analytics.schedules.manage` below went
 * unnoticed: dashboards arrived after this list was written, brought a
 * mail path with them, and were granted automatically.
 *
 * **When adding a permission key to the catalogue, ask whether its module
 * can put a message in front of an address the tenant does not own.** If
 * it can, it belongs here. `sandbox-mail.test.ts` pins this list so a
 * deletion has to be deliberate.
 */
export const SANDBOX_WITHHELD_PERMISSIONS: readonly PermissionKey[] = [
  // Invites an arbitrary address, with self-service text in the subject.
  'users.invite',
  // Contractor portal invites take an arbitrary address too.
  'contractors.manage',
  // Dashboard delivery schedules accept up to 20 free-text recipients with
  // no domain check, on an hourly floor, each firing mailing a rendered PDF
  // from the verified sending domain — and `DASHBOARDS_FREE_FOR_EVERYONE`
  // entitles a sandbox to create them. Left granted, one anonymous
  // `POST /api/sandbox/create` bought a durable 100-addresses-per-hour
  // mailer, made permanent by the still-absent unclaimed-sandbox TTL sweep.
  'analytics.schedules.manage',
];

/** Administrator, minus the keys that can mail strangers. */
export function sandboxPermissionKeys(): PermissionKey[] {
  const withheld = new Set<string>(SANDBOX_WITHHELD_PERMISSIONS);
  return PERMISSION_KEYS.filter((k) => !withheld.has(k));
}

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

    // The visitor is an administrator of their own workspace, minus the
    // keys that could mail strangers from our sending domain. Claiming
    // does not widen this — a claimed workspace is still a workspace an
    // anonymous stranger created, and an admin can promote themselves
    // through Settings once they are a known person.
    const sandboxSetId = newId();
    await tx.insert(permissionSets).values({
      id: sandboxSetId,
      tenantId,
      name: 'Administrator (trial)',
      description:
        'Full access to this workspace. Sending invitations is enabled once you claim it.',
      permissions: sandboxPermissionKeys(),
      isSystem: false,
    });

    await tx.insert(user).values([
      {
        id: userId,
        name: 'You',
        firstName: 'You',
        email: `${tenantId.toLowerCase()}@${SANDBOX_EMAIL_DOMAIN}`,
        emailVerified: false,
        tenantId,
        permissionSetId: sandboxSetId,
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

    // The same defaults sign-up seeds — observation categories AND the
    // action types the actions module needs to be usable. One helper so
    // the two tenant-creation paths cannot drift.
    const { categoryIds } = await seedTenantDefaults(tx as unknown as Database, tenantId, userId);

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
      await seedInspection(ctx);
      return;
    case 'rams':
      await seedRamsPack(ctx);
      return;
  }
}

/**
 * Seed a risk assessment whose last hazard has no controls and no
 * residual rating. That gap is the visitor's decision — and completing
 * it is what puts their judgement into the document they then publish.
 */
async function seedRiskAssessment(ctx: SeedContext): Promise<void> {
  // The COSHH and fire refinements land on their own modules, so they
  // furnish THOSE registers instead — seeding a warehouse loading-bay
  // assessment behind a COSHH tile would promise one thing and deliver
  // another.
  if (ctx.resolved.refinement.id === 'coshh') {
    await seedCoshh(ctx);
    return;
  }
  if (ctx.resolved.refinement.id === 'fire') {
    await seedFireBuilding(ctx);
    return;
  }

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
      residualJustification: hazard.residualJustification ?? '',
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

/**
 * Seed the observation register: three reports, two open and one
 * already closed out, spread across both sites and across the past
 * fortnight — plus, on the `withActions` refinement, a corrective action
 * against each open one.
 *
 * Every one of those properties is here because its absence was visible.
 * The tile's own promise is "three reports, two still open", and the
 * first cut left all three open; the `withActions` refinement is named
 * for corrective actions and seeded none, so the actions board read
 * 0/0/0/0 in the workspace built around them; and all three carried the
 * same created-and-occurred second, which is what a register with no
 * history looks like — staged.
 */
async function seedObservations(ctx: SeedContext): Promise<void> {
  const now = new Date();
  const accessSnapshot: IssueAccessSnapshot = {
    groupIds: [],
    siteIds: [],
    permissions: [],
    snapshotAt: now.toISOString(),
  };
  const withActions = ctx.resolved.refinement.id === 'withActions';
  // Only the `anonymous` refinement demonstrates the QR flow. Attributing
  // a report to "Anonymous" on a tile the visitor did not pick made the
  // register look broken rather than deliberate.
  const anonymous = ctx.resolved.refinement.id === 'anonymous';

  let n = 0;
  for (const obs of SANDBOX_OBSERVATIONS) {
    const categoryId = ctx.categoryIds.get(obs.categoryName);
    if (categoryId === undefined) continue;
    n++;

    // Same contract as the issues router: OBS-, six digits, claimed
    // through the counter so the visitor's next report cannot collide.
    const ref = await nextReferenceValue(ctx.tx as unknown as Database, ctx.tenantId, 'issue');

    const categorySnapshot: IssueCategorySnapshot = {
      categoryId,
      name: obs.categoryName,
      customFields: [],
      customQuestions: [],
    };

    const reportedAt = daysBefore(now, obs.daysAgo);
    const siteId = ctx.siteIds.get(obs.siteRef);
    // The QR-submitted one is the near miss: an anonymous report of
    // something that nearly hit somebody is exactly what that channel is
    // for, and it is the only report on the register with no name on it.
    const isAnonymous = anonymous && n === 2;
    const reporterId = n === 1 ? ctx.colleagueId : ctx.userId;
    const closed = obs.status === 'closed';
    const issueId = newId();

    await ctx.tx.insert(issues).values({
      id: issueId,
      tenantId: ctx.tenantId,
      categoryId,
      categorySnapshot,
      accessSnapshot,
      referenceNumber: `OBS-${String(ref).padStart(6, '0')}`,
      title: obs.title,
      description: obs.description,
      status: obs.status,
      ...(siteId !== undefined ? { siteId } : {}),
      priority: obs.priority,
      dateOccurred: reportedAt,
      createdAt: reportedAt,
      updatedAt: closed ? daysBefore(now, obs.daysAgo - 1) : reportedAt,
      ...(isAnonymous
        ? { reportedVia: 'qr' as const }
        : {
            reportedByUserId: reporterId,
            reportedByName:
              reporterId === ctx.colleagueId
                ? `${SANDBOX_COLLEAGUE.firstName} ${SANDBOX_COLLEAGUE.lastName}`
                : 'You',
          }),
      ...(closed
        ? {
            closedAt: daysBefore(now, obs.daysAgo - 1),
            closedByUserId: ctx.colleagueId,
            closedReason: obs.closedReason ?? '',
          }
        : {}),
    });

    if (!withActions || obs.action === null) continue;

    const actionRef = await nextReferenceValue(
      ctx.tx as unknown as Database,
      ctx.tenantId,
      'action',
    );
    await ctx.tx.insert(actions).values({
      id: newId(),
      tenantId: ctx.tenantId,
      sourceType: 'issue',
      sourceId: issueId,
      referenceNumber: `AC-${String(actionRef).padStart(6, '0')}`,
      title: obs.action.title,
      description: obs.action.description,
      status: 'open',
      priority: obs.action.priority,
      assigneeUserId: obs.action.assignTo === 'colleague' ? ctx.colleagueId : ctx.userId,
      // Actions inherit the site of the finding that raised them — an
      // action floating with "No site" cannot be routed to anybody.
      ...(siteId !== undefined ? { siteId } : {}),
      dueAt: endOfDay(daysBefore(now, -obs.action.dueInDays)),
      createdBy: ctx.colleagueId,
      createdAt: reportedAt,
      updatedAt: reportedAt,
    });
  }
}

/** `n` days before `from` (negative `n` moves forward). */
function daysBefore(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * 17:00 on the given day. A due date carrying seconds ("due 12:28:52")
 * is spurious precision — nothing in a safety manager's world is due at
 * fifty-two seconds past.
 */
function endOfDay(day: Date): Date {
  const d = new Date(day);
  d.setHours(17, 0, 0, 0);
  return d;
}

/**
 * Seed one incident sitting at `reported` — triage is the visitor's
 * first decision, and the injury facts are chosen so the RIDDOR
 * screening is a real judgement rather than a demo prop: nine days off
 * work puts it over the over-7-day threshold.
 */
async function seedIncident(ctx: SeedContext): Promise<void> {
  const ref = await nextReferenceValue(ctx.tx as unknown as Database, ctx.tenantId, 'incident');
  const now = new Date();
  const occurredAt = daysBefore(now, SANDBOX_INCIDENT.occurredDaysAgo);
  // Reported the same shift. The register chips any gap over 24 h as a
  // late report, and a workspace built seconds ago that opens with a
  // late-report badge is telling the visitor off for someone else's
  // delay — the seed had `reportedAt` defaulting to now against an
  // accident two days old.
  const reportedAt = new Date(
    occurredAt.getTime() + SANDBOX_INCIDENT.reportedHoursAfter * 60 * 60 * 1000,
  );
  const incidentId = newId();

  await ctx.tx.insert(incidents).values({
    id: incidentId,
    tenantId: ctx.tenantId,
    referenceNumber: formatIncidentReference(ref),
    title: SANDBOX_INCIDENT.title,
    kind: SANDBOX_INCIDENT.kind,
    description: SANDBOX_INCIDENT.description,
    locationText: SANDBOX_INCIDENT.locationText,
    // A hospital admission floors severity at `serious` — the same rule
    // `provisionalSeverity` applies on the real report form. Left at the
    // column default the record read "Severity: Minor" against a
    // fractured wrist, a hospital visit and two weeks off.
    severity: SANDBOX_INCIDENT.severity,
    ...(ctx.siteIds.get('northfield') !== undefined
      ? { siteId: ctx.siteIds.get('northfield') as string }
      : {}),
    occurredAt,
    reportedAt,
    status: 'reported',
    reportedByUserId: ctx.colleagueId,
    createdAt: reportedAt,
    updatedAt: reportedAt,
  });

  // The injured person and the open absence period. Without these the
  // "People & lost time" panel read "0 day(s) lost" while the
  // description said two weeks off — and the over-7-day RIDDOR test,
  // which is one of the two triggers this scenario exists to present,
  // had no figure to work from.
  const personId = newId();
  await ctx.tx.insert(incidentPersons).values({
    id: personId,
    tenantId: ctx.tenantId,
    incidentId,
    name: SANDBOX_INCIDENT.person.name,
    category: SANDBOX_INCIDENT.person.category,
    injury: personInjurySchema.parse(SANDBOX_INCIDENT.person.injury),
    returnedToWork: false,
    createdAt: reportedAt,
    updatedAt: reportedAt,
  });

  await ctx.tx.insert(incidentAbsences).values({
    id: newId(),
    tenantId: ctx.tenantId,
    incidentId,
    personId,
    fromDate: isoDate(daysBefore(occurredAt, -SANDBOX_INCIDENT.absenceFromDaysAfterAccident)),
    // Open period — still absent, so the count keeps climbing and the
    // over-7-day threshold is crossed by the facts rather than by a
    // number someone typed.
    toDate: null,
    createdAt: reportedAt,
  });
}

/** `YYYY-MM-DD` in UTC — the `date` columns store calendar days. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
    .select({
      id: permitTypes.id,
      preconditions: permitTypes.preconditions,
      requiresGasTesting: permitTypes.requiresGasTesting,
      requiresAuthoriser: permitTypes.requiresAuthoriser,
      gasLimits: permitTypes.gasLimits,
    })
    .from(permitTypes)
    .where(and(eq(permitTypes.tenantId, ctx.tenantId), eq(permitTypes.category, content.category)))
    .limit(1);
  const permitType = typeRows[0];
  if (permitType === undefined) return;
  const permitTypeId = permitType.id;

  const validFrom = new Date();
  const validTo = new Date(validFrom.getTime() + 8 * 60 * 60 * 1000);

  // Same contract as the permits router: PTW-, four digits, claimed
  // through the counter.
  const ref = await nextReferenceValue(tx, ctx.tenantId, 'permit');

  // ISSUED, not draft. `permits.list` defaults to status 'open'
  // (issued / active / suspended), so a draft is invisible on the
  // register the visitor lands on — the row would exist and the page
  // would be empty. Issued is also the honest state for "waiting on
  // you": a colleague raised and issued it, the visitor is the named
  // acceptor, and accepting it is their decision.
  const preconditions = snapshotPreconditions(permitType.preconditions).map((pc) => ({
    ...pc,
    // Preconditions are a condition OF issue, so an issued permit has
    // them confirmed by the issuer.
    checked: true,
    checkedBy: ctx.colleagueId,
    checkedByName: `${SANDBOX_COLLEAGUE.firstName} ${SANDBOX_COLLEAGUE.lastName}`,
    checkedAt: validFrom.toISOString(),
  }));

  // Gas readings taken before issue, where the type demands them.
  //
  // The seeded permit was written straight to `issued`, which is what
  // let it skip the gate the router enforces on the real issue path. The
  // page then stated the acceptable limits, said "the gate evaluates
  // readings against these", and showed "No readings recorded yet"
  // against an already-issued permit. Recording the readings the issuer
  // would have taken makes the document coherent — and the verdict is
  // snapshotted per reading exactly as `permits.recordGasReading` does.
  const gasSpec = SANDBOX_GAS_READINGS[content.category] ?? [];
  const takenAt = new Date(validFrom.getTime() - 15 * 60 * 1000);
  const colleagueName = `${SANDBOX_COLLEAGUE.firstName} ${SANDBOX_COLLEAGUE.lastName}`;
  const gasReadings: GasReading[] = permitType.requiresGasTesting
    ? gasSpec.flatMap((r) => {
        const limit = permitType.gasLimits.find((l) => l.id === r.limitId);
        if (limit === undefined) return [];
        const reading = { reading: r.value, unit: limit.unit };
        return [
          {
            id: newId(),
            substance: limit.label,
            reading: r.value,
            unit: limit.unit,
            takenAt: takenAt.toISOString(),
            takenBy: ctx.colleagueId,
            takenByName: colleagueName,
            note: '',
            limitId: limit.id,
            withinLimits: readingWithinLimit(reading, limit),
          },
        ];
      })
    : [];

  const permitId = newId();
  await ctx.tx.insert(permits).values({
    id: permitId,
    tenantId: ctx.tenantId,
    permitTypeId,
    referenceNumber: `PTW-${String(ref).padStart(4, '0')}`,
    title: content.title,
    workDescription: content.description,
    locationText: content.locationText,
    ...(ctx.siteIds.get('northfield') !== undefined
      ? { siteId: ctx.siteIds.get('northfield') as string }
      : {}),
    status: 'issued',
    preconditions,
    gasReadings,
    issuerUserId: ctx.colleagueId,
    issuedAt: validFrom,
    // A type that demands an authorising signature must carry one on an
    // issued permit, or the record shows a permit in force that nobody
    // authorised.
    ...(permitType.requiresAuthoriser
      ? { authoriserUserId: ctx.colleagueId, authorisedAt: takenAt }
      : {}),
    acceptorUserId: ctx.userId,
    validFrom,
    validTo,
    createdBy: ctx.colleagueId,
  });

  // The audit trail the router would have written.
  //
  // Seeding writes the end state directly (see the file header), which
  // is honest about what it is — but it skipped `permit_events`
  // entirely, so a permit that six people had signed off showed a
  // History with one line on it. For a permit, "who issued this and
  // when" is the most important line in the log, and it was the one
  // missing.
  const events: Array<{
    kind: 'created' | 'precondition_checked' | 'authorised' | 'issued';
    detail: string;
    at: Date;
  }> = [
    { kind: 'created', detail: '', at: new Date(takenAt.getTime() - 30 * 60 * 1000) },
    ...preconditions.map((pc) => ({
      kind: 'precondition_checked' as const,
      detail: pc.label,
      at: takenAt,
    })),
    ...(permitType.requiresAuthoriser
      ? [{ kind: 'authorised' as const, detail: '', at: takenAt }]
      : []),
    { kind: 'issued', detail: '', at: validFrom },
  ];
  for (const event of events) {
    await ctx.tx.insert(permitEvents).values({
      id: newId(),
      tenantId: ctx.tenantId,
      permitId,
      actorUserId: ctx.colleagueId,
      kind: event.kind,
      detail: event.detail,
      createdAt: event.at,
    });
  }
}

/**
 * Seed a published inspection template plus one inspection already
 * running against it.
 *
 * The content is built by `buildTemplateContentFromSpec` — the same
 * deterministic builder the AI import path uses — rather than a
 * hand-written content blob. That guarantees the seeded template is
 * schema-valid by construction and cannot drift from what the builder
 * produces for everyone else.
 *
 * The template is PUBLISHED with a current version, because a draft is
 * not runnable and the visitor's goal is to run it.
 */
async function seedInspection(ctx: SeedContext): Promise<void> {
  const spec = SANDBOX_INSPECTION_SPECS[ctx.resolved.refinement.id];
  if (spec === undefined) return;

  const content = buildTemplateContentFromSpec(spec);
  const templateId = newId();
  const versionId = newId();
  const now = new Date();

  // Three columns must agree for the template to be startable, and
  // nothing in the DB keeps them in sync: `templates.status` is what the
  // start-inspection picker filters on, `templates.currentVersionId` is
  // what `inspections.create` pins from (NOT `is_current`), and
  // `templates.titleFormat` is the only store the title renderer reads.
  // Setting only `is_current` leaves a template that looks published and
  // cannot be run.
  await ctx.tx.insert(templates).values({
    id: templateId,
    tenantId: ctx.tenantId,
    name: spec.title,
    description: spec.description ?? '',
    status: 'published',
    currentVersionId: versionId,
    titleFormat: content.settings.titleFormat,
    createdBy: ctx.userId,
    updatedAt: now,
  });

  await ctx.tx.insert(templateVersions).values({
    id: versionId,
    tenantId: ctx.tenantId,
    templateId,
    versionNumber: 1,
    content,
    isCurrent: true,
    publishedAt: now,
    publishedBy: ctx.userId,
  });

  // One inspection in progress, so the register is not empty and the
  // visitor can see what a run looks like before starting their own.
  // ADR 0007: the access snapshot is frozen at start.
  const accessSnapshot: AccessSnapshot = {
    groups: [],
    sites: [],
    permissions: [],
    snapshotAt: now.toISOString(),
  };

  // Started yesterday morning — "in progress" implies elapsed time, and
  // a run stamped with the second the workspace was built does not read
  // as someone else's half-finished work.
  const startedAt = daysBefore(now, 1);

  await ctx.tx.insert(inspections).values({
    id: newId(),
    tenantId: ctx.tenantId,
    templateId,
    templateVersionId: versionId,
    title: `${spec.title} — ${SANDBOX_INSPECTION_RUN.titleSuffix}`,
    status: 'in_progress',
    ...(ctx.siteIds.get('eastgate') !== undefined
      ? { siteId: ctx.siteIds.get('eastgate') as string }
      : {}),
    accessSnapshot,
    // The colleague who started it is the one whose name belongs on the
    // record. Left unset, the conduct screen and the report both print
    // an em dash where the author should be.
    conductedBy: ctx.colleagueId,
    responses: partialResponses(content),
    createdBy: ctx.colleagueId,
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  });
}

/**
 * Answers for the first `answeredSections` sections of the seeded run,
 * built by walking the content the builder produced.
 *
 * Derived rather than hand-written so it cannot drift from whichever
 * spec the refinement picked: a hard-coded answer map keyed on item ids
 * would be stale the moment a question moved, and a stale map fails
 * silently — which is exactly how the tile came to promise "one
 * inspection already underway" and hand over ten blank answers.
 *
 * Only non-flagging options are chosen. A seeded failure would raise a
 * corrective action the visitor never agreed to, and the point of
 * stopping part-way is that the *unfinished* part is theirs.
 */
function partialResponses(content: TemplateContent): Record<string, unknown> {
  const sets = new Map(content.customResponseSets.map((s) => [s.id, s]));
  const responses: Record<string, unknown> = {};
  let sectionsDone = 0;

  for (const page of content.pages) {
    for (const section of page.sections) {
      if (sectionsDone >= SANDBOX_INSPECTION_RUN.answeredSections) return responses;
      for (const item of section.items) {
        if (item.type === 'multipleChoice') {
          const set = sets.get(item.responseSetId);
          if (set === undefined) continue;
          const flagged = new Set(effectiveFlaggedOptionIds(item, set));
          const pick = set.options.find((o) => !flagged.has(o.id));
          if (pick !== undefined) responses[item.id] = pick.id;
        } else if (item.type === 'text') {
          responses[item.id] = SANDBOX_INSPECTION_RUN.textAnswer;
        }
      }
      sectionsDone++;
    }
  }
  return responses;
}

/** Seed one hazardous substance with a COSHH assessment against it. */
async function seedCoshh(ctx: SeedContext): Promise<void> {
  const substanceId = newId();
  const ref = await nextReferenceValue(
    ctx.tx as unknown as Database,
    ctx.tenantId,
    'coshhSubstance',
  );

  await ctx.tx.insert(coshhSubstances).values({
    id: substanceId,
    tenantId: ctx.tenantId,
    referenceNumber: `CS-${String(ref).padStart(4, '0')}`,
    name: SANDBOX_COSHH.name,
    supplier: SANDBOX_COSHH.supplier,
    createdBy: ctx.userId,
  });

  const assessmentRef = await nextReferenceValue(
    ctx.tx as unknown as Database,
    ctx.tenantId,
    'coshhAssessment',
  );
  const assessmentId = newId();
  await ctx.tx.insert(coshhAssessments).values({
    id: assessmentId,
    tenantId: ctx.tenantId,
    substanceId,
    referenceNumber: `COSHH-${String(assessmentRef).padStart(4, '0')}`,
    taskDescription: SANDBOX_COSHH.taskDescription,
    status: 'active',
    // An `active` assessment with no exposure detail and no controls is
    // not a valid assessment — see the note on SANDBOX_COSHH.
    routesOfExposure: [...SANDBOX_COSHH.routesOfExposure],
    personsExposed: [...SANDBOX_COSHH.personsExposed],
    personsCount: SANDBOX_COSHH.personsCount,
    quantityBand: SANDBOX_COSHH.quantityBand,
    frequencyBand: SANDBOX_COSHH.frequencyBand,
    durationBand: SANDBOX_COSHH.durationBand,
    levRequired: SANDBOX_COSHH.levRequired,
    healthSurveillanceRequired: SANDBOX_COSHH.healthSurveillanceRequired,
    exposureMonitoringRequired: SANDBOX_COSHH.exposureMonitoringRequired,
    emergencyNotes: SANDBOX_COSHH.emergencyNotes,
    plainSummary: SANDBOX_COSHH.plainSummary,
    // In the future: a review already overdue would light the amber
    // "assessments due" chip on a workspace seconds old.
    nextReviewAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    createdBy: ctx.userId,
  });

  for (const control of SANDBOX_COSHH.controls) {
    await ctx.tx.insert(coshhAssessmentControls).values({
      id: newId(),
      tenantId: ctx.tenantId,
      assessmentId,
      tier: control.tier,
      description: control.description,
      status: 'in_place',
    });
  }
}

/** Seed one building with a fire risk assessment against it. */
async function seedFireBuilding(ctx: SeedContext): Promise<void> {
  const buildingId = newId();
  await ctx.tx.insert(fireBuildings).values({
    id: buildingId,
    tenantId: ctx.tenantId,
    name: SANDBOX_FIRE_BUILDING.name,
    ...(ctx.siteIds.get('eastgate') !== undefined
      ? { siteId: ctx.siteIds.get('eastgate') as string }
      : {}),
    createdBy: ctx.userId,
  });

  const ref = await nextReferenceValue(
    ctx.tx as unknown as Database,
    ctx.tenantId,
    'fireRiskAssessment',
  );
  // Left at the default 'draft' the register prints "FRA missing", which
  // reads as a broken workspace rather than a furnished one. Only an
  // `active` FRA counts as in place.
  const now = new Date();
  await ctx.tx.insert(fireRiskAssessments).values({
    id: newId(),
    tenantId: ctx.tenantId,
    buildingId,
    referenceNumber: `FRA-${String(ref).padStart(4, '0')}`,
    title: SANDBOX_FIRE_BUILDING.fraTitle,
    status: 'active',
    riskRating: 'tolerable',
    publishedAt: now,
    publishedBy: ctx.userId,
    nextReviewAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    createdBy: ctx.userId,
  });
}

/**
 * Seed the RAMS tile.
 *
 * `reviewPack` lands on the contractor-review workspace, so that is what
 * it has to furnish. Seeding our own draft pack behind it — which is
 * what `buildPack` produces — meant the visitor asked to review a
 * contractor's RAMS and was shown "No contractor packs awaiting review".
 * The other two refinements get the pack, and the pack now carries the
 * method-statement steps that make it a document rather than a shell.
 */
async function seedRamsPack(ctx: SeedContext): Promise<void> {
  await seedRamsOwnPack(ctx);
  if (ctx.resolved.refinement.id === 'reviewPack') {
    await seedRamsContractorReview(ctx);
  }
}

async function seedRamsOwnPack(ctx: SeedContext): Promise<void> {
  const ref = await nextReferenceValue(ctx.tx as unknown as Database, ctx.tenantId, 'ramsPack');

  await ctx.tx.insert(ramsPacks).values({
    id: newId(),
    tenantId: ctx.tenantId,
    referenceNumber: `RAMS-${String(ref).padStart(6, '0')}`,
    title: SANDBOX_RAMS_PACK.title,
    // Parsed through the real schema so defaults (schemaVersion, ids,
    // dense sequencing) are filled in exactly as the builder would, and
    // so a malformed seed fails here rather than at the first read.
    draftContent: methodStatementContentSchema.parse({
      scopeOfWorks: SANDBOX_RAMS_PACK.description,
      steps: SANDBOX_RAMS_PACK.steps.map((step, i) => ({
        id: `seed-step-${i + 1}`,
        sequence: i + 1,
        title: step.title,
        description: step.description,
        controlNotes: step.controlNotes,
        ppe: [...step.ppe],
        ...('holdPoint' in step ? { holdPoint: step.holdPoint } : {}),
      })),
      emergency: SANDBOX_RAMS_PACK.emergency,
      logistics: SANDBOX_RAMS_PACK.logistics,
    }),
    ...(ctx.siteIds.get('northfield') !== undefined
      ? { siteId: ctx.siteIds.get('northfield') as string }
      : {}),
    createdBy: ctx.userId,
  });
}

/**
 * A contractor's pack logged into the review queue, pending a decision.
 *
 * `contractorDocumentId` stays null: that is the module's own shape for
 * a pack that arrived by email and is being logged internally, and it is
 * the honest one here — there is no uploaded file behind a seeded row,
 * and inventing a storage key would produce a review whose "open the
 * document" button 404s.
 */
async function seedRamsContractorReview(ctx: SeedContext): Promise<void> {
  const contractorId = ctx.contractorIds.get(SANDBOX_RAMS_REVIEW.contractorRef);
  if (contractorId === undefined) return;

  const receivedAt = daysBefore(new Date(), SANDBOX_RAMS_REVIEW.receivedDaysAgo);
  await ctx.tx.insert(ramsReviews).values({
    id: newId(),
    tenantId: ctx.tenantId,
    contractorId,
    title: SANDBOX_RAMS_REVIEW.title,
    workDescription: SANDBOX_RAMS_REVIEW.workDescription,
    ...(ctx.siteIds.get(SANDBOX_RAMS_REVIEW.siteRef) !== undefined
      ? { siteId: ctx.siteIds.get(SANDBOX_RAMS_REVIEW.siteRef) as string }
      : {}),
    outcome: 'pending',
    checklist: snapshotReviewChecklist(),
    submittedBy: ctx.colleagueId,
    createdAt: receivedAt,
    updatedAt: receivedAt,
  });
}
