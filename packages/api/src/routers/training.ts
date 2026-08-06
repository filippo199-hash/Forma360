/**
 * Training & competence matrix router (FreeHS module B7).
 *
 * The module is a register of who holds what against a definition of who
 * needs what. It is explicitly **not** an LMS — there is no course, no
 * enrolment, no content anywhere in this file, and there should never be.
 *
 * The important design point: `matrix` and every view derived from it are
 * **computed**, never stored. One `resolve` pass loads the population,
 * the assignments and the records, then `@forma360/shared/training`
 * decides every status. The gap list, the grid, the wallet, the roll-up
 * and the permit gate all go through that one helper, so they can never
 * disagree about whether Dave is in date.
 *
 * Brand-gated (ADR 0010) with `{ enabled }` like every other B-module.
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@forma360/db/client';
import {
  groupMembers,
  trainingRecords,
  trainingRequirementAssignments,
  trainingRequirements,
  user,
  userCustomFieldValues,
  customUserFields,
} from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import {
  compliancePercent,
  computeExpiry,
  currentRecord,
  statusAsOf,
  TRAINING_ASSIGNMENT_SCOPES,
  TRAINING_OBLIGATIONS,
  TRAINING_RECORD_SOURCES,
  type TrainingStatus,
} from '@forma360/shared/training';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

export interface TrainingRouterDeps {
  /** ADR 0010 brand gate. Omitting the router's deps disables the module. */
  enabled: boolean;
  /** Overridable clock so tests can stand at a fixed date. */
  now?: () => Date;
}

// ─── Input schemas ──────────────────────────────────────────────────────────

const requirementInput = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).nullable().default(null),
  obligation: z.enum(TRAINING_OBLIGATIONS).default('mandatory'),
  /** Null = never expires. */
  validityMonths: z.number().int().min(1).max(600).nullable().default(null),
  renewalLeadDays: z.number().int().min(0).max(365).default(60),
  evidenceNote: z.string().trim().max(500).nullable().default(null),
  description: z.string().trim().max(2000).nullable().default(null),
});

const recordInput = z.object({
  requirementId: z.string().min(1),
  /** A platform user, or null for a name-only person (contractor / agency). */
  userId: z.string().min(1).nullable().default(null),
  personName: z.string().trim().min(1).max(200),
  personCategory: z.string().trim().min(1).max(50).default('employee'),
  contractorId: z.string().min(1).nullable().default(null),
  achievedAt: z.string().min(8),
  /** Omit to compute from the requirement's validity period. */
  expiresAt: z.string().min(8).nullable().optional(),
  awardingBody: z.string().trim().max(200).nullable().default(null),
  certificateNumber: z.string().trim().max(100).nullable().default(null),
  evidenceKey: z.string().trim().max(500).nullable().default(null),
  evidenceFilename: z.string().trim().max(300).nullable().default(null),
  source: z.enum(TRAINING_RECORD_SOURCES).default('external'),
  notes: z.string().trim().max(2000).nullable().default(null),
});

/** A person in the matrix — a user, or a name-only person seen in records. */
interface MatrixPerson {
  userId: string | null;
  name: string;
  category: string;
  roleName: string | null;
  siteIds: string[];
  groupIds: string[];
}

/** One computed cell. */
export interface MatrixCell {
  personKey: string;
  personName: string;
  userId: string | null;
  requirementId: string;
  requirementName: string;
  status: TrainingStatus;
  expiresAt: Date | null;
  recordId: string | null;
}

function parseDay(value: string): Date {
  const d = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-date' });
  }
  return d;
}

/** Stable key for a person: the user id, or their name for account-less people. */
function personKeyOf(userId: string | null, name: string): string {
  return userId ?? `name:${name.toLowerCase()}`;
}

export function createTrainingRouter(deps: TrainingRouterDeps) {
  const now = (): Date => deps.now?.() ?? new Date();

  function assertEnabled(): void {
    if (!deps.enabled) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'module-disabled' });
    }
  }

  /** Load a requirement scoped to the tenant, or 404. */
  async function loadRequirement(db: Database, tenantId: string, id: string) {
    const rows = await db
      .select()
      .from(trainingRequirements)
      .where(and(eq(trainingRequirements.tenantId, tenantId), eq(trainingRequirements.id, id)))
      .limit(1);
    const req = rows[0];
    if (req === undefined) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'requirement-not-found' });
    }
    return req;
  }

  /**
   * The one resolve pass every view is built on.
   *
   * Loads the population (users + the account-less people who appear in
   * records), every assignment, and every record; then computes each
   * cell's status through the shared helper. Everything downstream —
   * gap list, grid, wallet, roll-up, permit gate — filters this.
   *
   * `asOf` defaults to today but is a real parameter: passing a past date
   * answers "was this person competent on the day", which is the whole
   * reason records are append-only.
   */
  async function resolveMatrix(
    db: Database,
    tenantId: string,
    opts: { asOf: Date; siteId?: string | undefined; requirementId?: string | undefined },
  ): Promise<{ people: MatrixPerson[]; cells: MatrixCell[] }> {
    const [requirements, assignments, records, users] = await Promise.all([
      db
        .select()
        .from(trainingRequirements)
        .where(
          and(
            eq(trainingRequirements.tenantId, tenantId),
            isNull(trainingRequirements.archivedAt),
            ...(opts.requirementId !== undefined
              ? [eq(trainingRequirements.id, opts.requirementId)]
              : []),
          ),
        ),
      db
        .select()
        .from(trainingRequirementAssignments)
        .where(eq(trainingRequirementAssignments.tenantId, tenantId)),
      db
        .select()
        .from(trainingRecords)
        .where(and(eq(trainingRecords.tenantId, tenantId), isNull(trainingRecords.supersededAt))),
      db
        .select({ id: user.id, name: user.name, deactivatedAt: user.deactivatedAt })
        .from(user)
        .where(eq(user.tenantId, tenantId)),
    ]);

    const requirementById = new Map(requirements.map((r) => [r.id, r]));

    // Role comes from the tenant's own job-title vocabulary (a custom user
    // field), not from a permission set. Missing field = no role, which
    // simply means role-scoped assignments never match — not an error.
    const roleByUser = new Map<string, string>();
    const roleFields = await db
      .select({ id: customUserFields.id, name: customUserFields.name })
      .from(customUserFields)
      .where(eq(customUserFields.tenantId, tenantId));
    const roleFieldIds = roleFields
      .filter((f) => /role|job title|position/i.test(f.name))
      .map((f) => f.id);
    if (roleFieldIds.length > 0) {
      const values = await db
        .select({ userId: userCustomFieldValues.userId, value: userCustomFieldValues.value })
        .from(userCustomFieldValues)
        .where(
          and(
            eq(userCustomFieldValues.tenantId, tenantId),
            inArray(userCustomFieldValues.fieldId, roleFieldIds),
          ),
        );
      for (const v of values) {
        if (typeof v.value === 'string' && v.value.trim() !== '') {
          roleByUser.set(v.userId, v.value.trim());
        }
      }
    }

    const groupsByUser = new Map<string, string[]>();
    const memberships = await db
      .select({ userId: groupMembers.userId, groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.tenantId, tenantId));
    for (const m of memberships) {
      groupsByUser.set(m.userId, [...(groupsByUser.get(m.userId) ?? []), m.groupId]);
    }

    // The population: every active user, plus every account-less person who
    // appears in a record (contractors' operatives, agency staff — the
    // matrix must cover the site, not just the payroll).
    const people: MatrixPerson[] = users
      .filter((u) => u.deactivatedAt === null)
      .map((u) => ({
        userId: u.id,
        name: u.name,
        category: 'employee',
        roleName: roleByUser.get(u.id) ?? null,
        siteIds: [],
        groupIds: groupsByUser.get(u.id) ?? [],
      }));
    const seen = new Set(people.map((p) => personKeyOf(p.userId, p.name)));
    for (const rec of records) {
      if (rec.userId !== null) continue;
      const key = personKeyOf(null, rec.personName);
      if (seen.has(key)) continue;
      seen.add(key);
      people.push({
        userId: null,
        name: rec.personName,
        category: rec.personCategory,
        roleName: null,
        siteIds: [],
        groupIds: [],
      });
    }

    // Records grouped by (person, requirement).
    const recordsByCell = new Map<string, typeof records>();
    for (const rec of records) {
      const key = `${personKeyOf(rec.userId, rec.personName)}::${rec.requirementId}`;
      recordsByCell.set(key, [...(recordsByCell.get(key) ?? []), rec]);
    }

    /** Requirements a person needs — the union across all assignment scopes. */
    function requiredFor(person: MatrixPerson): Set<string> {
      const out = new Set<string>();
      for (const a of assignments) {
        if (!requirementById.has(a.requirementId)) continue;
        const matches =
          (a.scope === 'role' && a.roleName !== null && a.roleName === person.roleName) ||
          (a.scope === 'group' && a.groupId !== null && person.groupIds.includes(a.groupId)) ||
          (a.scope === 'site' && a.siteId !== null && person.siteIds.includes(a.siteId)) ||
          (a.scope === 'person' && a.userId !== null && a.userId === person.userId);
        if (matches) out.add(a.requirementId);
      }
      return out;
    }

    const cells: MatrixCell[] = [];
    for (const person of people) {
      const required = requiredFor(person);
      const key = personKeyOf(person.userId, person.name);
      for (const req of requirements) {
        const held = recordsByCell.get(`${key}::${req.id}`) ?? [];
        const isRequired = required.has(req.id);
        // A cell with neither a requirement nor a record is not a cell —
        // emitting 800 × 30 blanks would drown the grid it is meant to fill.
        if (!isRequired && held.length === 0) continue;
        const status = statusAsOf({
          required: isRequired,
          records: held.map((h) => ({
            achievedAt: h.achievedAt,
            expiresAt: h.expiresAt,
          })),
          leadDays: req.renewalLeadDays,
          asOf: opts.asOf,
        });
        const governing = currentRecord(
          held.map((h) => ({ achievedAt: h.achievedAt, expiresAt: h.expiresAt, id: h.id })),
          opts.asOf,
        );
        cells.push({
          personKey: key,
          personName: person.name,
          userId: person.userId,
          requirementId: req.id,
          requirementName: req.name,
          status,
          expiresAt: governing?.expiresAt ?? null,
          recordId: governing?.id ?? null,
        });
      }
    }

    return { people, cells };
  }

  return router({
    // ─── Requirement catalogue ────────────────────────────────────────────

    listRequirements: tenantProcedure
      .use(requirePermission('training.view'))
      .input(z.object({ includeArchived: z.boolean().default(false) }).optional())
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(trainingRequirements)
          .where(
            and(
              eq(trainingRequirements.tenantId, ctx.tenantId),
              ...(input?.includeArchived === true ? [] : [isNull(trainingRequirements.archivedAt)]),
            ),
          )
          .orderBy(trainingRequirements.name);
        return rows;
      }),

    createRequirement: tenantProcedure
      .use(requirePermission('training.manage'))
      .input(requirementInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const id = newId();
        await ctx.db.insert(trainingRequirements).values({
          id,
          tenantId: ctx.tenantId,
          name: input.name,
          category: input.category,
          obligation: input.obligation,
          validityMonths: input.validityMonths,
          renewalLeadDays: input.renewalLeadDays,
          evidenceNote: input.evidenceNote,
          description: input.description,
        });
        return { id };
      }),

    updateRequirement: tenantProcedure
      .use(requirePermission('training.manage'))
      .input(requirementInput.partial().extend({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        await loadRequirement(ctx.db, ctx.tenantId, input.id);
        const { id, ...patch } = input;
        await ctx.db
          .update(trainingRequirements)
          .set({ ...patch, updatedAt: now() })
          .where(
            and(eq(trainingRequirements.tenantId, ctx.tenantId), eq(trainingRequirements.id, id)),
          );
        return { ok: true };
      }),

    archiveRequirement: tenantProcedure
      .use(requirePermission('training.manage'))
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        await loadRequirement(ctx.db, ctx.tenantId, input.id);
        // Archive, never delete: the records referencing it are evidence.
        await ctx.db
          .update(trainingRequirements)
          .set({ archivedAt: now() })
          .where(
            and(
              eq(trainingRequirements.tenantId, ctx.tenantId),
              eq(trainingRequirements.id, input.id),
            ),
          );
        return { ok: true };
      }),

    // ─── Assignments (who needs what) ─────────────────────────────────────

    listAssignments: tenantProcedure
      .use(requirePermission('training.view'))
      .input(z.object({ requirementId: z.string().min(1).optional() }).optional())
      .query(async ({ ctx, input }) => {
        assertEnabled();
        return ctx.db
          .select()
          .from(trainingRequirementAssignments)
          .where(
            and(
              eq(trainingRequirementAssignments.tenantId, ctx.tenantId),
              ...(input?.requirementId !== undefined
                ? [eq(trainingRequirementAssignments.requirementId, input.requirementId)]
                : []),
            ),
          );
      }),

    addAssignment: tenantProcedure
      .use(requirePermission('training.manage'))
      .input(
        z.object({
          requirementId: z.string().min(1),
          scope: z.enum(TRAINING_ASSIGNMENT_SCOPES),
          roleName: z.string().trim().min(1).max(150).nullable().default(null),
          groupId: z.string().min(1).nullable().default(null),
          siteId: z.string().min(1).nullable().default(null),
          userId: z.string().min(1).nullable().default(null),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        await loadRequirement(ctx.db, ctx.tenantId, input.requirementId);
        // Exactly one target must match the scope, or the assignment
        // silently matches nobody — a rule that looks set and does nothing.
        const target =
          input.scope === 'role'
            ? input.roleName
            : input.scope === 'group'
              ? input.groupId
              : input.scope === 'site'
                ? input.siteId
                : input.userId;
        if (target === null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'assignment-target-required' });
        }
        const id = newId();
        await ctx.db.insert(trainingRequirementAssignments).values({
          id,
          tenantId: ctx.tenantId,
          requirementId: input.requirementId,
          scope: input.scope,
          roleName: input.scope === 'role' ? input.roleName : null,
          groupId: input.scope === 'group' ? input.groupId : null,
          siteId: input.scope === 'site' ? input.siteId : null,
          userId: input.scope === 'person' ? input.userId : null,
        });
        return { id };
      }),

    removeAssignment: tenantProcedure
      .use(requirePermission('training.manage'))
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        await ctx.db
          .delete(trainingRequirementAssignments)
          .where(
            and(
              eq(trainingRequirementAssignments.tenantId, ctx.tenantId),
              eq(trainingRequirementAssignments.id, input.id),
            ),
          );
        return { ok: true };
      }),

    // ─── Records ──────────────────────────────────────────────────────────

    listRecords: tenantProcedure
      .use(requirePermission('training.view'))
      .input(
        z
          .object({
            userId: z.string().min(1).optional(),
            requirementId: z.string().min(1).optional(),
            limit: z.number().int().min(1).max(500).default(200),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        return ctx.db
          .select()
          .from(trainingRecords)
          .where(
            and(
              eq(trainingRecords.tenantId, ctx.tenantId),
              ...(input?.userId !== undefined ? [eq(trainingRecords.userId, input.userId)] : []),
              ...(input?.requirementId !== undefined
                ? [eq(trainingRecords.requirementId, input.requirementId)]
                : []),
            ),
          )
          .orderBy(desc(trainingRecords.achievedAt))
          .limit(input?.limit ?? 200);
      }),

    /**
     * Record a completion. Append-only — this NEVER updates an existing
     * row, because a renewal that overwrites its predecessor destroys the
     * answer to "was this person competent on the day".
     */
    addRecord: tenantProcedure
      .use(requirePermission('training.record'))
      .input(recordInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const req = await loadRequirement(ctx.db, ctx.tenantId, input.requirementId);
        const achievedAt = parseDay(input.achievedAt);
        // An explicit expiry wins (a certificate can state its own); a
        // null one means "never expires" only when the caller says so
        // explicitly, otherwise it derives from the requirement.
        const expiresAt =
          input.expiresAt === undefined
            ? computeExpiry(achievedAt, req.validityMonths)
            : input.expiresAt === null
              ? null
              : parseDay(input.expiresAt);
        const id = newId();
        await ctx.db.insert(trainingRecords).values({
          id,
          tenantId: ctx.tenantId,
          requirementId: input.requirementId,
          userId: input.userId,
          personName: input.personName,
          personCategory: input.personCategory,
          contractorId: input.contractorId,
          achievedAt,
          expiresAt,
          awardingBody: input.awardingBody,
          certificateNumber: input.certificateNumber,
          evidenceKey: input.evidenceKey,
          evidenceFilename: input.evidenceFilename,
          source: input.source,
          notes: input.notes,
          recordedByUserId: ctx.auth.userId,
        });
        return { id, expiresAt };
      }),

    /** Confirm a record against its evidence — distinct from entering it. */
    verifyRecord: tenantProcedure
      .use(requirePermission('training.verify'))
      .input(
        z.object({
          id: z.string().min(1),
          decision: z.enum(['verified', 'rejected']),
          note: z.string().trim().max(1000).nullable().default(null),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        await ctx.db
          .update(trainingRecords)
          .set({
            verificationStatus: input.decision,
            verifiedByUserId: ctx.auth.userId,
            verifiedAt: now(),
            verificationNote: input.note,
          })
          .where(and(eq(trainingRecords.tenantId, ctx.tenantId), eq(trainingRecords.id, input.id)));
        return { ok: true };
      }),

    // ─── The four views ───────────────────────────────────────────────────

    /**
     * The gap list — the default landing view (Nair). Expired first, then
     * expiring, then never-held: the order you would work them in.
     */
    gaps: tenantProcedure
      .use(requirePermission('training.view'))
      .input(
        z
          .object({
            siteId: z.string().min(1).optional(),
            requirementId: z.string().min(1).optional(),
            asOf: z.string().min(8).optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const asOf = input?.asOf !== undefined ? parseDay(input.asOf) : now();
        const { cells } = await resolveMatrix(ctx.db, ctx.tenantId, {
          asOf,
          siteId: input?.siteId,
          requirementId: input?.requirementId,
        });
        const gaps = cells.filter(
          (c) => c.status === 'expired' || c.status === 'expiring_soon' || c.status === 'not_held',
        );
        return {
          asOf,
          expired: gaps.filter((c) => c.status === 'expired'),
          expiringSoon: gaps.filter((c) => c.status === 'expiring_soon'),
          notHeld: gaps.filter((c) => c.status === 'not_held'),
          total: gaps.length,
        };
      }),

    /** One person's wallet — their cards, for the gate and the induction. */
    person: tenantProcedure
      .use(requirePermission('training.view'))
      .input(z.object({ userId: z.string().min(1).optional(), personName: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        if (input.userId === undefined && input.personName === undefined) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'person-required' });
        }
        const asOf = now();
        const { cells } = await resolveMatrix(ctx.db, ctx.tenantId, { asOf });
        const key = input.userId ?? personKeyOf(null, (input.personName ?? '').trim());
        const mine = cells.filter((c) => c.personKey === key);
        const records = await ctx.db
          .select()
          .from(trainingRecords)
          .where(
            and(
              eq(trainingRecords.tenantId, ctx.tenantId),
              input.userId !== undefined
                ? eq(trainingRecords.userId, input.userId)
                : eq(trainingRecords.personName, input.personName ?? ''),
            ),
          )
          .orderBy(desc(trainingRecords.achievedAt));
        return { asOf, cells: mine, records };
      }),

    /** The grid — people × requirements. Filtered, because 800 × 30 is a query. */
    matrix: tenantProcedure
      .use(requirePermission('training.view'))
      .input(
        z
          .object({
            siteId: z.string().min(1).optional(),
            requirementId: z.string().min(1).optional(),
            asOf: z.string().min(8).optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const asOf = input?.asOf !== undefined ? parseDay(input.asOf) : now();
        const { people, cells } = await resolveMatrix(ctx.db, ctx.tenantId, {
          asOf,
          siteId: input?.siteId,
          requirementId: input?.requirementId,
        });
        const requirements = await ctx.db
          .select()
          .from(trainingRequirements)
          .where(
            and(
              eq(trainingRequirements.tenantId, ctx.tenantId),
              isNull(trainingRequirements.archivedAt),
            ),
          )
          .orderBy(trainingRequirements.name);
        return { asOf, people, requirements, cells };
      }),

    /**
     * Compliance roll-up (Bello). Statutory reported apart from mandatory
     * — they carry different consequences and boards ask for them
     * separately — and every figure carries its "as at" date, because a
     * compliance number without one is meaningless.
     */
    compliance: tenantProcedure
      .use(requirePermission('training.view'))
      .input(z.object({ asOf: z.string().min(8).optional() }).optional())
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const asOf = input?.asOf !== undefined ? parseDay(input.asOf) : now();
        const { cells } = await resolveMatrix(ctx.db, ctx.tenantId, { asOf });
        const requirements = await ctx.db
          .select()
          .from(trainingRequirements)
          .where(
            and(
              eq(trainingRequirements.tenantId, ctx.tenantId),
              isNull(trainingRequirements.archivedAt),
            ),
          );
        const obligationById = new Map(requirements.map((r) => [r.id, r.obligation]));
        const statuses = cells.map((c) => c.status);
        const statutory = cells
          .filter((c) => obligationById.get(c.requirementId) === 'statutory')
          .map((c) => c.status);

        const byRequirement = requirements.map((r) => ({
          requirementId: r.id,
          name: r.name,
          obligation: r.obligation,
          percent: compliancePercent(
            cells.filter((c) => c.requirementId === r.id).map((c) => c.status),
          ),
          gaps: cells.filter(
            (c) => c.requirementId === r.id && (c.status === 'expired' || c.status === 'not_held'),
          ).length,
        }));

        return {
          asOf,
          overall: compliancePercent(statuses),
          statutory: compliancePercent(statutory),
          byRequirement: byRequirement.sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101)),
        };
      }),

    /**
     * Reverse lookup: who is qualified for X? The matrix already holds the
     * answer — this makes it a query, for when a job needs two
     * confined-space entrants tomorrow.
     */
    qualifiedFor: tenantProcedure
      .use(requirePermission('training.view'))
      .input(
        z.object({
          requirementId: z.string().min(1),
          includeExpiringSoon: z.boolean().default(true),
        }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const asOf = now();
        const { cells } = await resolveMatrix(ctx.db, ctx.tenantId, {
          asOf,
          requirementId: input.requirementId,
        });
        return cells.filter(
          (c) =>
            c.status === 'in_date' || (input.includeExpiringSoon && c.status === 'expiring_soon'),
        );
      }),

    /**
     * Bulk CSV import of records — Bello's make-or-break. Without it the
     * matrix is empty on day one and stays empty, and it is everyone's
     * migration path off their spreadsheet.
     *
     * Rows are validated individually and reported per-row: a 2,000-row
     * paste with three bad dates imports 1,997 and names the three, rather
     * than failing whole and teaching people not to try again.
     */
    importRecords: tenantProcedure
      .use(requirePermission('training.record'))
      .input(
        z.object({
          rows: z
            .array(
              z.object({
                personName: z.string().trim().min(1).max(200),
                userEmail: z.string().trim().email().optional(),
                requirementName: z.string().trim().min(1).max(200),
                achievedAt: z.string().min(8),
                expiresAt: z.string().min(8).optional(),
                awardingBody: z.string().trim().max(200).optional(),
                certificateNumber: z.string().trim().max(100).optional(),
                personCategory: z.string().trim().max(50).optional(),
              }),
            )
            .min(1)
            .max(2000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const requirements = await ctx.db
          .select()
          .from(trainingRequirements)
          .where(eq(trainingRequirements.tenantId, ctx.tenantId));
        const byName = new Map(requirements.map((r) => [r.name.toLowerCase(), r]));
        const users = await ctx.db
          .select({ id: user.id, email: user.email, name: user.name })
          .from(user)
          .where(eq(user.tenantId, ctx.tenantId));
        const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

        const errors: Array<{ row: number; message: string }> = [];
        const values: Array<typeof trainingRecords.$inferInsert> = [];

        input.rows.forEach((row, i) => {
          const req = byName.get(row.requirementName.toLowerCase());
          if (req === undefined) {
            errors.push({ row: i + 1, message: `unknown-requirement:${row.requirementName}` });
            return;
          }
          const achieved = new Date(`${row.achievedAt.slice(0, 10)}T00:00:00.000Z`);
          if (Number.isNaN(achieved.getTime())) {
            errors.push({ row: i + 1, message: `invalid-date:${row.achievedAt}` });
            return;
          }
          const matchedUser =
            row.userEmail !== undefined ? byEmail.get(row.userEmail.toLowerCase()) : undefined;
          const expires =
            row.expiresAt !== undefined
              ? new Date(`${row.expiresAt.slice(0, 10)}T00:00:00.000Z`)
              : computeExpiry(achieved, req.validityMonths);
          values.push({
            id: newId(),
            tenantId: ctx.tenantId,
            requirementId: req.id,
            userId: matchedUser?.id ?? null,
            personName: matchedUser?.name ?? row.personName,
            personCategory: row.personCategory ?? 'employee',
            achievedAt: achieved,
            expiresAt: expires !== null && Number.isNaN(expires.getTime()) ? null : expires,
            awardingBody: row.awardingBody ?? null,
            certificateNumber: row.certificateNumber ?? null,
            // Imported carries its own evidential weight (Lindqvist).
            source: 'imported',
            recordedByUserId: ctx.auth.userId,
          });
        });

        if (values.length > 0) {
          await ctx.db.insert(trainingRecords).values(values);
        }
        return { imported: values.length, failed: errors.length, errors };
      }),
  });
}
