/**
 * Session-gated Word download. Same shape as /api/exports/pdf —
 * kicks the docx renderer, returns a 302 to a short-lived R2 URL.
 */
import { buildAppRouter } from '@forma360/api';
import { NextResponse } from 'next/server';
import { authDeps } from '../../../../src/server/auth-deps';
import { exportsDeps } from '../../../../src/server/exports-deps';
import { headsUpsDeps } from '../../../../src/server/heads-up-deps';
import { inspectionsDeps } from '../../../../src/server/inspections-deps';
import { inspectionsExportDeps } from '../../../../src/server/inspections-export-deps';
import { issuesDeps } from '../../../../src/server/issues-deps';
import { deliverRenderedFile } from '../../../../src/server/deliver-render';
import { createContext } from '../../../../src/server/trpc';

const appRouter = buildAppRouter({
  exports: exportsDeps,
  inspectionsExport: inspectionsExportDeps,
  auth: authDeps,
  inspections: inspectionsDeps,
  issues: issuesDeps,
  headsUps: headsUpsDeps,
});

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const inspectionId = url.searchParams.get('inspectionId') ?? '';
  if (inspectionId.length !== 26) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const ctx = await createContext({ headers: req.headers });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const caller = appRouter.createCaller(ctx);
  let rendered: Awaited<ReturnType<typeof caller.exports.renderDocx>>;
  try {
    rendered = await caller.exports.renderDocx({ inspectionId });
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
    key: rendered.key,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    filename: 'inspection.docx',
  });
}
