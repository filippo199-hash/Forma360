/**
 * Real wiring for the riskAssessments router (FreeHS module B1).
 * Brand-gates the module (ADR 0010) and provides the PDF renderer the
 * "Share via Heads Up" flow uses to attach the assessment record.
 */
import type { RiskAssessmentsRouterDeps } from '@forma360/api';
import { renderRiskAssessmentPdf } from '@forma360/render';
import { brandHasModule, getBrand } from '@forma360/shared/brand';
import { createSendTemplatedEmail } from '@forma360/shared/email';
import { activeBrand } from '../lib/brand';
import { db } from './db';
import { env } from './env';
import { logger } from './logger';
import { storage } from './storage';

const renderLog = logger.child({ component: 'render-ra-pdf' });

const sendTemplatedEmail = createSendTemplatedEmail({
  delivery: env.EMAIL_DELIVERY,
  productName: getBrand(env.BRAND).name,
  ...(env.EMAIL_DELIVERY === 'resend'
    ? { resendApiKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
    : {}),
  logger: logger.child({ component: 'email-templated' }),
});

export const riskAssessmentsDeps: RiskAssessmentsRouterDeps = {
  enabled: brandHasModule(activeBrand.id, 'riskAssessments'),
  renderPdf: (input) =>
    renderRiskAssessmentPdf(
      {
        db,
        storage,
        appUrl: env.APP_URL,
        renderSharedSecret: env.RENDER_SHARED_SECRET,
        onLog: (e) => {
          if (e.level === 'warn') renderLog.warn(e.msg);
          else renderLog.info(e.msg);
        },
      },
      input,
    ),
  sendEmail: sendTemplatedEmail,
  appUrl: env.APP_URL,
};
