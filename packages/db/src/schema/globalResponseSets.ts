/**
 * Global response sets.
 *
 * Tenant-scoped reusable multiple-choice option bundles (Pass/Fail/N/A,
 * Safety Severity 1-5, ...). Snapshotted into each `template_versions.content`
 * at publish time — edits do NOT retroactively mutate in-progress or
 * completed inspections (T-E17).
 *
 * The live row is what the template editor reads when adding a multiple-choice
 * question that references a global set. The snapshot is what the conduct
 * runtime and renderers read.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const globalResponseSets = pgTable(
  'global_response_sets',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    /** Optional Markdown description visible in the editor. */
    description: text('description'),

    /**
     * Array of `{ id, label, color?, flagged }` options. Triggers on options
     * are template-specific and live on the template content, not here —
     * this is the pure catalogue of labels + flags.
     */
    options: jsonb('options')
      .notNull()
      .$type<
        ReadonlyArray<{
          id: string;
          label: string;
          color?: string | undefined;
          flagged?: boolean | undefined;
        }>
      >()
      .default(sql`'[]'::jsonb`),

    /** Whether this set allows picking multiple options at once. */
    multiSelect: boolean('multi_select').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('global_response_sets_tenant_id_idx').on(table.tenantId, table.name)],
);

export type GlobalResponseSet = typeof globalResponseSets.$inferSelect;
export type NewGlobalResponseSet = typeof globalResponseSets.$inferInsert;
