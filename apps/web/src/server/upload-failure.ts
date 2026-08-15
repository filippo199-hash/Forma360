/**
 * One place where a failed object-store upload becomes a log line and a
 * response.
 *
 * Twelve upload routes each hand-rolled `logger.error({ key, status }, '…R2
 * PUT failed')` and dropped R2's XML body — the body that names the cause.
 * So when every upload in the product started failing, production said
 * `status: 403` and nothing else, and the diagnosis had to come from the
 * renderers, which are the only writers that had been taught to read the
 * body (`objectStoreUploadError`). The photo upload a user actually
 * complained about was the least informative log in the system.
 *
 * The response stays `STORAGE_FAILED`: R2's code names our misconfiguration,
 * not anything the uploader can act on, so it belongs in the log and not in
 * a toast.
 */
import { describeObjectStoreError } from '@forma360/shared/object-store-error';
import { NextResponse } from 'next/server';

interface UploadLogger {
  error: (obj: Record<string, unknown>, msg: string) => void;
}

/**
 * Log a rejected upload with R2's own error code, then build the 500.
 * `route` is the tag the route already used (`asset-photo`, `site-plan`, …)
 * so existing log searches keep working.
 */
export async function storageFailed(
  logger: UploadLogger,
  route: string,
  key: string,
  res: Response,
): Promise<NextResponse> {
  const detail = await describeObjectStoreError(res);
  logger.error(
    { key, status: detail.status, code: detail.code, detail: detail.detail },
    `[${route}] R2 PUT failed`,
  );
  return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
}
