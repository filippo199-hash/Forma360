/**
 * Session-gated risk-assessment PDF download (feedback M-4 — a proper
 * multi-page rendered PDF straight from the screen, not the squeezed
 * print stylesheet). Renders (or re-uses) the PDF in R2 and 302s to a
 * short-lived signed URL, mirroring /api/exports/pdf.
 */
import { buildAppRouter } from '@forma360/api';
import { NextResponse } from 'next/server';
import { authDeps } from '../../../../src/server/auth-deps';
import { coshhDeps } from '../../../../src/server/coshh-deps';
import { permitsDeps } from '../../../../src/server/permits-deps';
import { exportsDeps } from '../../../../src/server/exports-deps';
import { headsUpsDeps } from '../../../../src/server/heads-up-deps';
import { inspectionsDeps } from '../../../../src/server/inspections-deps';
import { inspectionsExportDeps } from '../../../../src/server/inspections-export-deps';
import { issuesDeps } from '../../../../src/server/issues-deps';
import { riskAssessmentsDeps } from '../../../../src/server/risk-assessments-deps';
import { storage } from '../../../../src/server/storage';
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
});

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const assessmentId = url.searchParams.get('assessmentId') ?? '';
  if (assessmentId.length !== 26) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const ctx = await createContext({ headers: req.headers });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const caller = appRouter.createCaller(ctx);
  let rendered: Awaited<ReturnType<typeof caller.riskAssessments.renderPdf>>;
  try {
    rendered = await caller.riskAssessments.renderPdf({ assessmentId });
  } catch (err) {
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'INTERNAL';
    const status = code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: code }, { status });
  }

  const signedUrl = await storage.getSignedDownloadUrl({
    key: rendered.storageKey,
    expiresInSeconds: 60 * 5,
  });
  return NextResponse.redirect(signedUrl, 302);
}
