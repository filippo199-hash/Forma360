/**
 * Session-gated RAMS pack PDF download (FreeHS module B6) — the single
 * combined artefact issued to the client and briefed to the crew.
 * Renders (or re-uses) the PDF in R2 and 302s to a short-lived signed
 * URL, mirroring /api/exports/incident-pdf.
 *
 * Keyed on the pack, optionally pinned to a version: omitting
 * `packVersionId` renders the current issued version, passing one
 * reproduces an older issue exactly as it went out (RS-E07).
 */
import { buildAppRouter } from '@forma360/api';
import { NextResponse } from 'next/server';
import { authDeps } from '../../../../src/server/auth-deps';
import { coshhDeps } from '../../../../src/server/coshh-deps';
import { exportsDeps } from '../../../../src/server/exports-deps';
import { headsUpsDeps } from '../../../../src/server/heads-up-deps';
import { incidentsDeps } from '../../../../src/server/incidents-deps';
import { ramsDeps } from '../../../../src/server/rams-deps';
import { inspectionsDeps } from '../../../../src/server/inspections-deps';
import { inspectionsExportDeps } from '../../../../src/server/inspections-export-deps';
import { issuesDeps } from '../../../../src/server/issues-deps';
import { permitsDeps } from '../../../../src/server/permits-deps';
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
  incidents: incidentsDeps,
  rams: ramsDeps,
});

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const packId = url.searchParams.get('packId') ?? '';
  const packVersionId = url.searchParams.get('packVersionId');
  if (packId.length !== 26) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (packVersionId !== null && packVersionId.length !== 26) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const ctx = await createContext({ headers: req.headers });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const caller = appRouter.createCaller(ctx);
  let rendered: Awaited<ReturnType<typeof caller.rams.packs.renderPdf>>;
  try {
    rendered = await caller.rams.packs.renderPdf({
      packId,
      ...(packVersionId !== null ? { packVersionId } : {}),
    });
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
          : code === 'BAD_REQUEST' || code === 'PRECONDITION_FAILED'
            ? 400
            : 500;
    return NextResponse.json({ error: code }, { status });
  }

  const signedUrl = await storage.getSignedDownloadUrl({
    key: rendered.storageKey,
    expiresInSeconds: 60 * 5,
  });
  return NextResponse.redirect(signedUrl, 302);
}
