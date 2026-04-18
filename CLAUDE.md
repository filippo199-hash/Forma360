# CLAUDE.md — read this every session

You are working on **Forma360**, a competitor to SafetyCulture. This file is
the single page you re-read at the start of every session. It tells you the
stack, the conventions, and where to look for the rest.

## Mission

> Multi-tenant operational-excellence platform. Inspections, issues,
> actions, heads-up, assets & maintenance, documents, analytics,
> compliance, groups & sites, settings — ten modules that share one
> database, one API, one tRPC boundary.

We are building in 10 phases over ~28 weeks. Phase 0 is done when this
file is in the repo on `main`.

## Source-of-truth documents

| Document                              | Purpose                                              |
| ------------------------------------- | ---------------------------------------------------- |
| `FORMA360_BUILD_PLAN.md`              | Ten-phase roadmap, locked stack, Railway topology    |
| `docs/modules-overview.html`          | Feature spec for every module                        |
| `docs/edge-cases.html`                | Test plan. Each edge-case ID maps to a test file     |
| `docs/deployment.md`                  | Railway setup walkthrough                            |
| `docs/adr/*.md`                       | Architecture decision records (read all of them)     |

**Before implementing a module**, read the relevant section of
`docs/modules-overview.html` and all edge cases for that module in
`docs/edge-cases.html`. Every edge-case ID has a corresponding test file.
**The test comes first.**

## Stack (versions locked in ADR 0001)

- Node 22 LTS, pnpm 9.15, Turborepo 2
- Next.js 16 (App Router) + React 19
- tRPC v11 + superjson + Zod 3
- Drizzle ORM + drizzle-kit + Postgres 16
- better-auth 1.6 with Drizzle adapter + `@better-auth/redis-storage`
- Redis + BullMQ 5 (all scheduled jobs live in the worker — ADR 0006)
- Cloudflare R2 via `@aws-sdk/client-s3`
- Resend for email, with `EMAIL_DELIVERY=console` fallback in dev
- next-intl 4 (10 locales from day one)
- Tailwind 4 + shadcn/ui (copied, not via CLI)
- Sentry (web + worker) + pino (structured logging)
- Vitest 2 + Playwright 1.49 + pglite for tests
- Railway deploy (6 services: web, worker, cron, postgres, redis, R2)

## Folder conventions

```
apps/web                  Next.js app (app router). Route handlers + UI.
packages/api              tRPC routers; one folder per module.
packages/auth             better-auth server factory + React client.
packages/db               Drizzle schema + migrations + client.
packages/i18n             next-intl config + messages + email templates.
packages/jobs             BullMQ queues + worker entry. Phase-0 only the
                          `test` + `backups` queues.
packages/permissions      Permission catalogue + helpers (Phase 1+).
packages/shared           env, id (ULID), logger (pino), email, storage.
tools/eslint-rules        Custom ESLint rules (no-hardcoded-strings).
tools/test-db             Docker Compose for opt-in local integration runs.
```

Each package has an explicit `exports` map pointing at `.ts` source. The
whole workspace uses `moduleResolution: "Bundler"` + `module: "ESNext"`
with bare-specifier imports (no `.js` extension needed on relative imports).

## Twelve ground rules (non-negotiable)

1. **Strict TypeScript**: `strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`. No `any`. No `as` outside proven
   boundaries (commented). No `@ts-ignore`. `@ts-expect-error` with the
   exact reason on the same line if genuinely needed.
2. **Zod at every boundary.** Every tRPC procedure has an `input` schema.
   Every env var is parsed through the schema in
   `packages/shared/src/env.ts`. Every external API response (Resend,
   Sentry, R2) is validated before we trust it.
3. **i18n from line one.** Every user-facing string goes through
   `t('key')`. Hardcoded JSX strings are caught by the
   `forma360/no-hardcoded-strings` ESLint rule.
4. **Multi-tenancy from line one.** Every user-data table has
   `tenant_id`. Every query scopes by tenant. `tenantProcedure` derives
   the tenant id from the session — never from client input. See
   ADR 0002.
5. **Forward-only migrations.** Drizzle migrations are timestamped and
   never edited once on `main`. Add a new migration for schema changes.
6. **Server is the only source of truth for permissions.** UI may hide
   elements for UX; all access checks live at the tRPC layer via
   `requirePermission(perm)` (Phase 1+).
7. **No `console.log`.** Use pino (`@forma360/shared/logger`). `no-console`
   is enforced by ESLint (tests + scripts exempt).
8. **No secrets in code.** All secrets come from the env schema. `.env` is
   gitignored; `.env.example` carries dummy placeholders.
9. **Every dependency has a purpose.** Before adding a dep, check if the
   stack already solves it. Prefer the lightest option.
10. **Tests next to code.** `foo.ts` + `foo.test.ts` in the same folder.
    Vitest picks up `*.test.ts` across every package.
11. **Commits are small, conventional, labelled.** `feat:` / `fix:` /
    `chore:` / `test:` / `docs:` / `refactor:`. One logical change per
    commit.
12. **Ask before straying.** If the request conflicts with this file or
    the build plan, or if something is genuinely underspecified, ask
    before assuming. Do not silently substitute a different library or
    pattern.

## Command cheat sheet

```bash
pnpm install                # install all workspace deps
pnpm dev                    # run every package's dev task via Turbo
pnpm build                  # build the web app (+ any other build tasks)
pnpm typecheck              # tsc --noEmit across every package
pnpm lint                   # eslint across every package
pnpm test                   # vitest run across every package
pnpm test:eslint-rules      # RuleTester suite for our custom ESLint rules
pnpm test:e2e               # Playwright smoke (boots `pnpm start` unless
                            #  PLAYWRIGHT_BASE_URL is set)
pnpm format                 # prettier --write .
pnpm format:check           # prettier --check . (CI)
pnpm db:generate            # drizzle-kit generate (after schema change)
pnpm db:migrate             # apply migrations via drizzle-kit
pnpm db:studio              # drizzle-kit studio (web UI for the DB)
pnpm --filter @forma360/shared test:r2  # manual R2 smoke test
```

## Before implementing a module — the checklist

1. Read that module's section in `docs/modules-overview.html`.
2. List every edge-case ID that applies (look under that module's header
   in `docs/edge-cases.html`).
3. For each edge-case ID, write the test first (`foo.test.ts` next to the
   file that will hold the implementation). Make sure it fails.
4. Implement until the test passes.
5. Commit per logical unit; open the PR with the edge-case IDs and their
   test file paths in the description.

## Database contract (see ADR 0002)

- Every user-data table has a non-null `tenant_id`.
- Every tRPC procedure that reads/writes that table uses `tenantProcedure`.
- FK from `user.tenant_id` → `tenants.id` is `ON DELETE RESTRICT` (ADR 0004).
- Hard delete of a tenant is never a normal flow; archive via
  `tenants.archivedAt`.
- Inside a tenant subgraph (user → session/account/two_factor), CASCADE is
  fine. Across tenants, CASCADE is banned.

## What Phase 0 left in place (so you don't duplicate it)

- Env schema at `packages/shared/src/env.ts`. Add new vars here first.
- ULID helper at `packages/shared/src/id.ts`. Use `newId()` for every id.
- Drizzle client at `packages/db/src/client.ts`. Don't create Pools
  elsewhere.
- tRPC context factory at `packages/api/src/context.ts`. Don't reach out
  to env from a procedure — accept what the factory provides.
- Procedure helpers at `packages/api/src/procedures.ts`:
  `publicProcedure`, `authedProcedure`, `tenantProcedure`. Phase 1 adds
  `requirePermission(perm)`.
- Logger at `packages/shared/src/logger.ts`. Child loggers for request /
  tenant / user context.
- Email dispatcher at `packages/shared/src/email.ts`. `EMAIL_DELIVERY`
  routes between Resend and pino-console; prod-safety check refuses
  console in production.
- Object-key convention in `packages/shared/src/storage.ts`:
  `<tenantId>/<module>/<entityId>/<filename>` — validated by a Zod schema.
- i18n lint rule at `tools/eslint-rules/no-hardcoded-strings.js` — enforced
  on `apps/web/app/**/*.tsx` + `packages/ui/src/**/*.tsx`.
- Sentry configs at `apps/web/sentry.*.config.ts` + `packages/jobs/src/sentry.ts`.
- Request-id flow: middleware generates → header-forwarded to route
  handler → passed into `createContext` → echoed back on response.
- Playwright smoke at `apps/web/e2e/smoke.spec.ts`.

## What Phase 1 left in place (so you don't duplicate it)

Phase 1 ships the organisational backbone: tenants, users with custom
fields, permission sets, groups, sites, advanced access rules, and the
reconcile jobs that keep rule-based membership materialised.

- **Permission catalogue** at `packages/permissions/src/catalogue.ts`.
  64 keys across 17 modules. Import the type `PermissionKey` or use the
  `isPermissionKey` guard at every boundary. Administrator ⇔ holds
  `org.settings` (see `grantsAdminAccess`).
- **`requirePermission(perm)` middleware** at
  `packages/api/src/procedures.ts`. Wraps `tenantProcedure`; exposes
  `ctx.permissions` downstream. Every Phase 1 mutation uses it.
- **Permission-set primitives** at `@forma360/permissions/{seed,admins}`:
  - `seedDefaultPermissionSets(db, tenantId)` — idempotent Administrator
    / Manager / Standard seeding. Call from every new-tenant flow.
  - `countAdmins(db, tenantId)` + `wouldDropBelowMinAdmins(db, input)` —
    the S-E02 last-admin guard. Use these whenever a mutation could
    decrease the admin count.
- **Rule evaluator** at `@forma360/permissions/rules`: `evaluateRules`
  (pure, OR across rules, AND across conditions) + `validateRuleConditions`
  (router-side static check).
- **Advanced access-rule resolver** at `@forma360/permissions/access`:
  `resolveAccessRule(rule, user)`. Every Phase 2+ module that gates
  features goes through this.
- **`getDependents` cascade-preview registry** at
  `@forma360/permissions/dependents`. Call `registerDependentResolver(
  module, fn)` **once** at router boot from every future module. Phase 1
  registers: `users`, `permissionSets`, `customUserFields`, `groups`,
  `sites`, `accessRules`. Graceful-degrading:  a throwing resolver
  counts as 0, so one buggy module cannot freeze the admin cascade UI.
- **BullMQ queues** at `@forma360/jobs/queues`:
  - `forma360:group-membership-reconcile` — enqueued on
    `groups.setRules` + on user custom-field change (Phase 1 reconcile
    handler evaluates every user and diffs into `group_members`; G-E02
    15k cap is deterministic).
  - `forma360:site-membership-reconcile` — analogous.
  - `forma360:user-anonymisation` — async fan-out; Phase 1 handler
    logs. Later phases attach per-module anonymiser hooks.
- **Migrations**: `0002_permissions.sql` and `0003_phase1_org_backbone.sql`.
  Forward-only.
- **Routers at `packages/api/src/routers/`**:
  - `permissions` — permission-sets CRUD + `assignToUser` (S-E02 guard).
  - `users` — list / get / updateProfile / invite / deactivate /
    reactivate / anonymise (S-E09) / setCustomFieldValue.
  - `customFields` — CRUD + S-E04 deletion guard.
  - `groups` — CRUD, manual membership, rule set, archive → G-E06
    access-rule invalidation.
  - `sites` — CRUD, hierarchy with G-17 move semantics, matrix, G-E06
    invalidation on archive, G-E07 max-depth, G-E10 rule-based guard.
  - `accessRules` — CRUD + `listInvalid` + re-activate on update.
- **`invalidateAccessRulesReferencing(db, tenantId, 'group'|'site', id)`**
  in `routers/accessRules` — the single helper future modules call when
  they archive something referenced by access rules.

## Phase 1 → Phase 2 handoff

Phase 2 (Templates & Inspections) will depend on all of the below. The
files are stable — do not duplicate, do not refactor without a separate
PR.

- **`requirePermission`** — use `templates.*`, `inspections.*` keys
  from the catalogue. Procedures Phase 2 adds:
  - `templatesRouter` at `packages/api/src/routers/templates.ts`.
  - `inspectionsRouter` at `packages/api/src/routers/inspections.ts`.
- **Access rules primitive** — templates are gated by a list of access
  rules. Call `resolveAccessRule(rule, userSnapshot)` at every read.
  Phase 2's inspection model takes a snapshot at start — see
  [ADR 0007](./docs/adr/0007-access-state-at-time-of-action.md).
- **`getDependents('template', id)`** — Phase 2 **registers** a
  `templates` resolver. Phase 1 provides the registry; Phase 2 populates.
- **Custom user fields** — templates can reference user fields in
  conditional question logic and rule-based assignment. Read via
  `@forma360/db/schema → customUserFields` + `userCustomFieldValues`.
- **CSV import / export framework** — Phase 1's bulk user import +
  export framework (arriving in a follow-on PR) is the pattern
  templates will reuse for their own import / export.
- **ADR 0007 (access state at time of action)** — the snapshot model
  every in-progress action follows. Templates lock this in first
  (template version snapshot on inspection start).

## ADR index

- [0001 — Monorepo and stack](./docs/adr/0001-monorepo-and-stack.md)
- [0002 — Multi-tenant data model](./docs/adr/0002-multi-tenant-model.md)
- [0003 — ULID over UUID](./docs/adr/0003-ulid-over-uuid.md)
- [0004 — User-table tenant extension](./docs/adr/0004-user-table-tenant-extension.md)
- [0005 — Next.js 16 over 15](./docs/adr/0005-nextjs-16-over-15.md)
- [0006 — Scheduled jobs in BullMQ](./docs/adr/0006-scheduled-jobs-in-bullmq.md)
- [0007 — Access state at time of action](./docs/adr/0007-access-state-at-time-of-action.md)

Record a new ADR whenever a decision:
- locks you in for more than a phase
- contradicts a default assumption someone would otherwise make
- required discussion to decide
