import { integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Per-(tenant, series) atomic counter for human-facing reference numbers
 * (OBS-000042 for observations, AC-000042 for actions). Replaces the old
 * `count(*) + 1` generators which had no lock and no unique index, so two
 * concurrent creates read the same count and stamped duplicate refs.
 *
 * Claim the next value with an
 *   INSERT … ON CONFLICT (tenant_id, series) DO UPDATE
 *     SET value = value + 1 RETURNING value
 * upsert — atomic under the row lock, so concurrent claims serialize into
 * distinct values. `series` is 'issue' (OBS-) or 'action' (AC-). Actions and
 * maintenance-generated actions share the 'action' series so they never
 * collide on the same `actions` table. Seeded from the current max reference
 * number per tenant at migration time (see 0052_reference_counters.sql).
 */
export const referenceCounters = pgTable(
  'reference_counters',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    series: text('series').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.series] }),
  }),
);

export type ReferenceCounter = typeof referenceCounters.$inferSelect;
