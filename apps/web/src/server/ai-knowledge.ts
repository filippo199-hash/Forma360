/**
 * Knowledge-file text extraction for the AI Agents feature.
 *
 * Runs ONCE at upload time: the admin's document (PDF, image, or plain
 * text) becomes stored text on the `ai_agent_knowledge_files` row, and
 * runtime agent turns only ever read that text — no per-request blob
 * fetches, no re-parsing, and a corrupt file can never break a draft.
 *
 * PDFs and images go to Claude natively (the coshh-ai.ts pattern — no OCR
 * library, no text pre-extraction); text files are decoded directly. A
 * failed extraction returns null and the caller stores the row with
 * `status: 'failed'` so the admin can see the file contributed nothing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';

const MODEL = 'claude-opus-5';

/** Hard cap on stored text — the prompt budget truncates further anyway. */
const MAX_EXTRACTED_CHARS = 40_000;

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv']);

const EXTRACT_INSTRUCTION =
  'Transcribe the useful content of this document as plain text, faithfully and completely. Keep headings, lists and tables (as simple text rows). Do not summarise, do not add commentary — output only the transcription. If the document is unreadable, output exactly: UNREADABLE';

export function isKnowledgeMimeSupported(mimeType: string): boolean {
  return mimeType === 'application/pdf' || IMAGE_MIME.has(mimeType) || TEXT_MIME.has(mimeType);
}

export async function extractKnowledgeText(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<string | null> {
  try {
    if (TEXT_MIME.has(input.mimeType)) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(input.bytes).trim();
      return text.length > 0 ? text.slice(0, MAX_EXTRACTED_CHARS) : null;
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const data = Buffer.from(input.bytes).toString('base64');
    const block =
      input.mimeType === 'application/pdf'
        ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
        : ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: input.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data,
            },
          } as const);

    // Streaming keeps a long transcription inside HTTP timeouts (the
    // coshh-ai lesson); we only need the final message.
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: [block, { type: 'text', text: `${EXTRACT_INSTRUCTION}\n\nFilename: ${input.filename}` }],
        },
      ],
    });
    const finalMsg = await stream.finalMessage();
    if (finalMsg.stop_reason === 'refusal') return null;
    const text = finalMsg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text.length === 0 || text === 'UNREADABLE') return null;
    return text.slice(0, MAX_EXTRACTED_CHARS);
  } catch {
    return null;
  }
}
