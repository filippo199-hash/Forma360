# ADR 0004 — Extending the better-auth user table with `tenant_id`

**Status:** Accepted
**Date:** 2026-04-17

## Context

better-auth generates four core tables (`user`, `session`, `account`,
`verification`) plus plugin-specific tables (`two_factor` for the TOTP plugin).
These table shapes are part of better-auth's contract with the Drizzle
adapter — diverging breaks the adapter at runtime.

Forma360 is a multi-tenant platform. **Every human user belongs to exactly one
tenant.** That link is load-bearing: every tRPC procedure scopes by
`ctx.tenantId`, which is read from the session's user. If the user row does
not carry a tenant id, the whole multi-tenancy model collapses into something
we'd have to glue on via a secondary table and an extra join on every request.

We therefore need a `tenant_id` column on `user` from migration 0001 onwards.
better-auth does not know about this column — it would be deleted or ignored
by naive `auth generate` runs — so we need a durable rule for keeping the
hand-authored extension alive through future schema regenerations.

## Decision

1. **better-auth owns the table list and the built-in column set.**
   `user`, `session`, `account`, `verification`, and `two_factor` live in
   `packages/db/src/schema/auth.ts`. Their column names, types, and nullability
   match better-auth's documented expectations exactly.

2. **Forma360 adds exactly one non-null column to `user`:**
   ```ts
   tenantId: text('tenant_id')
     .notNull()
     .references(() => tenants.id, { onDelete: 'restrict' }),
   ```
   - `notNull`: a user without a tenant is not valid in this system.
   - `onDelete: 'restrict'`: a tenant cannot be hard-deleted while any user
     references it. Archive the tenant (soft-delete via `archivedAt`) and
     migrate users out before hard-deletion.
   - `references(() => tenants.id)`: enforced at the DB layer, not just
     application code, so a race between user creation and tenant archival
     cannot produce orphaned rows.

3. **`twoFactorEnabled` on `user` is the other hand-authored column**,
   but that one is added by the TOTP plugin itself — it is not a Forma360
   extension, just a plugin-required field we materialise in our handwritten
   schema file.

4. **Regeneration procedure.** If we ever need to re-run better-auth's
   schema generator (e.g. upgrading to a version that adds new core columns):
   1. Run `npx auth@latest generate --adapter drizzle` into a *scratch*
      directory (not over `packages/db/src/schema/auth.ts`).
   2. Diff the scratch output against the current `auth.ts`.
   3. Manually apply any new better-auth changes to `auth.ts`.
   4. **Preserve the `tenantId` column and its FK.** Preserve any other
      Forma360 extensions added after this ADR (they must each be listed
      here before merge).
   5. Generate a new migration via `drizzle-kit generate`. Do not edit
      prior migration files.

## Consequences

- Every new user creation path (sign-up, CSV import, SSO provisioning) must
  set `tenant_id` at creation time. We enforce this in the tRPC layer
  (`tenantProcedure` never accepts the tenant id from the client; it is
  derived from the request context or from the current admin's membership).
- Tests asserting the FK constraint live in `packages/db/src/client.test.ts`
  and run against pglite.
- If a future better-auth release adds its own `tenantId` column with
  different semantics (e.g. for their Organisations plugin), we rename ours
  to `forma360_tenant_id` before upgrading rather than letting the two collide.
