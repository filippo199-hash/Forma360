/**
 * Turn a failed object-store PUT into an error that names the cause.
 *
 * R2 answers a rejected pre-signed upload with an HTTP status *and* an
 * XML body carrying the real reason:
 *
 *   <Error><Code>AccessDenied</Code><Message>…</Message></Error>
 *
 * The upload helpers used to throw `R2 upload failed: 403 Forbidden` and
 * drop the body, which is why a production 403 sat unexplained: every
 * distinct cause — wrong key, wrong secret, read-only token, token scoped
 * to another bucket, wrong account in the endpoint — presents as the same
 * three characters. `SignatureDoesNotMatch` and `AccessDenied` want
 * opposite fixes, so the code is the whole diagnosis.
 *
 * The body is read defensively: a failed upload must still surface *some*
 * error, so a body that is missing, unreadable, non-XML or absurdly large
 * degrades to the status line rather than throwing over the original
 * failure.
 */

/** Cap on the error body we read. R2's is a few hundred bytes. */
const MAX_ERROR_BODY = 4096;

export interface ObjectStoreErrorDetail {
  status: number;
  statusText: string;
  /** R2/S3 error code, e.g. `AccessDenied`. Null when unparseable. */
  code: string | null;
  /** R2/S3 human message. Null when unparseable. */
  detail: string | null;
}

function firstTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return match?.[1]?.trim() || null;
}

/**
 * Read the response body and pull out the S3 error code/message.
 * Never throws — see the module note.
 */
export async function describeObjectStoreError(res: {
  status: number;
  statusText: string;
  text: () => Promise<string>;
}): Promise<ObjectStoreErrorDetail> {
  let body = '';
  try {
    body = (await res.text()).slice(0, MAX_ERROR_BODY);
  } catch {
    // Body already consumed or the connection died — status only.
  }
  return {
    status: res.status,
    statusText: res.statusText,
    code: firstTag(body, 'Code'),
    detail: firstTag(body, 'Message'),
  };
}

/** One-line summary for logs and for the render-fallback error field. */
export function formatObjectStoreError(d: ObjectStoreErrorDetail): string {
  const head = `R2 upload failed: ${d.status} ${d.statusText}`;
  if (d.code === null && d.detail === null) return head;
  const tail = [d.code, d.detail].filter((v): v is string => v !== null).join(': ');
  return `${head} (${tail})`;
}

/** Read the body and build the throwable in one step. */
export async function objectStoreUploadError(res: {
  status: number;
  statusText: string;
  text: () => Promise<string>;
}): Promise<Error> {
  return new Error(formatObjectStoreError(await describeObjectStoreError(res)));
}
