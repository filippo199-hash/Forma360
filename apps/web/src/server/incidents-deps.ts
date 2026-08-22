/**
 * Real wiring for the incidents router (FreeHS module B5). Brand-gates
 * the module per ADR 0010, provides the incident-report PDF renderer,
 * the templated-email dispatcher for in-request notifications
 * (investigator appointed, finding-action assigned) and the BullMQ
 * enqueue for the immediate-alert fan-out.
 */
import type { IncidentsRouterDeps } from '@forma360/api';
import { QUEUE_NAMES, getQueue } from '@forma360/jobs/queues';
import { renderIncidentPdf } from '@forma360/render';
import { brandHasModule, getBrand } from '@forma360/shared/brand';
import { createSendTemplatedEmail } from '@forma360/shared/email';
import { activeBrand } from '../lib/brand';
import { db } from './db';
import { env } from './env';
import { createRedis } from './redis';
import { logger } from './logger';
import { holdRenderedBytes } from './render-fallback';
import { storage } from './storage';

const renderLog = logger.child({ component: 'render-incident-pdf' });

const sendTemplatedEmail = createSendTemplatedEmail({
  delivery: env.EMAIL_DELIVERY,
  productName: getBrand(env.BRAND).name,
  ...(env.EMAIL_DELIVERY === 'resend'
    ? { resendApiKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
    : {}),
  logger: logger.child({ component: 'email-templated' }),
});

// Lazy Redis + BullMQ queue for the immediate alert. The connection is
// created on first use so the web process starts cleanly even if Redis
// is temporarily unavailable at boot time.
let _alertQueue: ReturnType<typeof getQueue> | null = null;
function getAlertQueue() {
  if (_alertQueue === null) {
    const connection = createRedis('incident-alert', { maxRetriesPerRequest: null });
    _alertQueue = getQueue(QUEUE_NAMES.INCIDENT_ALERT, connection);
  }
  return _alertQueue;
}

export const incidentsDeps: IncidentsRouterDeps = {
  enabled: brandHasModule(activeBrand.id, 'incidents'),
  appUrl: env.APP_URL,
  renderPdf: (input) =>
    renderIncidentPdf(
      {
        db,
        storage,
        appUrl: env.APP_URL,
        renderSharedSecret: env.RENDER_SHARED_SECRET,
        onUploadFailure: holdRenderedBytes,
        onLog: (e) => {
          if (e.level === 'warn') renderLog.warn(e.msg);
          else renderLog.info(e.msg);
        },
      },
      input,
    ),
  sendEmail: sendTemplatedEmail,
  enqueueIncidentAlert: async (payload) => {
    // IN-A1: the alert worker throws on total delivery failure so the
    // fan-out is never silently lost — give BullMQ real retries.
    // 5 attempts × exponential backoff from 60s ≈ 31 minutes of cover
    // for a mail-provider outage.
    await getAlertQueue().add(QUEUE_NAMES.INCIDENT_ALERT, payload, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
    });
  },
};
