/**
 * Session-gated Word download. Same shape as /api/exports/pdf —
 * kicks the docx renderer, returns a 302 to a short-lived R2 URL.
 */
import { buildAppRouter } from '@forma360/api';
import { NextResponse } from 'next/server';
import { exportsDeps } from '../../../../src/server/exports-deps';
import { inspectionsExportDeps } from '../../../../src/server/inspections-export-deps';
import { storage } from '../../../../src/server/storage';
import { createContext } from '../../../../src/server/trpc';

const appRouter = buildAppRouter({
  exports: exportsDeps,
  inspectionsExport: inspectionsExportDeps,
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

  const signedUrl = await storage.getSignedDownloadUrl({
    key: rendered.key,
    expiresInSeconds: 60 * 5,
  });
  return NextResponse.redirect(signedUrl, 302);
}
