/**
 * Real wiring for the issues tRPC router. Provides the templated-email
 * dispatcher (issue-created notifications), the request logger and
 * APP_URL.
 */
import type { IssuesRouterDeps } from '@forma360/api';
import { QUEUE_NAMES, getQueue } from '@forma360/jobs/queues';
import { getBrand } from '@forma360/shared/brand';
import { createSendTemplatedEmail } from '@forma360/shared/email';
import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';
import { storage } from './storage';

const sendTemplatedEmail = createSendTemplatedEmail({
  delivery: env.EMAIL_DELIVERY,
  productName: getBrand(env.BRAND).name,
  ...(env.EMAIL_DELIVERY === 'resend'
    ? { resendApiKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
    : {}),
  logger: logger.child({ component: 'email-templated' }),
});

// Lazy Redis + BullMQ queue for observation notifications. The connection is
// created on first use so the web process starts cleanly even if Redis is
// temporarily unavailable at boot time.
let _obsNotifyQueue: ReturnType<typeof getQueue> | null = null;
function getObsNotifyQueue() {
  if (_obsNotifyQueue === null) {
    const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    _obsNotifyQueue = getQueue(QUEUE_NAMES.OBSERVATION_NOTIFY, connection);
  }
  return _obsNotifyQueue;
}

async function enqueueObservationNotify(payload: {
  tenantId: string;
  issueId: string;
  isCritical: boolean;
}): Promise<void> {
  await getObsNotifyQueue().add(QUEUE_NAMES.OBSERVATION_NOTIFY, payload);
}

export const issuesDeps: IssuesRouterDeps = {
  sendEmail: sendTemplatedEmail,
  logger: logger.child({ component: 'issues-router' }),
  appUrl: env.APP_URL,
  storage,
  enqueueObservationNotify,
};
