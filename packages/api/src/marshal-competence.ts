/**
 * Resolve fire-marshal competence against the training matrix (FS-X01).
 *
 * `fire_marshals` carried its own `trainedAt` / `trainingExpiresAt`, and the
 * fire register read only that row — while `training_records`, the module
 * built to answer "are these people trained", holding the certificates, the
 * verification status and the evidence keys, was never consulted. The
 * module's comment still said "training dates are carried locally until
 * Phase 10"; Training (B7) shipped in migration 0071.
 *
 * Both directions were live:
 *   - a marshal who renewed their ticket stayed `expired` on the fire
 *     register, kept counting as no cover, and kept being chased daily;
 *   - and — the worse one — anybody could type a future date into the fire
 *     register and the marshal read competent, satisfying the building's
 *     marshal target and closing the coverage gap that exists to force the
 *     training, with no record behind it and nothing to contradict it.
 *
 * This module lives in `packages/api` rather than in the router because the
 * `forma360-fire-due-digest` worker computes marshal status independently.
 * A router-private resolver would leave the worker to either re-implement
 * the join — a second FS-X01 in six months — or keep chasing the wrong
 * people. `packages/jobs` already imports `@forma360/api/notify` and
 * `@forma360/api/heads-up-publish` for exactly this reason.
 *
 * The DECISION stays pure and unit-tested in
 * `packages/shared/src/fire-safety.ts` (`marshalCompetence`); this file only
 * does the loading.
 */
import type { Database } from '@forma360/db/client';
import { fireSafetySettings, trainingRecords } from '@forma360/db/schema';
import { marshalCompetence, type MarshalCompetence } from '@forma360/shared/fire-safety';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

/**
 * Which training requirements this tenant counts as a fire-marshal ticket.
 *
 * Empty is the default and means "no designation" — the pre-FS-X01
 * behaviour, in which the local dates are all there is and no claim about
 * backing is made either way. So this ships inert.
 */
export async function loadMarshalRequirementIds(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ ids: fireSafetySettings.marshalRequirementIds })
    .from(fireSafetySettings)
    .where(eq(fireSafetySettings.tenantId, tenantId))
    .limit(1);
  const ids = rows[0]?.ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export interface MarshalRow {
  /** Null for a free-text marshal with no account (NR3-10). */
  userId: string | null;
  trainedAt: Date | null;
  trainingExpiresAt: Date | null;
}

/**
 * Competence for a set of marshals in ONE tenant, keyed by `userId`.
 *
 * The governing record is the most recently achieved non-superseded record
 * the person holds against ANY designated requirement — any-of, because
 * holding the higher ticket must not be voided by lacking the lower. (Permits
 * use all-of, because a permit type asserts several distinct competences;
 * here there is one competence with several possible evidences.)
 *
 * One query for the whole set rather than one per marshal: the register
 * renders every marshal in a building, and the digest every marshal in a
 * tenant.
 */
export async function resolveMarshalCompetence(
  db: Database,
  tenantId: string,
  marshals: ReadonlyArray<MarshalRow>,
  now: Date,
): Promise<Map<string | null, MarshalCompetence>> {
  // Keyed `string | null` so callers can pass a nullable `userId` straight
  // through, but a null key is NEVER set: several free-text marshals would
  // share it and their verdicts differ. Callers fall back to the local
  // dates for those rows (a free-text marshal cannot be matrix-backed).
  const out = new Map<string | null, MarshalCompetence>();
  if (marshals.length === 0) return out;

  const requirementIds = await loadMarshalRequirementIds(db, tenantId);
  const designated = requirementIds.length > 0;

  /** userId → the most recently achieved governing record. */
  const governingByUser = new Map<string, { achievedAt: Date; expiresAt: Date | null }>();
  if (designated) {
    const userIds = [
      ...new Set(marshals.flatMap((m) => (m.userId !== null ? [m.userId] : []))),
    ];
    if (userIds.length > 0) {
      const rows = await db
        .select({
          userId: trainingRecords.userId,
          achievedAt: trainingRecords.achievedAt,
          expiresAt: trainingRecords.expiresAt,
        })
        .from(trainingRecords)
        .where(
          and(
            eq(trainingRecords.tenantId, tenantId),
            inArray(trainingRecords.requirementId, requirementIds),
            inArray(trainingRecords.userId, userIds),
            // A superseded record is history, not competence — the same
            // exclusion the training matrix itself applies.
            isNull(trainingRecords.supersededAt),
          ),
        )
        .orderBy(desc(trainingRecords.achievedAt));
      // Ordered newest-first, so the first row per user wins.
      for (const r of rows) {
        if (r.userId === null || governingByUser.has(r.userId)) continue;
        governingByUser.set(r.userId, { achievedAt: r.achievedAt, expiresAt: r.expiresAt });
      }
    }
  }

  for (const m of marshals) {
    if (m.userId === null) continue;
    out.set(m.userId, marshalCompetence(m, governingByUser.get(m.userId) ?? null, now, designated));
  }
  return out;
}
