/**
 * AI-built custom dashboards (ADR 0018).
 *
 * Three tables:
 *
 *   - dashboards           One row per saved dashboard. The whole layout
 *                          lives in `spec` (versioned jsonb, validated by
 *                          `parseDashboardSpec` in @forma360/shared at
 *                          every boundary — never trust it raw). A
 *                          dashboard is data + presentation references
 *                          only; it stores no query results.
 *   - dashboard_shares     Who a `visibility='selected'` dashboard is
 *                          shared with. Irrelevant (and left in place)
 *                          for the other visibilities, so flipping
 *                          visibility back and forth is lossless.
 *   - dashboard_schedules  Recurring PDF-by-email delivery. Recipients
 *                          are free-text addresses (external allowed —
 *                          a product decision, see ADR 0018) so rows
 *                          carry PII; the recipient cap and the send log
 *                          live at the router/worker layer.
 *
 * The paid-plan entitlement gate (`customDashboards`) is enforced at the
 * tRPC layer, not here: a downgraded tenant keeps its rows and regains
 * them on re-upgrade.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { aiConversations } from './ai';
import { user } from './auth';
import { tenants } from './tenants';

export const dashboardStatuses = ['draft', 'published', 'archived'] as const;
export type DashboardStatus = (typeof dashboardStatuses)[number];

export const dashboardVisibilities = ['private', 'selected', 'tenant'] as const;
export type DashboardVisibility = (typeof dashboardVisibilities)[number];

export const dashboards = pgTable(
  'dashboards',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /**
     * CASCADE inside the tenant subgraph (ADR 0002/0004): user rows are
     * anonymised, never hard-deleted, in every normal flow — so this
     * cascade only fires when a whole tenant subgraph is torn down.
     */
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    description: text('description'),

    /**
     * The dashboard spec (widgets, chart hints, filter defaults).
     * `unknown` on purpose: every reader narrows through
     * `parseDashboardSpec` — a row written by a newer schema version must
     * degrade to a parse error, not a silent misrender.
     */
    spec: jsonb('spec').notNull().$type<unknown>(),

    status: text('status', { enum: dashboardStatuses }).notNull().default('draft'),

    visibility: text('visibility', { enum: dashboardVisibilities }).notNull().default('private'),

    /**
     * The builder/refine chat thread for this dashboard. SET NULL: the
     * conversation is an aid, not a dependency — pruning old chats must
     * never delete a dashboard.
     */
    conversationId: varchar('conversation_id', { length: 26 }).references(
      () => aiConversations.id,
      { onDelete: 'set null' },
    ),

    /** Running count of opens — shown on the dashboards home card. */
    viewCount: integer('view_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** Soft delete, stamped when status flips to 'archived'. */
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('dashboards_tenant_status_idx').on(table.tenantId, table.status),
    index('dashboards_tenant_owner_idx').on(table.tenantId, table.ownerUserId),
  ],
);

export type Dashboard = typeof dashboards.$inferSelect;
export type NewDashboard = typeof dashboards.$inferInsert;

export const dashboardShares = pgTable(
  'dashboard_shares',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    dashboardId: varchar('dashboard_id', { length: 26 })
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('dashboard_shares_unique').on(table.dashboardId, table.userId),
    index('dashboard_shares_tenant_user_idx').on(table.tenantId, table.userId),
  ],
);

export type DashboardShare = typeof dashboardShares.$inferSelect;
export type NewDashboardShare = typeof dashboardShares.$inferInsert;

export const dashboardSchedules = pgTable(
  'dashboard_schedules',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Schedules die with the dashboard. */
    dashboardId: varchar('dashboard_id', { length: 26 })
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),

    /** IANA timezone the RRULE evaluates in. */
    timezone: text('timezone').notNull().default('UTC'),
    /** iCalendar RRULE, validated router-side (same contract as template_schedules). */
    rrule: text('rrule').notNull(),
    /** First occurrence anchor. */
    startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Optional bound; null = runs until paused or deleted. */
    endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }),

    /**
     * Free-text recipient email addresses (external allowed). Capped and
     * format-validated at the router; every send is logged with this
     * list so "who received tenant data" stays answerable.
     */
    recipients: jsonb('recipients')
      .notNull()
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`),

    paused: boolean('paused').notNull().default(false),

    /**
     * Dedupe cursor for the tick worker: an occurrence fires only if it
     * falls after `lastSentAt` (notify-then-stamp, the IN-A1 lesson —
     * stamping happens after the send job succeeds).
     */
    lastSentAt: timestamp('last_sent_at', { withTimezone: true, mode: 'date' }),

    /**
     * Who configured the delivery — the accountability anchor for data
     * leaving the platform. Plain text (better-auth user id), no FK, so
     * the audit trail outlives the account (template_schedules precedent).
     */
    createdBy: text('created_by').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('dashboard_schedules_tenant_paused_idx').on(table.tenantId, table.paused),
    index('dashboard_schedules_dashboard_idx').on(table.dashboardId),
  ],
);

export type DashboardSchedule = typeof dashboardSchedules.$inferSelect;
export type NewDashboardSchedule = typeof dashboardSchedules.$inferInsert;
