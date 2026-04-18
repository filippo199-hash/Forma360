# ADR 0002 — Multi-tenant data model

**Status:** Accepted
**Date:** 2026-04-18

## Context

Forma360 is billed per-company (per tenant), not per-seat. Every tenant's
data must be isolated from every other tenant's. A permission bug that
leaks one company's inspections to another is an existential-level failure
mode for this product. We need an isolation model that makes cross-tenant
leaks the unusual case that requires deliberate engineering, not the
default that requires vigilance.

## Decision

### Every user-data table has a non-null `tenant_id`

Forward rules, enforced for the lifetime of the project:

1. **Every table that holds user-generated data has a `tenant_id` column.**
   Admin-only lookup tables (feature flags, system settings) are the only
   exception and are explicitly justified in their migration comment.
2. **Every query scopes by `tenant_id`.** Drizzle queries without a
   `tenant_id` clause are caught by code review and — Phase 1+ — by an
   ESLint rule modelled on the i18n rule in `tools/eslint-rules/`.
3. **Composite `(tenant_id, …)` indexes on every major table.** Leading
   `tenant_id` makes scoped queries fast and makes unscoped queries
   visibly expensive in query plans.
4. **The tRPC context carries the tenant id, never the client.** Clients
   may identify themselves (session cookie) but never name a tenant —
   `tenantProcedure` derives `ctx.tenantId` from `ctx.auth.tenantId` and
   makes it available to handlers. Any attempt by a client to supply
   `tenantId` as a procedure input is rejected at review time.

### The first foreign-key hop: `user.tenant_id → tenants.id` RESTRICT

See [ADR 0004](./0004-user-table-tenant-extension.md).

### Cascade model

- **Hard delete of a tenant is disallowed while any user references it.**
  The `RESTRICT` FK on `user.tenant_id` enforces this at the database layer.
- **Soft delete via `tenants.archivedAt`** is the only tenant-removal path
  in Phase 1's admin UI. Downstream records stay queryable against the
  archived tenant for historical compliance.
- **`ON DELETE CASCADE`** is used only inside an already-tenant-scoped
  subgraph — e.g. deleting a `user` cascades to their `session`, `account`,
  and `two_factor` rows. CASCADE is never used to cross tenant boundaries.

### The `getDependents(entity, id)` helper

Phase 1 introduces a generic helper that returns "what depends on this row
across every module?" for cascade previews (the "here's what will be
affected if you archive this site" dialog mandated by
`docs/edge-cases.html`). Every module registers its own dependents; the
helper is the reusable primitive all destructive admin actions use.

## Consequences

- Foreign keys across tables go through `tenant_id` as the first segment of
  every composite index. Postgres plans scoped queries efficiently.
- Migrations must be reviewed for the presence of `tenant_id` on any new
  table. PR 13+ adds this to `CLAUDE.md` as the top of the checklist.
- Cross-tenant "superuser" queries (support staff reading one tenant's
  data) require an explicit, audited override — not a raw SQL escape
  hatch. Phase 9 introduces the support-admin flow.
- A `TypeScript` branded `Id` type (introduced in PR 3) distinguishes
  tenant ids, user ids, etc. at the type level. Future routers can refine
  the brand (`TenantId`, `SiteId`) without runtime cost.

## Non-options that were rejected

- **Per-tenant schemas / databases.** Postgres carries us to 10M rows per
  tenant before sharding is interesting. Per-tenant schemas break our
  single-migration flow and make cross-tenant support queries hard.
- **Row-level security (RLS).** Postgres RLS works but requires us to set
  a session variable at every connection — easy to forget in a BullMQ
  worker or a CSV import script. We enforce at the tRPC boundary where
  the human-written code lives.
- **Sharding by tenant.** Not needed for years. Revisit at ~500 large
  tenants.
