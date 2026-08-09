/**
 * Session-gated dashboard PDF download (ADR 0018). Renders (or
 * refreshes) the PDF in R2 via `dashboards.renderPdf` — which enforces
 * the customDashboards entitlement, analytics.view and the visibility
 * matrix — and 302s to a short-lived signed URL, mirroring
 * /api/exports/fra-pdf.
 */
import { buildAppRouter } from '@forma360/api';
import { NextResponse } from 'next/server';
import { authDeps } from '../../../../src/server/auth-deps';
import { coshhDeps } from '../../../../src/server/coshh-deps';
import { dashboardsDeps } from '../../../../src/server/dashboards-deps';
import { fireSafetyDeps } from '../../../../src/server/fire-safety-deps';
import { permitsDeps } from '../../../../src/server/permits-deps';
import { exportsDeps } from '../../../../src/server/exports-deps';
import { headsUpsDeps } from '../../../../src/server/heads-up-deps';
import { inspectionsDeps } from '../../../../src/server/inspections-deps';
import { inspectionsExportDeps } from '../../../../src/server/inspections-export-deps';
import { issuesDeps } from '../../../../src/server/issues-deps';
import { riskAssessmentsDeps } from '../../../../src/server/risk-assessments-deps';
import { deliverRenderedFile } from '../../../../src/server/deliver-render';
import { createContext } from '../../../../src/server/trpc';

const appRouter = buildAppRouter({
  exports: exportsDeps,
  inspectionsExport: inspectionsExportDeps,
  auth: authDeps,
  inspections: inspectionsDeps,
  issues: issuesDeps,
  headsUps: headsUpsDeps,
  riskAssessments: riskAssessmentsDeps,
  coshh: coshhDeps,
  permits: permitsDeps,
  fireSafety: fireSafetyDeps,
  dashboards: dashboardsDeps,
});

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const dashboardId = url.searchParams.get('dashboardId') ?? '';
  if (dashboardId.length !== 26) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const ctx = await createContext({ headers: req.headers });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const caller = appRouter.createCaller(ctx);
  let rendered: Awaited<ReturnType<typeof caller.dashboards.renderPdf>>;
  try {
    rendered = await caller.dashboards.renderPdf({ id: dashboardId });
  } catch (err) {
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'INTERNAL';
    const status =
      code === 'NOT_FOUND'
        ? 404
        : code === 'FORBIDDEN'
          ? 403
          : code === 'PAYMENT_REQUIRED'
            ? 402
            : 500;
    return NextResponse.json({ error: code }, { status });
  }

  // Ends in deliverRenderedFile like every export route: a 302 to a
  // signed URL normally, or the parked bytes inline when the R2 write
  // failed (onUploadFailure) — never a 500 for a document that rendered.
  return deliverRenderedFile({
    key: rendered.storageKey,
    contentType: 'application/pdf',
    filename: rendered.filename,
  });
}
