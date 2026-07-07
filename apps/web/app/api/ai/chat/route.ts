import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '../../../../src/server/auth';
import { type AgentEvent, runAiAgentTurn } from '../../../../src/server/ai-agent';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';

const bodySchema = z.object({
  conversationId: z.string().length(26).nullable().optional(),
  message: z.string().min(1).max(10_000),
});

function sseChunk(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const tenantId = (session.user as Record<string, unknown>)['tenantId'];
  const userId = session.user.id;
  if (typeof tenantId !== 'string') {
    return new Response(JSON.stringify({ error: 'No tenant' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cap AI token spend per user (Anthropic cost DoS control).
  const rl = await rateLimit(`ai:chat:${userId}`, { limit: 30, windowSec: 60 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const body = bodySchema.safeParse(await request.json());
  if (!body.success) {
    return new Response(JSON.stringify({ error: 'Bad request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { message, conversationId: incomingConvId } = body.data;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  void (async () => {
    try {
      await runAiAgentTurn({
        tenantId,
        userId,
        message,
        conversationId: incomingConvId,
        onEvent: (event: AgentEvent) => {
          void writer.write(sseChunk(event));
        },
      });
      await writer.write(sseChunk({ type: 'done' }));
    } catch (err) {
      void writer.write(
        sseChunk({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' }),
      );
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
