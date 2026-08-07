import type { Database } from '@forma360/db/client';
import { referenceCounters } from '@forma360/db/schema';
import { sql } from 'drizzle-orm';

/**
 * Reference-number series. 'issue' → OBS-, 'action' → AC-,
 * 'riskAssessment' → RA-, 'coshhSubstance' → CS-, 'coshhAssessment' → COSHH-,
 * 'permit' → PTW-, 'fireRiskAssessment' → FRA-, 'incident' → IN-,
 * 'methodStatement' → MS-, 'ramsPack' → RAMS-.
 */
export type ReferenceSeries =
  | 'issue'
  | 'action'
  | 'riskAssessment'
  | 'coshhSubstance'
  | 'coshhAssessment'
  | 'permit'
  | 'fireRiskAssessment'
  | 'incident'
  | 'methodStatement'
  | 'ramsPack';

/**
 * Atomically claim the next reference number for a (tenant, series).
 *
 * The old generators did `SELECT count(*) … + 1`, which has no lock — two
 * concurrent creates read the same count and stamped duplicate refs. This
 * upsert increments under the row lock, so concurrent claims serialize into
 * distinct values. All actions use the 'action' series so they can't
 * collide on the shared `actions` table.
 *
 * Returns the new integer; callers format it (e.g. `OBS-${n.padStart(6)}`).
 */
export async function nextReferenceValue(
  db: Database,
  tenantId: string,
  series: ReferenceSeries,
): Promise<number> {
  const rows = await db
    .insert(referenceCounters)
    .values({ tenantId, series, value: 1 })
    .onConflictDoUpdate({
      target: [referenceCounters.tenantId, referenceCounters.series],
      set: { value: sql`${referenceCounters.value} + 1` },
    })
    .returning({ value: referenceCounters.value });
  return rows[0]?.value ?? 1;
}
