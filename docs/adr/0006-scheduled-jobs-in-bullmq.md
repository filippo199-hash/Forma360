# ADR 0006 — All scheduled work runs as BullMQ repeatable jobs

**Status:** Accepted
**Date:** 2026-04-18

## Context

The Railway topology (see `FORMA360_BUILD_PLAN.md`) defines two services that
could plausibly host scheduled work:

- **`worker`** — the long-running BullMQ worker process.
- **`cron`** — a separate Railway cron service.

Phase 0 requires a working nightly `pg_dump` → R2 backup before exit, and
Phase 4+ introduces many more scheduled jobs (digests, compliance
re-evaluation, schedule-runner, notification batching). We need one
execution surface for all of them.

## Decision

All scheduled work runs **inside the BullMQ `worker` service** as repeatable
jobs registered via `queue.upsertJobScheduler(...)`. The `cron` Railway service
is defined but reserved — empty in Phase 0 and kept empty unless we hit a
specific future use case the worker can't serve.

Concrete implementation:
- `packages/jobs/src/worker.ts` registers every repeatable schedule on boot
  using `upsertJobScheduler`, which is idempotent keyed by the scheduler id.
- Individual handlers live in `packages/jobs/src/workers/<name>.ts` and are
  constructed via injection (DB, R2, logger passed in) so they're testable.
- Cron strings live next to the handler (e.g. `PG_DUMP_CRON = '0 3 * * *'`)
  rather than in a central registry; the worker entry imports the handler
  and its schedule together.

## Rationale

1. **One execution surface.** One logger, one Sentry DSN, one pool of Redis
   connections, one shutdown lifecycle. Adding a second Railway service
   that runs code doubles those concerns for no benefit.
2. **Idempotent registration.** `upsertJobScheduler` re-asserts the schedule
   on every worker boot. A deploy that restarts workers does not cause
   drift or miss jobs; re-registering with the same id is a no-op.
3. **Failure visibility.** BullMQ's retry / failure semantics apply to
   repeatables the same as one-off jobs. A failed nightly backup surfaces
   in the same queue UI as a failed user-triggered job.
4. **The `cron` service stays as insurance.** Two cases might need it later:
   - A job that runs hours-long and must not share a process with
     interactive jobs (e.g. a full-tenant reindex).
   - A job that must tolerate the worker being scaled to zero.
   Neither applies in Phase 0.

## Consequences

- The worker image must include `pg_dump` (nixpacks `postgresql` package).
  Documented in `docs/deployment.md` in PR 12.
- A single worker process is the only writer for scheduler state. If we
  scale workers horizontally later, BullMQ's scheduler uses Redis locks, so
  duplicate registration is safe — but duplicate *execution* of repeatables
  is handled by BullMQ itself (one fires per interval regardless of worker
  count).
- The cron Railway service remains defined with no code in Phase 0. When
  the first genuine use case arrives, add a new entrypoint under
  `packages/jobs/src/cron-main.ts` rather than reusing the worker's main.
