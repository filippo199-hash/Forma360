/**
 * Real wiring for the dashboards router's PDF renderer (ADR 0018).
 * Binds `renderDashboardPdf` to the shared R2 storage, the app URL and
 * the render-route HMAC secret — mirroring `exports-deps.ts` /
 * `fire-safety-deps.ts`. Module flags are NOT wired here; they follow
 * the brand deps in `buildAppRouter` like every other module.
 */
import type { DashboardsRouterDeps } from '@forma360/api';
import { renderDashboardPdf } from '@forma360/render';
import { env } from './env';
import { db } from './db';
import { storage } from './storage';
import { logger } from './logger';

const renderLog = logger.child({ component: 'render-dashboard-pdf' });

export const dashboardsDeps: Pick<DashboardsRouterDeps, 'renderPdf'> = {
  renderPdf: (input) =>
    renderDashboardPdf(
      {
        db,
        storage,
        appUrl: env.APP_URL,
        renderSharedSecret: env.RENDER_SHARED_SECRET,
        // Surface why a render fell back to the stub ("Render engine not
        // configured") — without this the failure reason is dropped.
        onLog: (e) => {
          if (e.level === 'warn') renderLog.warn(e.msg);
          else renderLog.info(e.msg);
        },
      },
      input,
    ),
};
