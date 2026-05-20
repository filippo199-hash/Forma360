/**
 * Production compliance router dependencies.
 *
 * Wires the enqueueEvaluate function to the real BullMQ queue via ioredis.
 * The Redis connection is the same singleton used by other server-side dep
 * files in this directory.
 */
import type { ComplianceRouterDeps } from '@forma360/api';
import { QUEUE_NAMES } from '@forma360/jobs/queues';
import { redis } from './redis';

export const complianceDeps: ComplianceRouterDeps = {
  enqueueEvaluate: async (tenantId: string, ruleId: string): Promise<void> => {
    const { getQueue } = await import('@forma360/jobs/queues');
    const queue = getQueue(QUEUE_NAMES.COMPLIANCE_EVALUATE, redis);
    await queue.add(QUEUE_NAMES.COMPLIANCE_EVALUATE, { tenantId, ruleId });
  },
};
