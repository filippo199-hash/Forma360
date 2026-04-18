# Forma360 — Railway deployment

This document walks through setting up the Railway project from scratch. Do
the steps in order; each service depends on the previous ones being green.

## Topology

Six pieces, one Railway project:

1. **`web`** — Next.js app (public domain).
2. **`worker`** — BullMQ worker process (no public domain).
3. **`cron`** — reserved; defined-but-empty in Phase 0. See
   [ADR 0006](./adr/0006-scheduled-jobs-in-bullmq.md).
4. **`postgres`** — managed Postgres plugin (private only + Railway backups +
   nightly `pg_dump` → R2 from the worker).
5. **`redis`** — managed Redis plugin (private only).
6. **R2** (external) — Cloudflare R2 bucket for objects, logs, and backups.

All services communicate over Railway's private network
(`postgres.railway.internal`, `redis.railway.internal`).

## One-time setup

### 1. Create the project

1. Create a new project in the Railway dashboard.
2. Add the **Postgres 16** and **Redis 7** managed plugins from the catalogue.
3. Note the private `DATABASE_URL` and `REDIS_URL` Railway provisions. Every
   downstream service will reference them.

### 2. Provision R2

1. In the Cloudflare dashboard, create an R2 bucket called `forma360-prod`
   (or `forma360-staging` for the staging environment).
2. Create an API token scoped to that bucket with read + write permissions.
3. Grab the `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
   the bucket's public URL.

### 3. Add the `web` service

1. **New service → deploy from GitHub** → pick the repo.
2. **Settings → Build**:
   - Root directory: `/` (the repo root, not `apps/web`).
   - Railway auto-detects `apps/web/railway.toml` and `apps/web/nixpacks.toml`
     when you set the **service** root to `apps/web` in the service settings
     — **do that now**. The build command resolves the whole pnpm workspace
     and then scopes `next build` to `@forma360/web`.
3. **Networking → Public domain**: generate a Railway domain (or attach a
   custom one).
4. **Environment variables** — set all of the following. Values for the
   managed plugins are available via Railway's reference syntax
   (`${{Postgres.DATABASE_URL}}` etc.):

   ```
   NODE_ENV=production
   APP_URL=<the public URL, e.g. https://forma360.app>
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   BETTER_AUTH_SECRET=<openssl rand -hex 32>
   BETTER_AUTH_URL=<same as APP_URL>
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=forma360-prod
   R2_PUBLIC_URL=https://cdn.forma360.app
   RESEND_API_KEY=...
   RESEND_FROM=Forma360 <noreply@forma360.app>
   EMAIL_DELIVERY=resend
   SENTRY_DSN=<server-side Sentry DSN>
   NEXT_PUBLIC_SENTRY_DSN=<client-side Sentry DSN>
   LOG_LEVEL=info
   SENTRY_AUTH_TOKEN=<only needed if you want source-map uploads>
   ```

   The env schema (`packages/shared/src/env.ts`) rejects boot if any of
   these are missing or malformed. The refinement in that schema also refuses
   `EMAIL_DELIVERY=console` when `NODE_ENV=production` — that's intentional.

5. **Pre-deploy command** — already set in `apps/web/railway.toml`:
   `pnpm --filter @forma360/db db:migrate`. It runs against the new image
   before traffic rolls over; a failed migration blocks the deploy.

6. Trigger a deploy. The health check at `/api/trpc/health.ping` should
   return 200.

### 4. Add the `worker` service

1. **New service → deploy from GitHub** → the same repo.
2. **Settings → Build**:
   - Root directory: `/` (repo root).
   - Service root: `packages/jobs`. Railway picks up
     `packages/jobs/railway.toml` + `packages/jobs/nixpacks.toml` from there.
3. **Networking**: do NOT expose a public domain. The worker only talks to
   Postgres / Redis / R2 / Sentry outbound.
4. **Environment variables**: the same set as `web`, except `APP_URL`,
   `BETTER_AUTH_*`, and `NEXT_PUBLIC_SENTRY_DSN` are not needed (the
   worker doesn't serve HTTP). Easiest path: copy them all via the "Shared
   Variables" feature and let the worker ignore the ones it doesn't consume.
5. The worker's image includes `postgresql_16` (see
   `packages/jobs/nixpacks.toml`) so the nightly `pg_dump` handler resolves.
6. Trigger a deploy. Tail the logs and confirm the
   `[worker] registered pg-dump-nightly repeatable` line appears.

### 5. Add the `cron` service (reserved)

1. Create a third service cloned from the worker setup, but point its
   start command at a placeholder: `node -e "console.log('cron reserved')"`
   — this is intentional per ADR 0006. The service exists so Phase 3+
   backfill jobs can deploy into it without a new Railway service creation.
2. Scale it to **0 replicas** until we actually use it.

### 6. Verify the backup job

1. In the worker's "Deployments" view, use the "Run command" affordance:
   ```
   pnpm --filter @forma360/jobs exec node -e "import('./src/main.ts')"
   ```
   Or wait for 03:00 UTC and confirm the `[backup] complete` log line fires.
2. Check the R2 bucket for `backups/<YYYY-MM-DD>.sql.gz`.
3. Download one sample, `gunzip`, confirm it's a valid pg_dump text file.

## Preview environments

- Branch deploys: enable **"Automatic PR environments"** in the Railway
  project settings. Every push to a feature branch spins up an isolated set
  of the six services with its own Postgres + Redis. Branch environments
  auto-destruct when the PR closes.
- The `.env.example` at the repo root lists every variable the preview envs
  need; copy the production values and override `APP_URL` +
  `BETTER_AUTH_URL` to the preview-specific Railway domain.

## Rollback

- Railway keeps the last N deployments active; use the dashboard's "Rollback"
  action on the `web` service to revert to an earlier build.
- Forward-only migrations mean a rollback will leave the database with the
  newer schema. That's safe for additive migrations — our migration style
  guide requires every migration to be backward-compatible with the
  previous release.

## Operational runbook pointers

- **Logs**: Railway's log viewer shows pino JSON from every service. Filter
  by `service=web` or `service=worker`. Every log line carries
  `request_id` / `tenant_id` / `user_id` for correlation once those fields
  are populated by the per-request context (web only).
- **Errors**: Sentry is the primary surface. The `web` project receives
  browser + server errors; the `worker` project receives job failures.
- **Database console**: use Railway's web SQL console or connect locally via
  `pnpm --filter @forma360/db db:studio` with `DATABASE_URL` set to the
  private Railway URL (requires Railway CLI tunnelling).
