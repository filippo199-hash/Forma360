/**
 * WhatsApp Cloud API webhook.
 *
 *   GET  — Meta's verification handshake. Echoes `hub.challenge` when the
 *          `hub.verify_token` matches our configured token.
 *   POST — Inbound messages. We verify the `X-Hub-Signature-256` HMAC, map the
 *          sender's phone number to a Forma360 user, run the same AI agent the
 *          web chat uses (scoped to that user's tenant), and send the reply
 *          back over WhatsApp.
 *
 * The POST handler acks `200` immediately and does the (10–30s) agent work in a
 * detached task so Meta does not time out and retry. On a persistent Node
 * server (Railway `web` service) the detached promise keeps running after the
 * response is returned — the same pattern the SSE chat route relies on.
 */
import { and, desc, eq, gt, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { aiConversations, user, whatsappLinkCodes, whatsappOptOuts } from '@forma360/db/schema';
import { parseWhatsAppLinkCode } from '@forma360/shared/whatsapp-link';
import { activeBrand } from '../../../../src/lib/brand';
import { type AgentImage, SUPPORTED_IMAGE_MEDIA_TYPES } from '../../../../src/server/agent-tools';
import { runAiAgentTurn } from '../../../../src/server/ai-agent';
import { rateLimit } from '../../../../src/server/rate-limit';
import { db } from '../../../../src/server/db';
import { env } from '../../../../src/server/env';
import { logger } from '../../../../src/server/logger';
import { isTranscriptionConfigured, transcribeAudio } from '../../../../src/server/transcribe';
import { extractVideoFrames } from '../../../../src/server/video-frames';
import {
  fetchWhatsAppMedia,
  isWhatsAppConfigured,
  MAX_VIDEO_BYTES,
  sendWhatsAppText,
  verifyWhatsAppSignature,
} from '../../../../src/server/whatsapp';

const log = logger.child({ module: 'whatsapp-webhook' });

/** Continue the user's most recent conversation if touched within this window. */
const CONVERSATION_RECENCY_MS = 6 * 60 * 60 * 1000;

/** Message shown when an inbound number isn't linked to any user account. */
const UNLINKED_REPLY = `Hi! This WhatsApp number isn't linked to a ${activeBrand.name} account yet. Ask your administrator to add your phone number to your user profile, then try again.`;

const GENERIC_ERROR_REPLY =
  'Sorry — something went wrong handling your message. Please try again in a moment.';

// ─── Opt-out / opt-in (WhatsApp Business Messaging Policy) ────────────────────

/**
 * Keywords that opt a sender OUT of the assistant. WhatsApp expects us to
 * honour STOP-style requests. Matched on the first word of the message,
 * case-insensitively, with surrounding punctuation stripped.
 */
const OPT_OUT_KEYWORDS = new Set(['stop', 'unsubscribe', 'cancel', 'quit', 'end', 'stopp']);
/** Keywords that opt a previously-opted-out sender back IN. */
const OPT_IN_KEYWORDS = new Set(['start', 'unstop', 'resume', 'subscribe']);

const OPT_OUT_REPLY = `You've been unsubscribed from the ${activeBrand.name} WhatsApp assistant and won't receive further messages here. Reply START at any time to resume.`;
const OPT_IN_REPLY = `You're resubscribed to the ${activeBrand.name} WhatsApp assistant. How can I help?`;

/** Normalise to the first word, lowercased, letters only ("STOP." → "stop"). */
function firstKeyword(text: string): string {
  const firstWord = text.trim().split(/\s+/)[0] ?? '';
  return firstWord.toLowerCase().replace(/[^a-z]/g, '');
}

async function isOptedOut(phone: string): Promise<boolean> {
  const [row] = await db
    .select({ phone: whatsappOptOuts.phone })
    .from(whatsappOptOuts)
    .where(eq(whatsappOptOuts.phone, phone))
    .limit(1);
  return !!row;
}

async function setOptOut(phone: string): Promise<void> {
  await db.insert(whatsappOptOuts).values({ phone }).onConflictDoNothing();
}

async function clearOptOut(phone: string): Promise<void> {
  await db.delete(whatsappOptOuts).where(eq(whatsappOptOuts.phone, phone));
}

// ─── Non-text media (interim) ────────────────────────────────────────────────

/**
 * Friendly noun for each non-text WhatsApp message type, used in the interim
 * reply below. TEMPORARY: until the multimodal pipeline lands (download media
 * from the Graph API → Claude vision → confirm-and-create), inbound photos /
 * videos / voice notes can't be acted on, so we acknowledge them honestly
 * instead of dropping them silently. Replace this whole branch when media
 * understanding ships.
 */
const MEDIA_NOUNS: Record<string, string> = {
  image: 'photo',
  video: 'video',
  audio: 'voice note',
  document: 'file',
  sticker: 'sticker',
  location: 'location',
  contacts: 'contact',
};

function mediaInterimReply(type: string): string {
  const noun = MEDIA_NOUNS[type] ?? 'attachment';
  return `Thanks — I've received your ${noun}, but I can't act on attachments just yet. Please send your question or describe what you need as a text message for now. (Photo and video support is coming very soon.)`;
}

// ─── GET: verification handshake ─────────────────────────────────────────────

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === env.WHATSAPP_VERIFY_TOKEN && challenge) {
    log.info('Webhook GET verification succeeded');
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  log.warn(
    { mode, tokenMatches: token === env.WHATSAPP_VERIFY_TOKEN },
    'Webhook GET verification failed',
  );
  return new Response('Forbidden', { status: 403 });
}

// ─── POST: inbound messages ──────────────────────────────────────────────────

// Minimal slice of the WhatsApp webhook payload. We capture every inbound
// message (any `type`), not just text, so non-text messages get an honest
// reply instead of being dropped. `text.body` is present only for text.
const inboundMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: z
    .object({
      id: z.string(),
      mime_type: z.string().optional(),
      caption: z.string().optional(),
    })
    .optional(),
  audio: z
    .object({
      id: z.string(),
      mime_type: z.string().optional(),
      voice: z.boolean().optional(),
    })
    .optional(),
  video: z
    .object({
      id: z.string(),
      mime_type: z.string().optional(),
      caption: z.string().optional(),
    })
    .optional(),
});
type InboundMessage = z.infer<typeof inboundMessageSchema>;

const webhookSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z.object({
                messages: z.array(inboundMessageSchema).optional(),
              }),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

// In-memory guard against Meta re-delivering the same message id (bounded).
const processedMessageIds = new Set<string>();
function alreadyProcessed(id: string): boolean {
  if (processedMessageIds.has(id)) return true;
  processedMessageIds.add(id);
  if (processedMessageIds.size > 1000) {
    // Drop the oldest ~half to keep the set bounded.
    const it = processedMessageIds.values();
    for (let i = 0; i < 500; i++) {
      const next = it.next();
      if (next.done) break;
      processedMessageIds.delete(next.value);
    }
  }
  return false;
}

// ─── Account linking ─────────────────────────────────────────────────────────

const LINK_EXPIRED_REPLY = `That link has expired or has already been used. Open ${activeBrand.name} on the web, click "Get this on WhatsApp" at the bottom of the menu, and use the fresh link.`;

/** Sent when the number is already on someone else's account in the tenant. */
const LINK_TAKEN_REPLY = `This WhatsApp number is already linked to a different ${activeBrand.name} account. Ask your administrator to remove it there first.`;

function linkedReply(firstName: string | null): string {
  const greeting = firstName === null || firstName === '' ? 'Hi!' : `Hi ${firstName}!`;
  return (
    `${greeting} 👋 Your number is linked to your ${activeBrand.name} account — I'll use it to reach you here.\n\n` +
    `You can now ask me about your inspections, incidents, actions, permits, risk assessments and more, ` +
    `right from WhatsApp. Try "what's outstanding for me?"\n\n` +
    `Reply STOP at any time and I'll leave you alone.`
  );
}

/**
 * Trade a one-time code for a phone number on the sender's account.
 *
 * Returns true when the message was a linking attempt and has been answered —
 * including the failure cases, which still need a reply, otherwise the sender
 * is left staring at silence wondering whether it worked.
 *
 * The whole exchange is what opens WhatsApp's 24-hour window, which is why
 * the welcome below can be free-form text rather than an approved template.
 */
async function tryLinkAccount(fromDigits: string, body: string): Promise<boolean> {
  const code = parseWhatsAppLinkCode(body);
  if (code === null) return false;

  const now = new Date();
  const [row] = await db
    .select({
      code: whatsappLinkCodes.code,
      tenantId: whatsappLinkCodes.tenantId,
      userId: whatsappLinkCodes.userId,
    })
    .from(whatsappLinkCodes)
    .where(
      and(
        eq(whatsappLinkCodes.code, code),
        isNull(whatsappLinkCodes.usedAt),
        gt(whatsappLinkCodes.expiresAt, now),
      ),
    )
    .limit(1);

  if (row === undefined) {
    log.info({ fromDigits }, 'Link code not found, already used, or expired');
    await sendWhatsAppText(fromDigits, LINK_EXPIRED_REPLY);
    return true;
  }

  const withPlus = `+${fromDigits}`;
  // Refuse to move a number that already belongs to someone else in the same
  // tenant: two accounts sharing one number would make `findUserByPhone`
  // ambiguous, and it silently picks the older row.
  const [clash] = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.tenantId, row.tenantId),
        ne(user.id, row.userId),
        or(eq(user.phone, withPlus), eq(user.phone, fromDigits)),
      ),
    )
    .limit(1);
  if (clash !== undefined) {
    log.warn({ fromDigits, tenantId: row.tenantId }, 'Link refused: number already in use');
    await sendWhatsAppText(fromDigits, LINK_TAKEN_REPLY);
    return true;
  }

  // Burn the code first: if the update below fails we would rather leave a
  // spent code than a reusable one.
  await db
    .update(whatsappLinkCodes)
    .set({ usedAt: now })
    .where(eq(whatsappLinkCodes.code, row.code));

  const [linked] = await db
    .update(user)
    .set({ phone: withPlus, updatedAt: now })
    .where(and(eq(user.tenantId, row.tenantId), eq(user.id, row.userId)))
    .returning({ firstName: user.firstName, name: user.name });

  log.info({ tenantId: row.tenantId, userId: row.userId }, 'WhatsApp number linked to account');
  // A previous STOP would otherwise silence the account they just linked.
  await clearOptOut(fromDigits);
  await sendWhatsAppText(fromDigits, linkedReply(linked?.firstName ?? null));
  return true;
}

/** Find an active Forma360 user whose stored phone matches the WhatsApp sender. */
async function findUserByPhone(
  fromDigits: string,
): Promise<{ userId: string; tenantId: string } | null> {
  const withPlus = `+${fromDigits}`;
  const rows = await db
    .select({ userId: user.id, tenantId: user.tenantId })
    .from(user)
    .where(
      and(or(eq(user.phone, withPlus), eq(user.phone, fromDigits)), isNull(user.deactivatedAt)),
    )
    .orderBy(user.createdAt)
    .limit(2);

  if (rows.length === 0) return null;
  if (rows.length > 1) {
    log.warn({ fromDigits }, 'Multiple active users share this phone; using the earliest');
  }
  return rows[0] ?? null;
}

/** Reuse the user's most recent conversation if recent, else start a new one. */
async function resolveConversationId(tenantId: string, userId: string): Promise<string | null> {
  const cutoff = new Date(Date.now() - CONVERSATION_RECENCY_MS);
  const [recent] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.tenantId, tenantId),
        eq(aiConversations.userId, userId),
        gt(aiConversations.updatedAt, cutoff),
      ),
    )
    .orderBy(desc(aiConversations.updatedAt))
    .limit(1);
  return recent?.id ?? null;
}

async function handleMessage(
  fromDigits: string,
  text: string,
  images?: ReadonlyArray<AgentImage>,
): Promise<void> {
  const match = await findUserByPhone(fromDigits);
  if (!match) {
    log.info({ fromDigits }, 'Inbound from unlinked number');
    await sendWhatsAppText(fromDigits, UNLINKED_REPLY);
    return;
  }

  const conversationId = await resolveConversationId(match.tenantId, match.userId);

  const result = await runAiAgentTurn({
    tenantId: match.tenantId,
    userId: match.userId,
    message: text,
    conversationId,
    channel: 'whatsapp',
    ...(images && images.length > 0 ? { images } : {}),
  });

  const reply =
    result.assistantText.trim().length > 0
      ? result.assistantText
      : "I couldn't find an answer to that. Try rephrasing your question.";
  await sendWhatsAppText(fromDigits, reply);
}

/**
 * Route one inbound message: opt-out / opt-in keywords first, then account
 * linking, then honour an existing opt-out (stay silent until START), then
 * text → AI agent and non-text → interim media reply.
 */
async function routeMessage(m: InboundMessage): Promise<void> {
  const from = m.from;

  // Opt-out / opt-in keywords (text only).
  if (m.type === 'text' && m.text) {
    const kw = firstKeyword(m.text.body);
    if (OPT_OUT_KEYWORDS.has(kw)) {
      await setOptOut(from);
      log.info({ from }, 'Sender opted out');
      await sendWhatsAppText(from, OPT_OUT_REPLY);
      return;
    }
    if (OPT_IN_KEYWORDS.has(kw)) {
      await clearOptOut(from);
      log.info({ from }, 'Sender opted back in');
      await sendWhatsAppText(from, OPT_IN_REPLY);
      return;
    }
  }

  // Per-sender flood cap — a looping sender must not be able to drive
  // unbounded Anthropic/OpenAI spend, nor grind through link codes. Runs
  // ahead of the opt-out gate so a code-guessing flood is capped too.
  const rl = await rateLimit(`wa:${from}`, { limit: 15, windowSec: 60 });
  if (!rl.ok) {
    log.warn({ from }, 'WhatsApp sender rate-limited; dropping message');
    return;
  }

  // Account linking runs BEFORE the opt-out gate on purpose: someone who
  // sends a valid one-time code is explicitly asking to be reachable here,
  // which supersedes an earlier STOP (tryLinkAccount clears it on success).
  if (m.type === 'text' && m.text) {
    if (await tryLinkAccount(from, m.text.body)) return;
  }

  // Honour an existing opt-out: send nothing at all until they text START.
  if (await isOptedOut(from)) {
    log.info({ from, type: m.type }, 'Suppressed message from opted-out sender');
    return;
  }

  if (m.type === 'text' && m.text) {
    await handleMessage(from, m.text.body);
    return;
  }

  // Image → Claude vision (Phase 2). Audio → transcribe → agent. Video →
  // sample frames → vision (Phase 3). Each falls back to the interim reply if
  // the media can't be fetched / processed.
  if (m.type === 'image' && m.image) {
    if (await tryHandleImage(from, m.image)) return;
  }
  if (m.type === 'audio' && m.audio) {
    if (await tryHandleAudio(from, m.audio)) return;
  }
  if (m.type === 'video' && m.video) {
    if (await tryHandleVideo(from, m.video)) return;
  }

  await sendWhatsAppText(from, mediaInterimReply(m.type));
}

/**
 * Download an inbound image and run it through the agent's vision. The caption
 * (if any) becomes the turn's text; with no caption we nudge the model that a
 * photo arrived. Returns false (so the caller sends the interim reply) when the
 * media can't be fetched or isn't a vision-supported image type.
 */
async function tryHandleImage(
  from: string,
  image: NonNullable<InboundMessage['image']>,
): Promise<boolean> {
  const media = await fetchWhatsAppMedia(image.id);
  if (!media || !SUPPORTED_IMAGE_MEDIA_TYPES.has(media.mimeType)) {
    log.info({ from, ok: !!media, mimeType: media?.mimeType }, 'image not usable for vision');
    return false;
  }
  const caption = image.caption?.trim();
  const text =
    caption && caption.length > 0
      ? caption
      : 'The user sent this photo with no caption. Describe what you see and ask how you can help (e.g. raise an observation or action).';
  const images: AgentImage[] = [{ base64: media.base64, mediaType: media.mimeType }];
  await handleMessage(from, text, images);
  return true;
}

/**
 * Download a voice note, transcribe it (OpenAI Whisper), and run the transcript
 * through the agent as if the user had typed it. Returns false (→ interim
 * reply) when transcription isn't configured or the audio can't be transcribed.
 */
async function tryHandleAudio(
  from: string,
  audio: NonNullable<InboundMessage['audio']>,
): Promise<boolean> {
  if (!isTranscriptionConfigured()) return false;
  const media = await fetchWhatsAppMedia(audio.id);
  if (!media) return false;
  const transcript = await transcribeAudio(media.base64, media.mimeType);
  if (!transcript) {
    log.info({ from }, 'voice note could not be transcribed');
    return false;
  }
  log.info({ from }, 'transcribed voice note');
  await handleMessage(from, transcript);
  return true;
}

/**
 * Download a video, sample a few frames with ffmpeg, and show them to Claude's
 * vision alongside the caption. Returns false (→ interim reply) when the video
 * can't be fetched or no frames could be extracted.
 */
async function tryHandleVideo(
  from: string,
  video: NonNullable<InboundMessage['video']>,
): Promise<boolean> {
  const media = await fetchWhatsAppMedia(video.id, MAX_VIDEO_BYTES);
  if (!media) return false;
  const frames = await extractVideoFrames(media.base64, media.mimeType);
  if (frames.length === 0) {
    log.info({ from }, 'no frames extracted from video');
    return false;
  }
  const caption = video.caption?.trim();
  const text =
    caption && caption.length > 0
      ? caption
      : 'The user sent this video (shown here as a few still frames). Describe what you see and ask how you can help (e.g. raise an observation or action).';
  await handleMessage(from, text, frames);
  return true;
}

export async function POST(request: Request): Promise<Response> {
  if (!isWhatsAppConfigured()) {
    return new Response('WhatsApp not configured', { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  const sigValid = verifyWhatsAppSignature(rawBody, signature);
  // Ground-truth observability: every inbound POST is logged with its shape so
  // we can see whether Meta is delivering and whether our parser accepts it.
  log.info({ bodyLen: rawBody.length, hasSig: !!signature, sigValid }, 'Webhook POST received');
  if (!sigValid) {
    log.warn('Rejected webhook with invalid signature');
    return new Response('Invalid signature', { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    log.warn('Webhook body was not valid JSON');
    return new Response('Bad JSON', { status: 400 });
  }

  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) {
    // Not a shape we handle (e.g. status receipts) — ack so Meta stops retrying.
    const topKeys =
      payload && typeof payload === 'object' ? Object.keys(payload as Record<string, unknown>) : [];
    log.info({ topKeys }, 'Webhook payload did not match message schema (ignored)');
    return new Response('OK', { status: 200 });
  }

  // Every inbound message (any type), deduped against Meta re-delivery.
  const messages = parsed.data.entry
    ?.flatMap((e) => e.changes ?? [])
    .flatMap((c) => c.value.messages ?? [])
    .filter((m) => !alreadyProcessed(m.id));
  log.info({ messageCount: messages?.length ?? 0 }, 'Webhook payload parsed');

  // Process in a detached task so we ack within Meta's timeout window.
  if (messages && messages.length > 0) {
    void (async () => {
      for (const m of messages) {
        try {
          await routeMessage(m);
        } catch (err) {
          log.error(
            { from: m.from, err: err instanceof Error ? err.message : String(err) },
            'Failed to handle WhatsApp message',
          );
          try {
            await sendWhatsAppText(m.from, GENERIC_ERROR_REPLY);
          } catch {
            // best-effort; nothing more we can do
          }
        }
      }
    })();
  }

  return new Response('OK', { status: 200 });
}
