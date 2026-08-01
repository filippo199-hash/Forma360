/**
 * Real wiring for the riskAssessments router (FreeHS module B1).
 * Brand-gates the module (ADR 0010) and provides the PDF renderer the
 * "Share via Heads Up" flow uses to attach the assessment record.
 */
import type { RiskAssessmentsRouterDeps } from '@forma360/api';
import { renderRiskAssessmentPdf } from '@forma360/render';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../lib/brand';
import { db } from './db';
import { env } from './env';
import { logger } from './logger';
import { storage } from './storage';

const renderLog = logger.child({ component: 'render-ra-pdf' });

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
};
