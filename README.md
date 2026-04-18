# Forma360

Multi-tenant operational-excellence platform. Inspections, issues, actions,
heads-up, assets & maintenance, documents, analytics, compliance, and
everything that sits around them.

Phase 0 (the foundation) is what lives here today. See
[`FORMA360_BUILD_PLAN.md`](./FORMA360_BUILD_PLAN.md) for the full 10-phase
roadmap.

## Quickstart

Requires [Node 22](https://nodejs.org/) and
[pnpm 9](https://pnpm.io/installation).

```bash
# Clone, install, seed .env
git clone https://github.com/filippo199-hash/Forma360.git
cd Forma360
cp .env.example .env
pnpm install

# Bring up a local Postgres + Redis (optional — pglite covers unit tests)
docker compose -f tools/test-db/docker-compose.yml up -d

# Update DATABASE_URL / REDIS_URL in .env to point at 5433 / 6380 if you
# used the Compose file above, then run the migrations:
pnpm --filter @forma360/db db:migrate

# Dev
pnpm dev
# → http://localhost:3000/en
```

## Commands

```bash
pnpm dev                    # run every package's dev task
pnpm build                  # next build + any other build tasks
pnpm typecheck              # tsc --noEmit across every package
pnpm lint                   # eslint across every package
pnpm test                   # vitest run
pnpm test:e2e               # Playwright smoke
pnpm test:eslint-rules      # our custom ESLint rules' own suite
pnpm db:generate            # drizzle-kit generate after a schema change
pnpm db:migrate             # apply migrations
pnpm db:studio              # drizzle-kit studio (web DB UI)
pnpm format                 # prettier --write .
```

## Repo layout

```
apps/web                    Next.js 16 app
packages/api                tRPC routers
packages/auth               better-auth server + client
packages/db                 Drizzle schema + migrations + client
packages/i18n               next-intl config + 10 locales + email templates
packages/jobs               BullMQ worker (nightly pg_dump backup + more)
packages/permissions        Permission catalogue (Phase 1+)
packages/shared             env, id (ULID), logger, email, storage
packages/ui                 shadcn/ui components (Phase 1+ will populate)
tools/eslint-rules          Custom ESLint rules (no-hardcoded-strings)
tools/test-db               Docker Compose for opt-in integration runs
docs/                       Spec + deployment + ADRs
```

## Read before you build

- [`CLAUDE.md`](./CLAUDE.md) — the single page every Claude session reads
  first. Stack, conventions, ground rules, command cheat sheet.
- [`docs/modules-overview.html`](./docs/modules-overview.html) — feature spec.
- [`docs/edge-cases.html`](./docs/edge-cases.html) — test plan; every
  edge-case ID maps to a test file.
- [`docs/deployment.md`](./docs/deployment.md) — Railway setup walkthrough.
- [`docs/adr/`](./docs/adr/) — architecture decision records. Read all of
  them before touching the foundation.

## License

Proprietary. Not for redistribution.
