# ADR 0001 — Monorepo and stack

**Status:** Accepted
**Date:** 2026-04-18

## Context

Forma360 is one product made of ten interlocking modules (Templates &
Inspections, Issues, Actions, Heads Up, Assets & Maintenance, Documents,
Analytics, Compliance, Groups & Sites, Settings). Every cross-module test
in `docs/edge-cases.html` touches at least two of those modules. Splitting
into microservices before product-market fit would turn those tests into
distributed-systems tests.

We also care about strictly shared types between frontend and backend, fast
boot from spec to running feature, and minimum vendor lock-in.

## Decision

One monorepo, one Node process per deployable, one Postgres, one API. Packages
are folders; modules are tRPC router files. Specifically:

| Concern          | Choice                                     |
|------------------|--------------------------------------------|
| Package manager  | pnpm 9 + workspaces                        |
| Build runner     | Turborepo 2                                |
| Frontend web     | Next.js 16 (App Router) + React 19         |
| API              | tRPC v11                                   |
| DB               | Postgres 16                                |
| ORM              | Drizzle (forward-only migrations)          |
| Validation       | Zod 3                                      |
| Auth             | better-auth 1.6 (Drizzle adapter + Redis)  |
| Queue            | Redis + BullMQ 5                           |
| Object storage   | Cloudflare R2 (S3-compatible)              |
| i18n             | next-intl 4 (10 locales from day one)      |
| UI               | Tailwind 4 + shadcn/ui (copied, not CLI)   |
| Email            | Resend (with pino-console fallback in dev) |
| Observability    | Sentry (web + worker) + pino               |
| Testing          | Vitest 2 + Playwright 1.49 + pglite        |
| Deploy           | Railway (six services, one project)        |
| Ids              | ULID (see ADR 0003)                        |
| Module system    | ESM + `moduleResolution: "Bundler"`        |

## Sub-decisions worth recording

### Zod v3, not v4

Zod 4 is GA at the time of writing, but several peers in our stack
(`drizzle-zod`, tRPC v11 in some configurations, `next-intl` validation
helpers, `better-auth` internals) still ship v3-only support. Phase 0
freezes v3 to avoid a peer-dep obstacle course during scaffolding. We
revisit when every peer ships stable v4 support and we have a quiet week.

### next-intl 4, not i18next

next-intl is App-Router-native, supports ICU, and lazy-loads locale bundles
without extra plumbing. i18next + react-i18next would work but would need a
dedicated provider tree and would not participate in RSC streaming.

### better-auth, not NextAuth / Auth.js or Clerk

better-auth gives us sessions, SSO, MFA, password reset, and email
verification with a Drizzle adapter we own. Auth.js works but its
opinionation around adapters and server components has fluctuated; Clerk is
a vendor dependency we would regret at 10k tenants.

### `@better-auth/redis-storage`, not a hand-rolled `secondaryStorage`

The official package wraps ioredis with correct TTL semantics. The
hand-rolled three-function shape better-auth accepts is fine until someone
forgets to call `setex` — our call site calls `redisStorage({ client,
keyPrefix })` instead.

### Scheduled jobs live inside the worker

See [ADR 0006](./0006-scheduled-jobs-in-bullmq.md).

### pglite for the DB integration test harness

pglite runs real Postgres 16 bytecode in WASM. Our pglite-backed tests
validate migrations + queries + FK constraints without Docker. The
Playwright e2e job in CI drives real Postgres + Redis service containers
(see `.github/workflows/ci.yml`) to cover the `pg` pool + network edges.

### Bundler moduleResolution across the workspace

Next 16's webpack does not perform the `.js → .ts` substitution NodeNext
requires. Rather than fight the resolver, every package in the workspace
uses `moduleResolution: "Bundler"` + `module: "ESNext"` with bare-specifier
imports. Every runtime consumer in our tooling (Next, tsx, drizzle-kit's
esbuild, Vitest's Vite) is bundler-aware, so NodeNext semantics are not
needed.

## Consequences

- One CI run typechecks and tests every package together. Turbo's cache
  short-circuits anything that didn't change.
- A new module is a new folder under `packages/api/src/routers/` + a set
  of tables in `packages/db/src/schema/`. No new service.
- When a dependency's peer graph conflicts with our stack, the resolution
  is: stay on our version until it becomes untenable, then migrate
  deliberately in its own PR — not inside a feature PR.
- Mobile (Phase 6) will add `apps/mobile` (Expo) that consumes `@forma360/api`
  types and a subset of `@forma360/ui`. The monorepo shape absorbs that
  without restructure.
