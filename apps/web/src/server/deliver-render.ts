/**
 * The last step every export route shares: get the rendered document to
 * the browser.
 *
 * Normally that means a 302 to a short-lived signed URL, so the bytes
 * travel from the object store to the browser without passing through
 * us. When the store is unreachable, the renderer will have parked the
 * bytes in {@link takeRenderedBytes} instead of throwing, and we serve
 * them straight off the response — the document still arrives, only the
 * cache was lost.
 *
 * Without this the failure mode was: 500, and — because these are
 * ordinary link navigations — a new browser tab containing the raw text
 * `{"error":"INTERNAL_SERVER_ERROR"}` on a white page. That is what a
 * buyer saw when they clicked "Download PDF".
 */
import { NextResponse } from 'next/server';
import { takeRenderedBytes } from './render-fallback';
import { storage } from './storage';

export async function deliverRenderedFile(input: {
  key: string;
  contentType: string;
  /** Used for the `Content-Disposition` filename on the inline path. */
  filename: string;
}): Promise<Response> {
  const held = takeRenderedBytes(input.key);
  if (held !== null) {
    // `Uint8Array` is a valid BodyInit at runtime; Next's lib types
    // insist on a stream, hence the cast at this one proven boundary.
    return new NextResponse(held as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': input.contentType,
        'Content-Length': String(held.length),
        'Content-Disposition': `attachment; filename="${sanitiseFilename(input.filename)}"`,
        // The bytes are single-use and the store is degraded; never let
        // an intermediary keep a copy of this response.
        'Cache-Control': 'no-store',
      },
    });
  }

  const signedUrl = await storage.getSignedDownloadUrl({
    key: input.key,
    expiresInSeconds: 60 * 5,
  });
  return NextResponse.redirect(signedUrl, 302);
}

/** Strip anything that would break out of the quoted header value. */
function sanitiseFilename(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._ -]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'download';
}
