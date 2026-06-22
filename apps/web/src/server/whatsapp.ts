/**
 * WhatsApp Cloud API client + inbound webhook signature verification.
 *
 * Sends are made against the Graph API messages endpoint for our configured
 * phone-number ID. Inbound webhook payloads are authenticated by verifying the
 * `X-Hub-Signature-256` HMAC against the Meta App secret, so we only ever act
 * on requests genuinely from Meta.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from './env';
import { logger } from './logger';

const log = logger.child({ module: 'whatsapp' });

const GRAPH_API_VERSION = 'v25.0';

/** A WhatsApp text message body is capped at 4096 chars; stay safely under it. */
const MAX_CHUNK = 3800;

/**
 * Cap on inbound media we'll download + base64 for Claude vision. Claude's
 * per-image limit is ~5MB; WhatsApp photos are well under this. Larger files
 * are skipped (the caller falls back to a "couldn't read that" reply).
 */
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

const mediaMetaSchema = z.object({
  url: z.string().url(),
  mime_type: z.string().optional(),
  file_size: z.number().optional(),
});

/**
 * Download an inbound WhatsApp media object (image, etc.) by its media id.
 * Two hops, both bearer-authenticated: GET the media node for a short-lived
 * URL, then GET the bytes. Returns base64 + mime type, or null on any failure
 * or when the file exceeds {@link MAX_MEDIA_BYTES}.
 */
export async function fetchWhatsAppMedia(
  mediaId: string,
): Promise<{ base64: string; mimeType: string } | null> {
  const token = env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return null;

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!metaRes.ok) {
      log.warn({ mediaId, status: metaRes.status }, 'media metadata fetch failed');
      return null;
    }
    const meta = mediaMetaSchema.safeParse(await metaRes.json().catch(() => ({})));
    if (!meta.success) {
      log.warn({ mediaId }, 'media metadata shape unexpected');
      return null;
    }
    if (meta.data.file_size !== undefined && meta.data.file_size > MAX_MEDIA_BYTES) {
      log.info({ mediaId, fileSize: meta.data.file_size }, 'media too large; skipping');
      return null;
    }

    const binRes = await fetch(meta.data.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!binRes.ok) {
      log.warn({ mediaId, status: binRes.status }, 'media bytes fetch failed');
      return null;
    }
    const buf = Buffer.from(await binRes.arrayBuffer());
    if (buf.byteLength > MAX_MEDIA_BYTES) {
      log.info({ mediaId, bytes: buf.byteLength }, 'media exceeded cap after download; skipping');
      return null;
    }
    const mimeType =
      meta.data.mime_type?.split(';')[0]?.trim() ??
      binRes.headers.get('content-type')?.split(';')[0]?.trim() ??
      'application/octet-stream';
    return { base64: buf.toString('base64'), mimeType };
  } catch (err) {
    log.error(
      { mediaId, err: err instanceof Error ? err.message : String(err) },
      'media download threw',
    );
    return null;
  }
}

/**
 * True when every WhatsApp env var is set. When false the webhook route is
 * effectively disabled (returns 503) and nothing is sent.
 */
export function isWhatsAppConfigured(): boolean {
  return (
    !!env.WHATSAPP_VERIFY_TOKEN &&
    !!env.WHATSAPP_ACCESS_TOKEN &&
    !!env.WHATSAPP_PHONE_NUMBER_ID &&
    !!env.WHATSAPP_APP_SECRET
  );
}

/**
 * Verify the `X-Hub-Signature-256` header against the raw request body using
 * the app secret. Returns false on any mismatch, missing header, or missing
 * secret. Uses a timing-safe comparison.
 */
export function verifyWhatsAppSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = env.WHATSAPP_APP_SECRET;
  if (!secret || !signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const provided = signatureHeader.slice('sha256='.length);

  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

const sendResponseSchema = z.union([
  z.object({
    messages: z.array(z.object({ id: z.string() })).optional(),
    messaging_product: z.string().optional(),
  }),
  z.object({
    error: z.object({
      message: z.string(),
      type: z.string().optional(),
      code: z.number().optional(),
    }),
  }),
]);

/** Split a long body on paragraph/word boundaries into <=MAX_CHUNK pieces. */
function chunk(body: string): string[] {
  if (body.length <= MAX_CHUNK) return [body];
  const parts: string[] = [];
  let remaining = body;
  while (remaining.length > MAX_CHUNK) {
    let cut = remaining.lastIndexOf('\n', MAX_CHUNK);
    if (cut < MAX_CHUNK * 0.5) cut = remaining.lastIndexOf(' ', MAX_CHUNK);
    if (cut < MAX_CHUNK * 0.5) cut = MAX_CHUNK;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}

/**
 * Send a plain-text WhatsApp message to a recipient (E.164 without the leading
 * `+`, as Meta delivers it). Long bodies are split into multiple messages.
 * Throws if WhatsApp is not configured or the API rejects the send.
 */
export async function sendWhatsAppText(to: string, body: string): Promise<void> {
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error('WhatsApp is not configured');
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  for (const part of chunk(body)) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: part },
      }),
    });

    const json: unknown = await res.json().catch(() => ({}));
    const parsed = sendResponseSchema.safeParse(json);

    if (!res.ok || (parsed.success && 'error' in parsed.data)) {
      const message =
        parsed.success && 'error' in parsed.data ? parsed.data.error.message : `HTTP ${res.status}`;
      log.error({ to, status: res.status, message }, 'WhatsApp send failed');
      throw new Error(`WhatsApp send failed: ${message}`);
    }
  }

  log.info({ to }, 'WhatsApp message sent');
}
