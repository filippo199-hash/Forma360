# CLAUDE.md — read this every session

You are working on **Forma360**, a competitor to SafetyCulture. This file is
the single page you re-read at the start of every session. It tells you the
stack, the conventions, and where to look for the rest.

## Mission

> Multi-tenant operational-excellence platform. Inspections, issues,
> actions, heads-up, assets, documents, analytics,
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
- **Date display** at `apps/web/src/lib/format-date.ts`. `formatDate` →
  `16 Aug 2026`, `formatDateTime` → `16 Aug 2026, 17:00`. Use these, not
  `toLocaleDateString`. Four conventions were coexisting on the same
  records because `LOCALES` are bare language codes and ICU resolves
  `'en'` to `en-US` — the actions board printed a due date as `8/9/2026`
  while its own detail panel printed `09/08/2026`. On a RIDDOR deadline
  that is not cosmetic: "8/6" reads as 8 June to the person whose
  10-day clock depends on it. The helper maps the app locale to a
  region-qualified display locale (`en` → `en-GB`) and pins one style;
  minutes never seconds, because nothing is due at 52 seconds past.
- Sentry configs at `apps/web/sentry.*.config.ts` + `packages/jobs/src/sentry.ts`.
  **Live since ADR 0016**: options are built once by
  `buildSentryOptions` in `packages/shared/src/sentry-options.ts` and
  shared by all four runtimes (browser / Next server / Next edge /
  worker), so no runtime can forget the scrubber. Every event passes
  through `scrubEvent` (`packages/shared/src/sentry-scrub.ts`, edge cases
  SC-E01..E09) which drops request bodies, cookies, query strings, `extra`
  and console breadcrumbs, allowlists headers/contexts/tags, and redacts
  the opaque `/s/<token>` and `/scan/<token>` access tokens that would
  otherwise be replayable from a Sentry event. Only
  `INTERNAL_SERVER_ERROR` is reported from the tRPC `onError` hook —
  domain guards throw by design and would drown the signal. Session
  Replay is off deliberately. Verify a deployment with
  `POST /api/debug/sentry-check` (admin-gated; captures a real event and
  returns its id).
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

## What Phase 2 left in place (so you don't duplicate it)

Phase 2 ships Templates + Inspections end-to-end: the template content
schema, versioned templates, global response sets, the inspection
lifecycle (start → save progress → sign → approve → complete), rendered
output (PDF / Word / public share link), and the scheduling engine that
materialises recurring inspections. It also lands the `admin`
cross-module cascade-preview primitive.

- **Template content schema** at `packages/shared/src/template-schema.ts`:
  `templateContentSchema`, `TEMPLATE_SCHEMA_VERSION` (currently `1`),
  `TemplateContent`, `parseTemplateContent`. This is the single Zod
  schema that every template-payload boundary runs through — the
  builder, `templates.saveDraft`, `templates.publish`, `importJson`,
  and the conduct reducer. Validates logic nesting ≤ 40 levels (T-E07),
  rejects duplicate signer-slot user assignments (T-E02), enforces
  dense `slotIndex` numbering, and preserves custom response-set
  snapshots (T-E17). See [ADR 0009](./docs/adr/0009-template-content-schema.md).
- **`templates` + `template_versions` tables** at
  `packages/db/src/schema/templates.ts`. Immutability contract:
  **published `template_versions.content` is never UPDATEd**. A "save"
  to a published template always writes a new draft version; publish
  flips `isCurrent` in the same tx. The router enforces this — the DB
  allows UPDATE only so the publish tx can toggle the previous
  current flag to false.
- **`templatesRouter`** at `packages/api/src/routers/templates.ts`:
  `list` / `get` / `getVersion` / `create` / `saveDraft` / `publish` /
  `duplicate` / `archive` / `exportJson` / `importJson` / `exportAllCsv`.
  Carries T-E04 (pin on start), T-E05 (archive pauses schedules in the
  same tx), T-E07 (logic depth), T-E17 (response-set snapshot),
  T-E18 (optimistic concurrency via `expectedUpdatedAt`).
- **`global_response_sets` table + `globalResponseSetsRouter`** at
  `packages/api/src/routers/globalResponseSets.ts`: `list` / `create` /
  `update` / `archive`. Custom response sets are snapshotted into the
  template version content on save — T-E17 semantics.
- **Inspections subgraph tables** at `packages/db/src/schema/inspections.ts`:
  - `inspections` — the conduct row. Pins `templateVersionId` at
    start (T-E04) and freezes an `accessSnapshot` (groups, sites,
    permissions) per [ADR 0007](./docs/adr/0007-access-state-at-time-of-action.md).
    `documentNumber` is stamped inside the create tx, incrementing a
    per-template counter atomically. `archivedAt` added in PR 33 for
    soft-delete (migration 0007).
  - `inspection_signatures` — one row per filled slot. The unique
    `(inspection_id, slot_index)` index is the T-E20 race protection;
    a conflicting insert bubbles up as a tRPC `CONFLICT`.
  - `inspection_approvals` — append-only log of approve / reject
    decisions. Terminal status stamped on the parent `inspections`
    row.
  - `public_inspection_links` — opaque-token public share links
    (revocable). Schema landed in PR 28; the runtime is wired by the
    exports router in PR 31.
- **Phase 2 routers under `packages/api/src/routers/`**:
  - `inspections` — `list` / `get` / `create` / `saveProgress` /
    `submit` / `reject` / `delete`. `create` is the access-snapshot
    site; `saveProgress` uses `expectedUpdatedAt` optimistic
    concurrency.
  - `signatures` — `listSlots` / `sign`. Atomic insert + unique-index
    lean on the DB for T-E20.
  - `approvals` — `approve` / `reject`.
  - `actions` — stub router: `createFromInspectionQuestion` + `list`.
    Phase 3/4 extends this with issue → action conversion and the
    richer action type catalogue.
  - `inspectionsExport` — `exportCsv` / `exportCsvUrl` / `archiveMany`.
    CSV fan-out with an injected `uploadCsv` dep (R2 in prod, stub in
    tests).
  - `exports` — `renderPdf` / `renderDocx` / `createShareLink` /
    `listShareLinks` / `revokeShareLink`. Built via DI
    (`createExportsRouter({ renderPdf, renderDocx, generateShareToken,
    buildShareUrl })`); `buildAppRouter` wires the real implementations
    in prod.
  - `admin` — `previewDependents`. The cross-module cascade preview
    that every destructive admin UI (archive template, anonymise user,
    delete group, …) calls before confirmation. Runs every registered
    resolver in parallel via `getDependents`.
- **`@forma360/render` package** (new in PR 31) at
  `packages/render/src/`. ADR 0008. Surfaces:
  - `renderInspectionPdf` — Puppeteer-backed; a stub fallback returns
    a minimal PDF when Puppeteer is unavailable so tests and the dev
    loop stay green without Chromium.
  - `renderInspectionDocx` — pure `docx` npm-package pipeline.
  - `generateShareToken` / `validateShareToken` / `buildShareUrl` /
    `revokeShareLinkRow` — opaque tokens backed by
    `public_inspection_links`. `SHARE_TOKEN_BYTES = 32`.
  - `signRenderToken` / `verifyRenderToken` — HMAC-signed internal
    token (`RENDER_SHARED_SECRET`) for the Puppeteer-facing `/render`
    route. Default TTL `DEFAULT_RENDER_TOKEN_TTL_SECONDS`.
  - `loadInspectionSnapshot` / `hashInspectionSnapshot` — shared read
    that every renderer consumes.
- **Scheduling** (PR 32):
  - Tables `template_schedules` + `scheduled_inspection_occurrences`
    at `packages/db/src/schema/schedules.ts`. Unique
    `(scheduleId, assigneeUserId, occurrenceAt)` is the idempotency
    key for materialise.
  - `schedulesRouter` at `packages/api/src/routers/schedules.ts`:
    `list` / `listForTemplate` / `get` / `create` / `update` /
    `pause` / `resume` / `delete` / `materialiseNow` / `listUpcoming`.
    `rrule`-backed (rrulestr, validated router-side).
  - Three BullMQ queues in `@forma360/jobs/queues`:
    - `forma360:schedule-tick` — repeatable every ~10 min. Fans
      out to SCHEDULE_MATERIALISE per due schedule.
    - `forma360:schedule-materialise` — computes the next 14 days
      of occurrences and upserts them. Idempotent.
    - `forma360:schedule-reminder` — sends one reminder email for
      one occurrence. Stamps `reminderSentAt` to dedupe.
  - Workers at `packages/jobs/src/workers/schedule-{tick,materialise,reminder}.ts`;
    rrule helper at `workers/schedule-rrule.ts`.
- **Archive hook (T-E05)** — `templates.archive` opens a single tx
  that sets `templates.status='archived'` **and** pauses every
  `template_schedules` row for that template. In-progress inspections
  stay completable; no new starts; schedules won't fire.
- **Dependents resolvers Phase 2 registers**:
  - `templates` (inspections count) — registered by
    `routers/templates.ts` with a zero-returning shim, then overwritten
    by `routers/inspections.ts` with the real inspection count. The
    root router imports templates **before** the PR 28 modules so this
    ordering is deterministic.
  - `inspections` (actions count) — registered by `routers/inspections.ts`.
  - `notifications` (schedules count, keyed on `entity === 'template'`) —
    registered by `routers/schedules.ts` so the archive-template cascade
    preview shows schedule impact.
- **Migrations** (forward-only):
  - `0004_phase2_templates_inspections.sql` — templates,
    template_versions, global_response_sets (+ inspections scaffolding).
  - `0005_phase2_inspections.sql` — inspection_signatures,
    inspection_approvals, public_inspection_links.
  - `0006_phase2_schedules.sql` — template_schedules,
    scheduled_inspection_occurrences.
  - `0007_inspections_archived_at.sql` — `inspections.archived_at`
    for bulk archive.
- **Web routes** (`apps/web/app`):
  - `[locale]/templates` (list) + `[locale]/templates/[templateId]`
    (editor — content, response-sets, logic, settings tabs).
  - `[locale]/inspections` (list) + `[locale]/inspections/[inspectionId]`
    (conduct) + `.../status` + `.../signatures/[slotIndex]`.
  - `[locale]/approvals` + `[locale]/approvals/[inspectionId]`.
  - `[locale]/schedules` + `.../new` + `.../[scheduleId]` + `.../calendar`.
  - `render/inspection/[inspectionId]` — unlocalised Puppeteer-facing
    print route, HMAC-gated.
  - `s/[token]` — public share route; unlocalised; token-gated.
  - `api/upload` — inspection attachments (R2 direct upload).
  - `api/exports/*` — PDF / DOCX download endpoints.
- **Environment**: `RENDER_SHARED_SECRET` (HMAC for `/render` token) is
  now required. Added to `packages/shared/src/env.ts`; `.env.example`
  carries a dummy placeholder. ADR 0008.
- **Test harness**: the `bootDb` helper in `templates.test.ts` /
  `inspections.test.ts` / `schedules.test.ts` now runs `MIGRATION_FILES`
  through `0007_inspections_archived_at.sql`. Add the next migration to
  that list when Phase 3 lands its first schema change.
- **Conduct state machine** at `apps/web/src/components/inspections/conduct-state.ts`
  (+ its test). The reducer is the single source of truth for the
  mobile/desktop conduct UI — updates, logic-triggered visibility, and
  required-question validation all run through it.
- **Template editor reducer** at `apps/web/src/components/templates/editor-state.ts`.
  Unit-tested; wired to the editor UI.

## Phase 2 → Phase 3 handoff

Phase 3 (Issues + Investigations) depends on the surfaces below. The
files are stable — do not duplicate, do not refactor without a separate
PR.

- **`inspectionsRouter`** — Phase 3 reads from it for the "raise an
  issue from an inspection response" flow. The question-id dedup model
  (T-E12 / T-E13) is already wired into the actions router; issues
  will extend the same question-anchor pattern.
- **`actions` stub router** at `packages/api/src/routers/actions.ts`.
  Currently exposes `createFromInspectionQuestion` + `list`. Phase 3
  turns this into the issue → action conversion surface; Phase 4 lands
  the full action-type catalogue.
- **`getDependents('inspection', id)`** — counts actions, registered by
  `routers/inspections.ts` in Phase 2. Phase 3 registers a new
  `'issues'` resolver (and may register `'issues'` counts against the
  `inspection` anchor if issues reference inspections directly).
- **Access rule primitive** (`resolveAccessRule`, `evaluateRules`) —
  still applies. Issues can reference groups, sites, templates, and
  custom user fields via the same rule machinery Phase 1 + Phase 2 use.
- **Dependents registry** — Phase 3 registers the `'issues'` module
  resolver at its router boot. The Phase 1 → Phase 2 pattern holds:
  one `registerDependentResolver('issues', resolver)` call at module
  top-level, executed once when the router is imported.
- **Permission catalogue** — `issues.*` keys already exist in
  `packages/permissions/src/catalogue.ts` (unused until Phase 3).
  Administrator set already holds them. No catalogue change needed.
- **Scheduling pattern** — the three-queue shape
  (`*-tick` → `*-materialise` → `*-reminder`) is a reusable template
  for Phase 3's periodic-investigation reminders. Copy the
  `packages/jobs/src/workers/schedule-*.ts` triad when you need
  rrule-driven fan-out.
- **Render / share-link pattern** — Phase 3's issue public share links
  reuse `generateShareToken` / `validateShareToken` / `buildShareUrl`
  from `@forma360/render`. The `public_inspection_links` table is the
  reference shape for a per-entity share-link table.
- **Access snapshot model (ADR 0007)** — issues that are "in progress"
  (e.g. an investigation with a multi-step workflow) should freeze
  access state at the start event, same as inspections do.
- **Cascade-preview UI hook** — `admin.previewDependents` is the single
  endpoint every destructive admin UI calls. Phase 3's issue archive /
  category delete flows reuse it.

## Brands (ADR 0010) — Forma360 + FreeHS

The codebase ships two products: **Forma360** (forma360.io) and **FreeHS**
(freehs.software). One deployment serves exactly one brand, selected by
`BRAND` + `NEXT_PUBLIC_BRAND` (must match; schema-enforced).

- **Brand config** at `packages/shared/src/brand.ts` (`BRANDS`,
  `getBrand`, `resolveBrandId`). In apps/web, import `activeBrand` from
  `apps/web/src/lib/brand.ts` — works in server AND client code.
- **Never hardcode a product name** in user-facing strings. Web surfaces
  use `activeBrand.name`; i18n copy that differs per brand goes in
  `packages/i18n/overrides/<brand>/<locale>.json` (deep-merged over the
  base bundle at request time — this is also where per-brand module
  titles live). Email templates use the `{productName}` placeholder;
  both dispatchers substitute it from their `productName` dep.
- **Brand differences live in exactly four places**: brand config, i18n
  overrides, the module catalogue (`BRAND_MODULES` + `brandHasModule` in
  `packages/shared/src/brand.ts`), entitlement defaults (future). Inline
  `if (brand === 'x')` in core logic is banned.
- **Brand-only modules**: FreeHS ships `riskAssessments` (module B1 —
  HSE five-step editor at `packages/api/src/routers/riskAssessments.ts` +
  `apps/web/app/[locale]/risk-assessments`; governance layer from
  practitioner feedback round 2: shared banding + severity floors in
  `packages/shared/src/risk-matrix.ts`, immutable publish versions with
  first-class assessor sign-off (`risk_assessment_versions`, migration
  0058), version-aware acknowledgements + `forma360-ra-ack-reminder`
  daily chase worker, per-tenant matrix editor at
  `[locale]/settings/risk-matrix`, PDF download route
  `api/exports/risk-assessment-pdf`; edge-case IDs RA-E01..E30 in
  `riskAssessments.test.ts`, RA-J01/J02 in `ra-ack-reminder.test.ts`,
  RM-E01..E04 in `risk-matrix.test.ts`) and `coshh` (module B2 —
  hazardous-substance inventory at `packages/api/src/routers/coshh.ts` +
  `apps/web/app/[locale]/coshh`; domain helpers in
  `packages/shared/src/coshh.ts`, AI SDS import at
  `apps/web/src/server/coshh-ai.ts` + `/api/ai/coshh-*` routes; schema in
  `packages/db/src/schema/coshh.ts`, migration 0055; edge-case IDs CO-E01..E05
  in `coshh.test.ts` (shared) and CO-E10..E24 (router)) and `permits`
  (module B3 — Permit to Work & High-Risk Activities at
  `packages/api/src/routers/permits.ts` + `apps/web/app/[locale]/permits`
  (register, new, detail, live board at `/permits/board`, type catalogue at
  `/permits/types`); lifecycle state machine + nine seeded default types +
  jsonb payload schemas in `packages/shared/src/permits.ts` (ADR 0012);
  schema in `packages/db/src/schema/permits.ts`, migrations 0059 + 0060; issue
  gate enforces preconditions / EVALUATED gas tests (per-type `gasLimits` +
  freshness, verdict snapshotted per reading) / isolation certificate /
  rescue plan / authorising counter-signature / linked RA where required,
  SIMOPs conflicts need explicit acknowledgement (also re-checked on
  extension); accept/handover refuse lapsed windows; resume needs a real
  attestation + fresh in-range gas re-test; handover can never target the
  authoriser; recording (checks/readings/evidence/gang/entry-log) is open
  to `permits.create` + the named acceptor while lifecycle authority is
  site-scoped via curated `site_members`; workers + entry/exit log with
  closure blocked while anyone is inside; permit PDF via
  `renderPermitPdf` (`/render/permit/[id]` + `/api/exports/permit-pdf`);
  `forma360-permit-expiry-watch` warns 60 min before expiry and escalates
  after it, every 15 min; HSE review + disposition in
  `docs/reviews/permits-hse-expert-review.md` +
  `docs/reviews/permits-hse-review-response.md` (ADR 0012 amendment);
  edge-case IDs PW-E01..E09 in `permits.test.ts` (shared), PW-E10..E35
  (router), PW-J01..J03 in `permit-expiry-watch.test.ts`) and
  `fireSafety` (module B4 — Fire Safety at
  `packages/api/src/routers/fireSafety.ts` +
  `apps/web/app/[locale]/fire-safety` (register, building record with
  logbook/doors/drills/PEEPs/marshals/info tabs, tenant logbook, FRA
  editor); domain helpers in `packages/shared/src/fire-safety.ts` —
  BS-standard check catalogue, FSR 2022 regime classification
  (11 m / 18 m / 7 storeys), FS-1 failed-state display status, bulk-door
  paste parser; schema `packages/db/src/schema/fire-safety.ts`,
  migrations 0060 + 0062; HSE review + hardening in
  `docs/reviews/fire-safety-hse-expert-review.md`: failed checks hold a
  red `failed` state until a pass clears them, follow-up actions
  default-on, FRA publish gates on persons-at-risk / fire-triangle /
  evaluation content, intolerable rating requires an actionable finding
  and alerts `fireSafety.manage` holders (`usersHoldingPermission` at
  `@forma360/permissions/holders`), sign-off staleness + re-attestation,
  FRA PDF via `renderFraPdf` (`/render/fra/[id]` +
  `/api/exports/fra-pdf`), `forma360-fire-due-digest` daily calendar
  digest, per-building marshal-cover flag + target; edge-case IDs
  FS-E01..E09 in `fire-safety.test.ts` (shared), FS-E10..E33 (router),
  FS-J01/J02 in `fire-due-digest.test.ts`) and `incidents` (module B5 —
  Incident & Accident Management at
  `packages/api/src/routers/incidents.ts` + `apps/web/app/[locale]/incidents`
  (register with needs-attention strip + CSV export, mobile-first report
  form with localStorage draft, incident page as a worked file,
  investigation workspace); domain lib `packages/shared/src/incidents.ts`
  (ADR 0013): strict lifecycle reported → triaged → investigating →
  actions_outstanding → closed (⇢ reopened), per-kind jsonb details (8
  kinds; sharps/V&A default confidential — counted-not-readable, enforced
  on every read incl. search/AI/CSV), per-person injury blocks + the
  RIDDOR-counting lost-time calculator with the over-7-day re-screen
  tripwire; guided RIDDOR screening (negative determinations are records;
  10/15-day deadlines; submission freezes the determination; closure
  blocked until discharged); versioned investigations with separated-duty
  sign-off (approver ≠ lead/submitter, approved revisions frozen, reopen
  = revision n+1); findings generate actions exactly once (source unique
  index + savepoint race adoption) with per-finding assignee/due set at
  approval — the actions hub is extended end to end for
  `sourceType 'incident'` (union, list filter, get resolution, web
  chips/links); observation → incident promotion links both ways and
  carries photos by reference; `promptReviews` pulls RA/COSHH/FRA
  `nextReviewAt` to now with new `review_prompted` event kinds;
  effectiveness review at +90 d (30–365) with `not_effective` → reopen;
  workers `forma360-incident-alert` (event-driven, site-scoped manage
  holders, confidential-safe payload), `forma360-incident-riddor-watch`
  (*/15 — T-5/T-2 warnings + past-deadline escalation,
  notify-then-stamp) and `forma360-incident-chase` (daily 06:30, one
  email per owner, quiet when clean); incident PDF via
  `renderIncidentPdf` (`/render/incident/[id]` +
  `/api/exports/incident-pdf`); evidence upload at
  `api/upload/incident-evidence`; schema
  `packages/db/src/schema/incidents.ts` (8 tables incl. append-only
  evidence/witness/events), migration 0063 incl. the PF-8 permission
  backfill onto existing tenants' system sets; the IN-J04
  email-registry-completeness test walks `emails/en/` (and fixed four
  previously unregistered templates incl. both permit-expiry mails; now
  exact 1:1 both directions); HSE review + hardening in
  `docs/reviews/incidents-hse-expert-review.md` +
  `docs/reviews/incidents-hse-review-response.md` (ADR 0013 amendment,
  decisions 9–10): alert worker is truly notify-then-stamp with BullMQ
  retries (IN-A1), `provisionalSeverity` at create from hospitalisation
  + optional reporter judgement with an untriaged overview counter and
  48 h chase bucket (IN-A2), the investigation-level floor is enforced
  at triage/change/screen/submit with `setInvestigationLevel` upgrades
  and auto-raise (IN-A3/A3b), approval demands per-finding assignee +
  due date (IN-A6), sole-manager approval override with logged
  justification when no independent approver exists (IN-A8),
  correction UI for update/setSeverity/assignInvestigator/removePerson/
  removeAbsence/updateFinding (IN-A7), evidence visible pre-
  investigation + full frozen-revision rendering (IN-A9/A9b),
  translated incident emails ×5 locales with locale-aware sends
  (IN-A10), timeline detail payloads rendered (IN-A11); offline items
  IN-A2b/IN-A12 deferred to the next stage;
  edge-case IDs IN-E01..E06 in `incidents.test.ts` (shared),
  IN-E02..E20 + IN-A2..A8 (router), IN-J01..J03 + IN-J02d/e + IN-J03c
  in the worker tests) and `rams` (module B6 — Risk Assessment & Method
  Statement at `packages/api/src/routers/rams.ts` +
  `apps/web/app/[locale]/rams` (register with needs-attention strip + CSV,
  three-motion start screen, pack page, builder, mobile offline briefing,
  method-statement library, contractor-review workspace); domain lib
  `packages/shared/src/rams.ts` (ADR 0015): two lifecycles with explicit
  self-transitions for republish / re-issue, the step content model where
  steps **reference** hazards in bound RA versions rather than restating
  them (dense 1..n sequencing enforced), the issue gate — whose headline
  rule `unreferencedHighRiskHazards` refuses a pack where a high-residual
  bound hazard is addressed by no step — plus PPE / trade / personnel /
  hold-point vocabularies, the review checklist, `RAMS_AUTHOR_ATTESTATION`
  (untranslated by design; snapshotted onto every issued version) and the
  `MS-` / `RAMS-` 6-digit reference formatters; eight seeded starter
  templates carry the authoring-effort load. Binding is by RA **version**,
  and issue freezes a full snapshot (ADR 0007) so a later RA revision
  never alters an issued pack; re-issue writes version n+1 and leaves
  version n's briefings readable-but-not-current, which is what answers
  "what was in force on the day". Briefings are append-only, version-
  anchored, batched for group capture and offline-queued with **surfaced**
  sync failures (the incidents IN-A4 / IN-A12 lesson). Client issue rides
  the existing opaque-share-token family (`/s/[token]`) with an acceptance
  decision recorded against the exact version; the receive side
  (`rams_reviews`) reviews contractors' packs over the existing
  `contractor_documents` record. Permits gain `requiresRamsPack` + the two
  links that satisfy it (own issued pack version / in-date accepted
  review) — seeded types keep the column default so existing tenants are
  unaffected. Pack PDF via `renderRamsPdf` (`/render/rams/[packVersionId]`
  + `/api/exports/rams-pdf`); `suggestBindings` ranks the tenant's own
  published RAs and COSHH records against the job deterministically (a
  rule, not a model — §12 of the spec); schema
  `packages/db/src/schema/rams.ts` (11 tables), migration 0069 incl. the
  PF-8 rams.* permission backfill; edge-case IDs RS-E01..E06/E13/E16 in
  `rams.test.ts` (shared), RS-E03..E12/E15/E17/E18 (router), RS-E14 in
  `permits.test.ts`; HSE review + hardening in
  `docs/reviews/rams-hse-expert-review.md` +
  `docs/reviews/rams-hse-review-response.md` (ADR 0015 amendment): the
  builder route `[packId]/build` (RS-A1 — it was written and never
  committed, which is what made the module unreachable), `TRPCProvider`
  on `app/s/layout.tsx`, the `reviews.submit` intake form, `clientLinks`
  projected to drop `token`, re-issue as a signing event with a
  briefing-invalidation warning, briefing signature capture plus hazards
  in the frozen snapshot (`PackVersionRiskAssessment.hazards`) and PDF
  §2, an idempotent offline briefing queue (`clientRef` + partial unique
  index, migration 0070), `publicDecide` re-decision / pack-status
  guards, the shared `ramsGateError` helper in
  `packages/shared/src/permits.ts` so the permit page previews the
  blocker (`permits.get` returns `ramsGate`), search-param handling on
  `rams/new` and the method-statement editor at
  `rams/library/[methodStatementId]`, translated attestation +
  review-checklist labels, and `client.getLinkUrl` for share-link
  recovery; new edge-case IDs PW-E11 in `permits.test.ts` and the RS-A14
  block in `rams.test.ts`. The actions-hub source vocabulary and the
  Cmd-K category table now live in `apps/web/src/lib/action-sources.ts`
  and `search-categories.ts`, each with a test that scrapes the router
  and fails when a server-side value has no client entry — the fix for
  the RS-A8 / RS-A9 / PF-6 class). Each router is
  built with `{ enabled }` from the brand catalogue; nav + API both gate on
  it.
- **Everything internal stays `forma360`** (package scope, queue names,
  ESLint rule namespace, object keys). Users never see those.
- Each brand gets its own Railway project, Postgres, Redis, R2, Resend
  domain, Sentry and secrets. Databases are never shared across brands.

## Try-it-now sandbox (ADR 0017) — FreeHS only

A visitor can get a real, seeded, signed-in workspace with no account.
Everything hangs off `brand.offersSandbox` (true for FreeHS, false for
Forma360) — do not add a brand conditional anywhere else.

- **Catalogue** at `packages/shared/src/sandbox-scenarios.ts`. Six tiles
  × refinements, gated twice: on `offersSandbox`, then on
  `BRAND_MODULES`. `scenariosForBrand()` returning `[]` is what 404s
  `/try` and the creation endpoint. `resolveSandboxChoice()` refuses an
  unknown pair rather than defaulting.
- **Provisioning** at `packages/api/src/sandbox/provision.ts` — writes
  the same rows `signUpWithTenant` does, plus a `settings.sandbox`
  marker. A sandbox is an ordinary tenant; ADR 0002 is untouched. Seed
  content lives in `seed-data.ts` and is deliberately not i18n'd (it is
  the visitor's data, not chrome). **Each scenario leaves exactly one
  decision open** — keep that property when adding scenarios.
  **Every tile declares a `goal`** on `SandboxScenario`, and
  `provision.goals.test.ts` walks EVERY tile × refinement and asserts it
  against the real database. The map is `Record<SandboxScenarioId, …>`,
  so a new tile without a goal assertion is a type error. A tile that
  ships an empty register is what this exists to prevent — it happened
  once (inspections shipped as a no-op seed, with the gap written in a
  comment; a comment cannot fail CI).
  Three rules the tests enforce, so breaking them fails the suite:
  every seeded reference is claimed through `nextReferenceValue`
  (SB-Q01/Q02); a tile only seeds into the module it *lands on*
  (SB-Q10/Q11); and each tile meets its declared goal (SB-G:*).
  Non-obvious invariants the seeds must respect: an inspection template
  needs `templates.status='published'` AND `templates.currentVersionId`
  AND `templates.titleFormat` — `is_current` alone leaves a template
  that looks published and cannot be started; an FRA left at `draft`
  makes the fire register print "FRA missing"; a `nextReviewAt` in the
  past lights an amber chip on a workspace seconds old.
  **A second rule, learned the same way: a seed must agree with
  itself.** A practitioner walk-through found every tile technically
  populated and half of them internally contradictory — an incident
  badged "Minor / 0 days lost" against a description of a fractured
  wrist and two weeks off (no `incident_persons` or `incident_absences`
  row, `severity` left at its column default); an inspection promised
  "already underway" with ten blank answers and no `conductedBy`, so the
  report printed "Prepared by —"; three observations all stamped with
  the build second, all at one site, all open against a tile promising
  "two still open"; a `withActions` tile whose actions board read
  0/0/0/0; a `reviewPack` tile that seeded our own pack and left the
  contractor-review page reading "No contractor packs awaiting review";
  a permit issued with zero gas readings against a type whose page says
  "the gate evaluates readings against these". Each is now a goal
  assertion (`provision.goals.test.ts`) or a real-procedure visibility
  assertion (`provision.visibility.test.ts`, SB-V11..V13), because a
  register that is populated but incoherent fails a practitioner faster
  than an empty one.
- **Session** at `packages/auth/src/sandbox-session.ts` — mints a real
  better-auth session. It reproduces better-auth's cookie signing and is
  pinned by a round-trip test. If that test fails after a better-auth
  bump, fix the signing; do not weaken the test.
- **Claim** at `packages/api/src/routers/sandbox.ts` — `status` +
  `claim`. Claiming swaps the `@sandbox.invalid` placeholder for a real
  address and stamps `claimedAt`; returning uses the ordinary email-OTP
  flow. The save prompt is never a gate.
- **UI**: `/try` (`app/[locale]/try`), `ScenarioPicker`,
  `POST /api/sandbox/create`, and `SandboxBanner` mounted in the signed-in
  shell. Funnel copy is in `src/content/try.ts` (marketing convention,
  English); in-app copy is i18n'd under the `sandbox` namespace.
- **Tenant defaults** at `packages/api/src/tenant-defaults.ts` —
  observation categories (now including `Good practice`, so the register
  is not only ever bad news) and the four default action types
  (`Corrective` / `Preventive` / `Improvement` / `Maintenance`). Seeded
  by BOTH `auth.signUpWithTenant` and sandbox provisioning; action types
  were never seeded at all before, so every tenant's "Action type"
  dropdown offered exactly one entry — "No type", the NULL fallback.
- **Not yet built**: the TTL sweep for unclaimed sandboxes. The
  `claimedAt` marker exists so that worker can be added without a
  migration.

## ADR index

- [0001 — Monorepo and stack](./docs/adr/0001-monorepo-and-stack.md)
- [0002 — Multi-tenant data model](./docs/adr/0002-multi-tenant-model.md)
- [0003 — ULID over UUID](./docs/adr/0003-ulid-over-uuid.md)
- [0004 — User-table tenant extension](./docs/adr/0004-user-table-tenant-extension.md)
- [0005 — Next.js 16 over 15](./docs/adr/0005-nextjs-16-over-15.md)
- [0006 — Scheduled jobs in BullMQ](./docs/adr/0006-scheduled-jobs-in-bullmq.md)
- [0007 — Access state at time of action](./docs/adr/0007-access-state-at-time-of-action.md)
- [0008 — Rendered output strategy](./docs/adr/0008-rendered-output-strategy.md)
- [0009 — Template content schema](./docs/adr/0009-template-content-schema.md)
- [0010 — Multi-brand, single codebase](./docs/adr/0010-multi-brand-single-codebase.md)
- [0011 — Risk-assessment versioning, sign-off and residual-risk coherence](./docs/adr/0011-risk-assessment-versioning-and-sign-off.md)
- [0012 — Permit-to-work lifecycle, signature model and expiry escalation](./docs/adr/0012-permit-lifecycle-and-signature-model.md)
- [0013 — Incident lifecycle, investigation model and RIDDOR deadline engine](./docs/adr/0013-incident-lifecycle-and-riddor-engine.md)
- [0014 — Navigation information architecture](./docs/adr/0014-navigation-information-architecture.md)
- [0015 — Method-statement content model, RAMS pack versioning and briefing records](./docs/adr/0015-rams-method-statement-and-pack-model.md)
- [0016 — Error reporting and PII scrubbing](./docs/adr/0016-error-reporting-and-pii-scrubbing.md)
- [0017 — Try-it-now sandbox workspaces](./docs/adr/0017-try-it-now-sandbox.md)

Record a new ADR whenever a decision:
- locks you in for more than a phase
- contradicts a default assumption someone would otherwise make
- required discussion to decide
