# ADR 0010 — Multi-brand, single codebase

- **Status**: accepted
- **Date**: 2026-08-01

## Context

We are launching a second product, **FreeHS** (freehs.software), alongside
**Forma360** (forma360.io). The two products share the core platform —
inspections, issues, actions, assets, documents, analytics, the AI
assistant — and differ in name, domain, copy (including module titles),
target audience, and business model: FreeHS will be freemium with paid
modules; Forma360's monetisation is undecided.

The alternative — forking the repository — was rejected: every bug fix
would need applying twice, the test suite would be duplicated, and the
entitlement machinery FreeHS needs is machinery Forma360 will also want
once its business model lands.

## Decision

One codebase serves both products. **One deployment serves exactly one
brand**, selected by env:

- `BRAND` (`forma360` | `freehs`, default `forma360`) — server-side brand.
- `NEXT_PUBLIC_BRAND` — build-time mirror for the Next.js client bundle.
  The env schema refuses a deployment where the two disagree, and requires
  the mirror whenever `BRAND` is non-default.

Each brand runs as its own Railway project with its own Postgres, Redis,
R2 bucket, Resend domain, Sentry projects and secrets. Databases are never
shared between brands.

### Brand differences live in exactly four places

1. **Brand config** — `packages/shared/src/brand.ts` (`BRANDS`): product
   name, domain, support/privacy inboxes, legal entity block. Consumed via
   `getBrand(env.BRAND)` on the server and `apps/web/src/lib/brand.ts`
   (`activeBrand`) anywhere in the web app (works in client bundles via
   the inlined `NEXT_PUBLIC_BRAND`).
2. **i18n message overrides** — `packages/i18n/overrides/<brand>/<locale>.json`,
   deep-merged over the base bundle by the next-intl request config.
   This is where per-brand module titles and copy adjustments go. Base
   bundles carry the default brand's copy; overrides carry only diffs.
3. **Module catalogue** (future, Phase FreeHS-1) — which modules exist in
   each product. Gated at the tRPC layer alongside `requirePermission`.
4. **Entitlement defaults** (future, Phase FreeHS-1) — per-tenant plan
   state powering FreeHS's freemium model. Forma360 deployments default
   every tenant to fully entitled until its model is decided.

Inline `if (brand === 'x')` conditionals in core logic are banned — if a
difference cannot be expressed in the four places above, it is a feature
and gets designed as one.

### Email templates are brand-neutral

`packages/i18n/emails/en/*.json` use the `{productName}` placeholder; both
dispatchers in `@forma360/shared/email` substitute it, wired from
`getBrand(env.BRAND).name` at every boot site (web deps files + worker).

### Everything internal keeps the forma360 name

Package scope (`@forma360/*`), BullMQ queue names (`forma360:*`), the
ESLint rule namespace, table names, object-key conventions: unchanged
regardless of brand. Users never see them, and renaming would only create
merge friction. `RESEND_FROM` carries the per-brand sender identity via
env, not code.

## Consequences

- A FreeHS deployment is: same repo, new Railway project,
  `BRAND=freehs` + `NEXT_PUBLIC_BRAND=freehs`, its own infra + secrets,
  FreeHS values for `APP_URL`, `BETTER_AUTH_URL`, `RESEND_FROM`, R2 and
  Sentry variables.
- Migrations run against every brand's database; forward-only discipline
  (ADR 0002 / ground rule 5) now protects two production databases.
- Tests must pass with the default brand (nothing set) — brand-specific
  behaviour is tested by passing explicit brand values, never by mutating
  global env in-place.
- FreeHS launches as a trading name of Forma360 Ltd. **Confirm the final
  legal structure before the freehs.software legal pages go live**; the
  values sit in one place (`BRANDS.freehs`).
- The `verify-changes` QA flow and Playwright smoke run against a single
  deployment and therefore a single brand at a time; brand-affected
  changes should be spot-checked under both `BRAND` values.
