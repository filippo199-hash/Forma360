/**
 * Session-gated PDF download. Kicks (or re-uses) a cached PDF render
 * and returns a short-lived signed R2 GET URL. The browser follows
 * the 302 to R2 and actually downloads the file there.
 *
 * Why not stream through Next: streaming a multi-megabyte PDF
 * through Next.js uses Node's outbound bandwidth for the whole
 * transfer. R2 already knows how to hand out a bytes-efficient
 * download directly; the signed-URL redirect lets us keep the access
 * check on our side without proxying bytes.
 */
import { buildAppRouter } from '@forma360/api';
import { NextResponse } from 'next/server';
import { exportsDeps } from '../../../../src/server/exports-deps';
import { storage } from '../../../../src/server/storage';
import { createContext } from '../../../../src/server/trpc';

const appRouter = buildAppRouter({ exports: exportsDeps });

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
  let rendered: Awaited<ReturnType<typeof caller.exports.renderPdf>>;
  try {
    rendered = await caller.exports.renderPdf({ inspectionId });
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
