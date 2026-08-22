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
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@forma360/db/client';
import {
  groupMembers,
  siteMembers,
  sites,
  trainingRecords,
  trainingRequirementAssignments,
  trainingRequirements,
  user,
  userCustomFieldValues,
  customUserFields,
} from '@forma360/db/schema';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
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
import { assertGroupsInTenant, assertSitesInTenant, assertUsersInTenant } from '../tenant-guards';
import { router } from '../trpc';

/**
 * TR-V02: an unfiltered matrix serialises every person × requirement cell.
 * The module is specified for 800 × 30 = 24,000 cells, which is unusable as a
 * grid and expensive to build. Above this ceiling the caller must narrow by
 * site or requirement — either filter bounds the grid. Both filters together
 * would be even smaller; only the no-filter case is refused.
 */
const MATRIX_UNFILTERED_CELL_LIMIT = 5000;

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
  /**
   * Is this requirement actually assigned to this person? (TR-A7)
   *
   * A cell also exists for a record someone holds but is no longer
   * required to — a machine operator who moved to the office keeps his
   * abrasive-wheels card in the wallet. Those cells must NOT reach the
   * gap list (noise in the one view designed to be actionable) or the
   * compliance denominator (a lapsed voluntary card must not drag the
   * board number), so every consumer filters on this.
   */
  required: boolean;
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
    // TR-C07: a tenant can have more than one field matching the heuristic
    // (e.g. a decoy "Roles and responsibilities" beside the real "Job
    // title"). Collecting every match and writing all their values into one
    // map last-wins is nondeterministic — whichever row the database returned
    // last silently won, which could strip an operator of a statutory
    // requirement and only make the gap list shorter. Choose exactly ONE
    // field, deterministically: lowest display order, then oldest, then id.
    const roleByUser = new Map<string, string>();
    const roleFields = await db
      .select({
        id: customUserFields.id,
        name: customUserFields.name,
        order: customUserFields.order,
        createdAt: customUserFields.createdAt,
      })
      .from(customUserFields)
      .where(eq(customUserFields.tenantId, tenantId));
    const roleField = roleFields
      .filter((f) => /role|job title|position/i.test(f.name))
      .sort(
        (a, b) =>
          a.order - b.order ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )[0];
    if (roleField !== undefined) {
      const values = await db
        .select({ userId: userCustomFieldValues.userId, value: userCustomFieldValues.value })
        .from(userCustomFieldValues)
        .where(
          and(
            eq(userCustomFieldValues.tenantId, tenantId),
            eq(userCustomFieldValues.fieldId, roleField.id),
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

    // Site membership, so site-scoped assignment resolves and the site
    // filter narrows a 800 x 30 grid to something readable (TR-A10).
    const sitesByUser = new Map<string, string[]>();
    const siteMemberships = await db
      .select({ userId: siteMembers.userId, siteId: siteMembers.siteId })
      .from(siteMembers)
      .where(eq(siteMembers.tenantId, tenantId));
    for (const m of siteMemberships) {
      sitesByUser.set(m.userId, [...(sitesByUser.get(m.userId) ?? []), m.siteId]);
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
        siteIds: sitesByUser.get(u.id) ?? [],
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

    const inScope =
      opts.siteId === undefined
        ? people
        : people.filter((p) => p.siteIds.includes(opts.siteId as string));

    const cells: MatrixCell[] = [];
    for (const person of inScope) {
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
          required: isRequired,
        });
      }
    }

    return { people: inScope, cells };
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
        // TR-T05: ground rule 4 — the scope target is a client-supplied FK
        // and must belong to this tenant. A foreign-tenant id used to insert
        // cleanly and then match nobody (resolveMatrix builds membership from
        // THIS tenant's rows), a rule that looks set and silently does
        // nothing — the exact failure the target-required check above guards
        // against. The FK cascades, so the other tenant could also delete the
        // rule. `role` is free text, not an FK, so it needs no check.
        if (input.scope === 'group') {
          await assertGroupsInTenant(ctx.db, ctx.tenantId, [input.groupId]);
        } else if (input.scope === 'site') {
          await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
        } else if (input.scope === 'person') {
          await assertUsersInTenant(ctx.db, ctx.tenantId, [input.userId]);
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
        // TR-B12: ground rule 4 — a client-supplied user id is never taken
        // on trust. An id from another tenant used to insert cleanly and
        // then vanish from every view, which is a silent integrity hole.
        if (input.userId !== null) {
          const owner = await ctx.db
            .select({ id: user.id })
            .from(user)
            .where(and(eq(user.id, input.userId), eq(user.tenantId, ctx.tenantId)))
            .limit(1);
          if (owner[0] === undefined) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'user-not-in-tenant' });
          }
        }
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
        // TR-I06: the natural-key unique index (migration 0076) also guards
        // manual entry — a person cannot hold two *active* records for the
        // same requirement achieved on the same day (a renewal carries a
        // later date; a correction supersedes first). Surface the collision
        // as a clean BAD_REQUEST rather than letting the raw constraint
        // bubble up as an INTERNAL_SERVER_ERROR.
        const inserted = await ctx.db
          .insert(trainingRecords)
          .values({
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
          })
          .onConflictDoNothing()
          .returning({ id: trainingRecords.id });
        if (inserted[0] === undefined) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'duplicate-record' });
        }
        return { id, expiresAt };
      }),

    /**
     * Void a record (TR-A8).
     *
     * An append-only store cannot edit, so it MUST be able to supersede —
     * shipping the read filter without the writer was the worst of both.
     * The row stays readable (the audit trail is the point) but drops out
     * of the current matrix, which is what `supersededAt` always meant.
     *
     * Without this, a fat-fingered expiry of 2099 wins forever: because
     * `currentRecord` prefers the furthest-reaching cover, that person is
     * permanently in date, permanently absent from the gap list, and —
     * now the gate is wired — permanently passes it.
     */
    supersedeRecord: tenantProcedure
      .use(requirePermission('training.record'))
      .input(
        z.object({
          id: z.string().min(1),
          reason: z.string().trim().min(1).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(trainingRecords)
          .where(and(eq(trainingRecords.tenantId, ctx.tenantId), eq(trainingRecords.id, input.id)))
          .limit(1);
        const record = rows[0];
        if (record === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'record-not-found' });
        }
        if (record.supersededAt !== null) {
          throw new TRPCError({ code: 'CONFLICT', message: 'already-superseded' });
        }
        await ctx.db
          .update(trainingRecords)
          .set({
            supersededAt: now(),
            // Kept with the row rather than in a side table: the reason a
            // record was voided is part of the evidence.
            notes:
              record.notes === null
                ? `[voided] ${input.reason}`
                : `${record.notes}\n[voided] ${input.reason}`,
          })
          .where(and(eq(trainingRecords.tenantId, ctx.tenantId), eq(trainingRecords.id, input.id)));
        return { ok: true };
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
        const { cells, people } = await resolveMatrix(ctx.db, ctx.tenantId, {
          asOf,
          siteId: input?.siteId,
          requirementId: input?.requirementId,
        });
        const peopleInScope = people.length;
        // TR-A7: only cells the person is actually REQUIRED to hold. A
        // lapsed card someone is no longer required to have is not a gap;
        // listing it is noise in the one view built to be actionable.
        const gaps = cells.filter(
          (c) =>
            c.required &&
            (c.status === 'expired' || c.status === 'expiring_soon' || c.status === 'not_held'),
        );
        // SWP-B1 (the TR-B13 class one level up): a tenant that has never
        // DEFINED a requirement read "No gaps. Every required record is in
        // date." — an empty register presenting as a passed audit. The page
        // needs to know the difference between clean and unconfigured.
        const requirementRows = await ctx.db
          .select({ id: trainingRequirements.id })
          .from(trainingRequirements)
          .where(eq(trainingRequirements.tenantId, ctx.tenantId))
          .limit(1);
        return {
          asOf,
          expired: gaps.filter((c) => c.status === 'expired'),
          expiringSoon: gaps.filter((c) => c.status === 'expiring_soon'),
          notHeld: gaps.filter((c) => c.status === 'not_held'),
          total: gaps.length,
          // TR-B13: site scoping resolves through `site_members`, a curated
          // table. A tenant that has never curated it gets an empty grid and
          // no explanation — "no gaps" and "nobody is a member of this site"
          // look identical, and the reassuring one is the wrong one.
          siteHasNoMembers: input?.siteId !== undefined && peopleInScope === 0,
          hasRequirements: requirementRows.length > 0,
        };
      }),

    /** One person's wallet — their cards, for the gate and the induction. */
    // TR-B10: NOT permission-gated as a whole — your own wallet is your
    // own record. The org-wide read is gated inline below.
    person: tenantProcedure
      .input(
        z
          .object({
            userId: z.string().min(1).optional(),
            personName: z.string().optional(),
          })
          .default({}),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        // No argument = the caller's own wallet. This is what makes
        // `/training/me` a personal door rather than another org-wide
        // view (TR-A5), and it can never resolve to someone else.
        // Treat an empty string as absent: the wallet page has no props to
        // pass for "me", and `{ personName: '' }` used to fall past this
        // branch into `WHERE person_name = ''`, which matches nothing —
        // an empty wallet for every user in every tenant (TR-B2).
        const askedUserId =
          input.userId === undefined || input.userId === '' ? undefined : input.userId;
        const askedName =
          input.personName === undefined || input.personName.trim() === ''
            ? undefined
            : input.personName.trim();
        const target: { userId?: string; personName?: string } =
          askedUserId === undefined && askedName === undefined
            ? { userId: ctx.auth.userId }
            : askedUserId !== undefined
              ? { userId: askedUserId }
              : { personName: askedName as string };

        // TR-B10: your own wallet needs no permission — it is your own
        // record. Anyone else's is an org-wide read and needs
        // `training.view`, which Standard no longer holds. Mirrors the
        // self-access rule on `users.get`.
        const isSelf = target.userId === ctx.auth.userId;
        if (!isSelf) {
          const perms = await loadUserPermissions(ctx.db, ctx.tenantId, ctx.auth.userId);
          if (!perms.includes('training.view') && !grantsAdminAccess(perms)) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'training.view' });
          }
        }

        const asOf = now();
        const { cells } = await resolveMatrix(ctx.db, ctx.tenantId, { asOf });
        // The cell key must follow the RESOLVED target, not the raw input,
        // or "what am I missing" stays blank even once records are right
        // (a not_held requirement exists only as a cell) — TR-B2.
        const key = target.userId ?? personKeyOf(null, target.personName ?? '');
        const mine = cells.filter((c) => c.personKey === key);
        const records = await ctx.db
          .select()
          .from(trainingRecords)
          .where(
            and(
              eq(trainingRecords.tenantId, ctx.tenantId),
              target.userId !== undefined
                ? eq(trainingRecords.userId, target.userId)
                : eq(trainingRecords.personName, target.personName ?? ''),
            ),
          )
          .orderBy(desc(trainingRecords.achievedAt));
        // The resolved display name, so a page addressed only by id (or by
        // nothing, for "me") can title itself without a second round trip.
        const named =
          target.userId !== undefined
            ? (
                await ctx.db
                  .select({ name: user.name })
                  .from(user)
                  .where(and(eq(user.id, target.userId), eq(user.tenantId, ctx.tenantId)))
                  .limit(1)
              )[0]?.name
            : target.personName;
        return { asOf, cells: mine, records, personName: named ?? null, isSelf };
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
        // TR-V02: an unfiltered grid serialises every person × requirement
        // cell. Refuse above the ceiling and ask for a site or requirement
        // filter — either bounds the grid (a site narrows the people, a
        // requirement narrows to one column). The estimate is a cheap
        // upper-bound count, run only when no filter is present.
        if (input?.siteId === undefined && input?.requirementId === undefined) {
          const [users, reqs, nameOnly] = await Promise.all([
            ctx.db
              .select({ n: count() })
              .from(user)
              .where(and(eq(user.tenantId, ctx.tenantId), isNull(user.deactivatedAt))),
            ctx.db
              .select({ n: count() })
              .from(trainingRequirements)
              .where(
                and(
                  eq(trainingRequirements.tenantId, ctx.tenantId),
                  isNull(trainingRequirements.archivedAt),
                ),
              ),
            ctx.db
              .select({ n: sql<number>`count(distinct lower(${trainingRecords.personName}))` })
              .from(trainingRecords)
              .where(
                and(
                  eq(trainingRecords.tenantId, ctx.tenantId),
                  isNull(trainingRecords.userId),
                  isNull(trainingRecords.supersededAt),
                ),
              ),
          ]);
          const population = Number(users[0]?.n ?? 0) + Number(nameOnly[0]?.n ?? 0);
          const requirementCount = Number(reqs[0]?.n ?? 0);
          if (population * requirementCount > MATRIX_UNFILTERED_CELL_LIMIT) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'matrix-too-large' });
          }
        }
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
              // TR-B7: a filtered grid must have ONE column. Returning every
              // requirement while `cells` was filtered rendered 29 columns of
              // "–", asserting that people are not required to hold tickets
              // they are — and `exportRows` wrote that into the CSV and the
              // PDF, where it leaves the building.
              ...(input?.requirementId !== undefined
                ? [eq(trainingRequirements.id, input.requirementId)]
                : []),
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
        // TR-A7: the denominator is what people are REQUIRED to hold. A
        // held-but-unrequired card must not drag the board number.
        const required = cells.filter((c) => c.required);
        const statuses = required.map((c) => c.status);
        const withObligation = (o: string) =>
          required.filter((c) => obligationById.get(c.requirementId) === o).map((c) => c.status);

        const byRequirement = requirements.map((r) => {
          const mine = required.filter((c) => c.requirementId === r.id);
          return {
            requirementId: r.id,
            name: r.name,
            obligation: r.obligation,
            percent: compliancePercent(mine.map((c) => c.status)),
            gaps: mine.filter((c) => c.status === 'expired' || c.status === 'not_held').length,
          };
        });

        // TR-A12: the board asks by area first, so the roll-up has to
        // answer by area — not only by requirement.
        const siteRows = await ctx.db
          .select({ id: sites.id, name: sites.name })
          .from(sites)
          .where(and(eq(sites.tenantId, ctx.tenantId), isNull(sites.archivedAt)));
        const memberships = await ctx.db
          .select({ userId: siteMembers.userId, siteId: siteMembers.siteId })
          .from(siteMembers)
          .where(eq(siteMembers.tenantId, ctx.tenantId));
        const sitesForUser = new Map<string, string[]>();
        for (const m of memberships) {
          sitesForUser.set(m.userId, [...(sitesForUser.get(m.userId) ?? []), m.siteId]);
        }
        const byArea = siteRows
          .map((site) => {
            const mine = required.filter(
              (c) => c.userId !== null && (sitesForUser.get(c.userId) ?? []).includes(site.id),
            );
            return {
              siteId: site.id,
              name: site.name,
              percent: compliancePercent(mine.map((c) => c.status)),
              gaps: mine.filter((c) => c.status === 'expired' || c.status === 'not_held').length,
            };
          })
          .filter((a) => a.percent !== null)
          .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101));

        return {
          asOf,
          overall: compliancePercent(statuses),
          // Statutory and mandatory carry different consequences and the
          // board asks for them apart (TR-A12).
          statutory: compliancePercent(withObligation('statutory')),
          mandatory: compliancePercent(withObligation('mandatory')),
          byRequirement: byRequirement.sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101)),
          byArea,
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
                /** 1-based line in the user's file, so errors name THEIR row. */
                sourceRow: z.number().int().min(1).optional(),
              }),
            )
            .min(1)
            .max(2000),
          /**
           * TR-B4: rows the client could not parse at all, passed through so
           * they appear in the failure report instead of vanishing.
           */
          skipped: z
            .array(z.object({ row: z.number().int().min(1), message: z.string().max(200) }))
            .max(2000)
            .default([]),
          /** TR-B6: report what WOULD be written, without writing it. */
          dryRun: z.boolean().default(false),
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
        // TR-B5: most LMS extracts carry a payroll number, not an email.
        // Without a name fallback every such row became a NAME-ONLY person
        // sitting beside the same human's account in the matrix — the same
        // nurse twice, once with a wall of not_held and once holding every
        // card, wrong in both directions at once.
        const byName_ = new Map<string, Array<(typeof users)[number]>>();
        for (const u of users) {
          const k = u.name.trim().toLowerCase();
          byName_.set(k, [...(byName_.get(k) ?? []), u]);
        }

        // Rows the CLIENT could not parse start in the failure list, so a
        // dropped row is never reported as a success (TR-B4).
        const errors: Array<{ row: number; message: string }> = [...input.skipped];
        const values: Array<typeof trainingRecords.$inferInsert> = [];
        let matchedToUsers = 0;
        let nameOnly = 0;

        input.rows.forEach((row, i) => {
          // The user's own line number, not an index into a filtered array.
          const rowNo = row.sourceRow ?? i + 1;
          const req = byName.get(row.requirementName.toLowerCase());
          if (req === undefined) {
            errors.push({ row: rowNo, message: `unknown-requirement:${row.requirementName}` });
            return;
          }
          const achieved = new Date(`${row.achievedAt.slice(0, 10)}T00:00:00.000Z`);
          if (Number.isNaN(achieved.getTime())) {
            errors.push({ row: rowNo, message: `invalid-date:${row.achievedAt}` });
            return;
          }

          let matchedUser =
            row.userEmail !== undefined ? byEmail.get(row.userEmail.toLowerCase()) : undefined;
          if (matchedUser === undefined && row.userEmail === undefined) {
            const candidates = byName_.get(row.personName.trim().toLowerCase()) ?? [];
            if (candidates.length === 1) {
              matchedUser = candidates[0];
            } else if (candidates.length > 1) {
              // Guessing between two people with the same name is how a
              // competence record ends up on the wrong human. Report it.
              errors.push({ row: rowNo, message: `ambiguous-person:${row.personName}` });
              return;
            }
          }
          if (matchedUser !== undefined) matchedToUsers += 1;
          else nameOnly += 1;

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

        // TR-B6: re-running the same extract used to insert everything a
        // second time, and the only undo was voiding rows one at a time.
        // The natural key is (requirement, person, achieved date).
        let skippedDuplicates = 0;
        if (values.length > 0) {
          const existing = await ctx.db
            .select({
              requirementId: trainingRecords.requirementId,
              userId: trainingRecords.userId,
              personName: trainingRecords.personName,
              achievedAt: trainingRecords.achievedAt,
            })
            .from(trainingRecords)
            .where(eq(trainingRecords.tenantId, ctx.tenantId));
          const seen = new Set(
            existing.map(
              (e) =>
                `${e.requirementId}::${personKeyOf(e.userId, e.personName)}::${e.achievedAt.toISOString().slice(0, 10)}`,
            ),
          );
          const fresh = values.filter((v) => {
            const key = `${v.requirementId}::${personKeyOf(v.userId ?? null, v.personName)}::${(v.achievedAt as Date).toISOString().slice(0, 10)}`;
            if (seen.has(key)) return false;
            // Also dedupe WITHIN the file, so one extract cannot fight itself.
            seen.add(key);
            return true;
          });
          // TR-I06: the in-memory `seen` set catches re-runs and within-file
          // dupes, but it is advisory — two imports running at once both read
          // an empty set and both insert. The partial unique index on the
          // natural key (migration 0076) is the real guard; onConflictDoNothing
          // turns a racing insert into a skip rather than a crash, and
          // RETURNING counts what actually landed so the report stays honest.
          let insertedCount = 0;
          if (!input.dryRun && fresh.length > 0) {
            const inserted = await ctx.db
              .insert(trainingRecords)
              .values(fresh)
              .onConflictDoNothing()
              .returning({ id: trainingRecords.id });
            insertedCount = inserted.length;
          }
          skippedDuplicates = values.length - (input.dryRun ? fresh.length : insertedCount);
          return {
            imported: input.dryRun ? 0 : insertedCount,
            wouldImport: fresh.length,
            failed: errors.length,
            errors,
            matchedToUsers,
            nameOnly,
            skippedDuplicates,
            dryRun: input.dryRun,
          };
        }
        return {
          imported: 0,
          wouldImport: 0,
          failed: errors.length,
          errors,
          matchedToUsers,
          nameOnly,
          skippedDuplicates,
          dryRun: input.dryRun,
        };
      }),
  });
}
