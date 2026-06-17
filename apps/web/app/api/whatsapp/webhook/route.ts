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
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { aiConversations, user } from '@forma360/db/schema';
import { runAiAgentTurn } from '../../../../src/server/ai-agent';
import { db } from '../../../../src/server/db';
import { env } from '../../../../src/server/env';
import { logger } from '../../../../src/server/logger';
import {
  isWhatsAppConfigured,
  sendWhatsAppText,
  verifyWhatsAppSignature,
} from '../../../../src/server/whatsapp';

const log = logger.child({ module: 'whatsapp-webhook' });

/** Continue the user's most recent conversation if touched within this window. */
const CONVERSATION_RECENCY_MS = 6 * 60 * 60 * 1000;

/** Message shown when an inbound number isn't linked to any Forma360 user. */
const UNLINKED_REPLY =
  "Hi! This WhatsApp number isn't linked to a Forma360 account yet. Ask your administrator to add your phone number to your user profile, then try again.";

const GENERIC_ERROR_REPLY =
  'Sorry — something went wrong handling your message. Please try again in a moment.';

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
  log.warn({ mode, tokenMatches: token === env.WHATSAPP_VERIFY_TOKEN }, 'Webhook GET verification failed');
  return new Response('Forbidden', { status: 403 });
}

// ─── POST: inbound messages ──────────────────────────────────────────────────

// Minimal slice of the WhatsApp webhook payload we care about: text messages.
const webhookSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z.object({
                messages: z
                  .array(
                    z.object({
                      from: z.string(),
                      id: z.string(),
                      type: z.string(),
                      text: z.object({ body: z.string() }).optional(),
                    }),
                  )
                  .optional(),
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

/** Find an active Forma360 user whose stored phone matches the WhatsApp sender. */
async function findUserByPhone(
  fromDigits: string,
): Promise<{ userId: string; tenantId: string } | null> {
  const withPlus = `+${fromDigits}`;
  const rows = await db
    .select({ userId: user.id, tenantId: user.tenantId })
    .from(user)
    .where(
      and(
        or(eq(user.phone, withPlus), eq(user.phone, fromDigits)),
        isNull(user.deactivatedAt),
      ),
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

async function handleMessage(fromDigits: string, text: string): Promise<void> {
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
  });

  const reply =
    result.assistantText.trim().length > 0
      ? result.assistantText
      : "I couldn't find an answer to that. Try rephrasing your question.";
  await sendWhatsAppText(fromDigits, reply);
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

  const messages = parsed.data.entry
    ?.flatMap((e) => e.changes ?? [])
    .flatMap((c) => c.value.messages ?? [])
    .filter((m) => m.type === 'text' && m.text && !alreadyProcessed(m.id));
  log.info({ messageCount: messages?.length ?? 0 }, 'Webhook payload parsed');

  // Process in a detached task so we ack within Meta's timeout window.
  if (messages && messages.length > 0) {
    void (async () => {
      for (const m of messages) {
        const body = m.text?.body;
        if (body === undefined) continue;
        try {
          await handleMessage(m.from, body);
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
