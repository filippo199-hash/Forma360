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
import { holdRenderedBytes } from './render-fallback';

const renderLog = logger.child({ component: 'render-dashboard-pdf' });

export const dashboardsDeps: Pick<DashboardsRouterDeps, 'renderPdf'> = {
  renderPdf: (input) =>
    renderDashboardPdf(
      {
        db,
        storage,
        appUrl: env.APP_URL,
        renderSharedSecret: env.RENDER_SHARED_SECRET,
        // A failed R2 cache-write must NOT destroy a finished document
        // (CLAUDE.md export-delivery contract). Without this the renderer
        // rethrows, the route 500s, and "Download PDF" returns raw
        // {"error":"INTERNAL_SERVER_ERROR"} — the exact failure the other
        // export routes were hardened against. Park the bytes; the route's
        // deliverRenderedFile serves them inline.
        onUploadFailure: holdRenderedBytes,
        // Surface why a render fell back to the stub, or why the upload
        // failed — without this the reason is dropped.
        onLog: (e) => {
          if (e.level === 'warn') renderLog.warn(e.msg);
          else renderLog.info(e.msg);
        },
      },
      input,
    ),
};
