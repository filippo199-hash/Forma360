/**
 * Speech-to-text for the dashboard chats (ADR 0018).
 *
 * Generalises the WhatsApp voice-note pipeline: the browser records a
 * short clip, posts it here as base64, and gets the transcript back to
 * drop into the chat input. Reuses `transcribeAudio` (OpenAI Whisper,
 * gated on OPENAI_API_KEY) — all reasoning stays on Claude; this only
 * turns speech into text.
 *
 * GET reports availability so the UI can hide the mic button instead of
 * failing on first use.
 */
import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '../../../../src/server/auth';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';
import {
  isTranscriptionConfigured,
  transcribeAudio,
} from '../../../../src/server/transcribe';

/** ~7.5 MB of audio (10 MB base64) — minutes of speech, far beyond a prompt. */
const MAX_BASE64_LENGTH = 10_000_000;

const bodySchema = z.object({
  audio: z.string().min(1).max(MAX_BASE64_LENGTH),
  mimeType: z.string().min(1).max(100),
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });
  return jsonResponse(200, { available: isTranscriptionConfigured() });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });

  if (!isTranscriptionConfigured()) {
    return jsonResponse(503, { error: 'transcription-unavailable' });
  }

  const rl = await rateLimit(`ai:transcribe:${session.user.id}`, { limit: 20, windowSec: 300 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonResponse(400, { error: 'Bad request' });

  const text = await transcribeAudio(body.data.audio, body.data.mimeType);
  if (text === null) {
    return jsonResponse(422, { error: 'transcription-failed' });
  }
  return jsonResponse(200, { text });
}
