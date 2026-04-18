/**
 * Handler for `forma360:user-anonymisation` (Phase 1 § 1.1 — S-E09).
 *
 * Phase 1 performs the *primary* anonymisation inline inside the
 * `users.anonymise` tRPC mutation (overwrites `user` + deletes
 * `user_custom_field_values`). This async handler exists so later
 * phases can attach cascade work (removing the user's PII from
 * inspection signatures, action comments, issue attachments, ...)
 * without blocking the admin's initial mutation.
 *
 * Phase 1's implementation logs the trigger and exits. When Phase N
 * modules register anonymisers via the `registerAnonymiser(...)` hook
 * added in their own router, this handler will iterate them in parallel
 * and produce a single audit entry per user.
 */
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import type { UserAnonymisationPayload } from '../queues';

export interface UserAnonymisationDeps {
  logger: Logger;
}

export function createUserAnonymisationHandler(deps: UserAnonymisationDeps) {
  return async function handleUserAnonymisation(job: Job<UserAnonymisationPayload>): Promise<void> {
    const { tenantId, userId, actorId } = job.data;
    deps.logger.info(
      {
        job_id: job.id,
        queue: job.queueName,
        tenantId,
        userId,
        actorId,
      },
      '[user-anonymisation] trigger received; Phase 1 processes inline, cascade is a Phase 2+ hook',
    );
  };
}
