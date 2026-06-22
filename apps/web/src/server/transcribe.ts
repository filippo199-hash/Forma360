/**
 * Speech-to-text for inbound WhatsApp voice notes, via OpenAI Whisper.
 *
 * This is the ONE place the app calls a non-Anthropic model, and only because
 * Claude's API can't transcribe audio. All reasoning still happens on Claude —
 * we just turn the voice note into text and feed it to the agent like any
 * typed message. Gated on OPENAI_API_KEY; unset → returns null and the caller
 * falls back to the "please send text" reply.
 */
import { z } from 'zod';
import { env } from './env';
import { logger } from './logger';

const log = logger.child({ module: 'transcribe' });

const responseSchema = z.object({ text: z.string() });

/** Whisper-accepted file extension for the common WhatsApp audio mime types. */
const EXT_BY_MIME: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
};

export function isTranscriptionConfigured(): boolean {
  return !!env.OPENAI_API_KEY;
}

/**
 * Transcribe base64 audio to text. Returns the transcript, or null when not
 * configured / the request fails / the transcript is empty.
 */
export async function transcribeAudio(base64: string, mimeType: string): Promise<string | null> {
  const key = env.OPENAI_API_KEY;
  if (!key) return null;

  try {
    const buf = Buffer.from(base64, 'base64');
    const ext = EXT_BY_MIME[mimeType.split(';')[0]?.trim() ?? ''] ?? 'ogg';
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mimeType }), `voice.${ext}`);
    form.append('model', 'whisper-1');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'transcription request failed');
      return null;
    }
    const parsed = responseSchema.safeParse(await res.json().catch(() => ({})));
    if (!parsed.success) {
      log.warn('transcription response shape unexpected');
      return null;
    }
    const text = parsed.data.text.trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'transcription threw');
    return null;
  }
}
