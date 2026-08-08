/**
 * Session-gated incident-report PDF download (FreeHS module B5) — the
 * single-document record for insurers and auditors. Renders (or
 * re-uses) the PDF in R2 and 302s to a short-lived signed URL,
 * mirroring /api/exports/permit-pdf. Confidentiality is enforced by
 * `incidents.renderPdf` inside the caller.
 */
import { buildAppRouter } from '@forma360/api';
import { NextResponse } from 'next/server';
import { authDeps } from '../../../../src/server/auth-deps';
import { coshhDeps } from '../../../../src/server/coshh-deps';
import { exportsDeps } from '../../../../src/server/exports-deps';
import { headsUpsDeps } from '../../../../src/server/heads-up-deps';
import { incidentsDeps } from '../../../../src/server/incidents-deps';
import { inspectionsDeps } from '../../../../src/server/inspections-deps';
import { inspectionsExportDeps } from '../../../../src/server/inspections-export-deps';
import { issuesDeps } from '../../../../src/server/issues-deps';
import { permitsDeps } from '../../../../src/server/permits-deps';
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
  incidents: incidentsDeps,
});

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const incidentId = url.searchParams.get('incidentId') ?? '';
  if (incidentId.length !== 26) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const ctx = await createContext({ headers: req.headers });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const caller = appRouter.createCaller(ctx);
  let rendered: Awaited<ReturnType<typeof caller.incidents.renderPdf>>;
  try {
    rendered = await caller.incidents.renderPdf({ incidentId });
  } catch (err) {
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'INTERNAL';
    const status = code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: code }, { status });
  }

  // Serves the bytes directly when the object-store upload failed;
  // 302s to a signed URL otherwise. See `deliver-render`.
  return deliverRenderedFile({
    key: rendered.storageKey,
    contentType: 'application/pdf',
    filename: 'incident.pdf',
  });
}
