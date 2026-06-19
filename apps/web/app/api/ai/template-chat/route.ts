import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '../../../../src/server/auth';
import {
  type TemplateAgentEvent,
  runTemplateAgentTurn,
} from '../../../../src/server/template-agent';

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(20_000),
      }),
    )
    .min(1)
    .max(40),
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
  if (typeof tenantId !== 'string') {
    return new Response(JSON.stringify({ error: 'No tenant' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = bodySchema.safeParse(await request.json());
  if (!body.success) {
    return new Response(JSON.stringify({ error: 'Bad request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  void (async () => {
    try {
      await runTemplateAgentTurn({
        messages: body.data.messages,
        onEvent: (event: TemplateAgentEvent) => {
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
