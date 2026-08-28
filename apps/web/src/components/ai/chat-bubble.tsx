'use client';

import { Bot, MessageCircle, Send, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { MarkdownMessage } from './markdown-message';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

type StreamEvent =
  | { type: 'conversation'; conversationId: string; isNew: boolean }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; toolName: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * Floating assistant launcher shown on every signed-in page. A compact,
 * self-contained chat that talks to the same `/api/ai/chat` streaming
 * endpoint as the full AI Assistant page. Hidden on the AI page itself,
 * where the full chat already lives.
 *
 * Desktop-only, bottom-right. On phones the launcher does not render at
 * all: the bottom-right thumb corner belongs to the registers' Report
 * action (ReportFab, UI review item 6), and the agent has a permanent
 * tab in the bottom bar that opens the full-page chat — a second
 * floating entry point to the same chat would be clutter.
 */
export function ChatBubble() {
  const t = useTranslations('ai');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const suggestions = (t.raw('suggestions') as string[] | undefined) ?? [];

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const send = useCallback(
    async (textArg?: string) => {
      const text = (textArg ?? input).trim();
      if (!text || streaming) return;
      setMessages((p) => [...p, { id: `u-${Date.now()}`, role: 'user', content: text }]);
      setInput('');
      setStreaming(true);
      const ac = new AbortController();
      abortRef.current = ac;
      const aid = `a-${Date.now()}`;
      let acc = '';
      setMessages((p) => [...p, { id: aid, role: 'assistant', content: '' }]);
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: convId, message: text }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error('stream');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.startsWith('data: ') ? part.slice(6) : null;
            if (!line) continue;
            try {
              const ev = JSON.parse(line) as StreamEvent;
              if (ev.type === 'conversation') setConvId(ev.conversationId);
              else if (ev.type === 'text') {
                acc += ev.delta;
                setMessages((p) => p.map((m) => (m.id === aid ? { ...m, content: acc } : m)));
              } else if (ev.type === 'error') {
                setMessages((p) =>
                  p.map((m) => (m.id === aid ? { ...m, content: `Error: ${ev.message}` } : m)),
                );
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setMessages((p) =>
            p.map((m) => (m.id === aid ? { ...m, content: t('streamError') } : m)),
          );
        }
      } finally {
        setStreaming(false);
      }
    },
    [input, streaming, convId, t],
  );

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // Don't show the launcher on the full AI Assistant page.
  // The whole /ai subtree: the full chat lives on /ai itself, and the
  // agent settings pages under /ai/agents are about the agents — a
  // floating door to the same chat there is clutter.
  if (/\/ai(\/|$)/.test(pathname)) return null;

  return (
    <>
      {open ? (
        // Raised on phones to clear the fixed tab bar (ADR 0014).
        <div className="fixed bottom-20 right-4 z-50 hidden h-[520px] max-h-[calc(100dvh-7rem)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-card shadow-xl md:flex">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Bot className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold">{t('bubbleTitle')}</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('close')}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Bot className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium">{t('emptyTitle')}</p>
                <div className="flex w-full flex-col gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      disabled={streaming}
                      className="rounded-lg border bg-background px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                        m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                      )}
                    >
                      {m.content === '' && m.role === 'assistant' ? (
                        <span className="animate-pulse text-muted-foreground">{t('thinking')}</span>
                      ) : m.role === 'assistant' ? (
                        <MarkdownMessage content={m.content} />
                      ) : (
                        <div className="whitespace-pre-wrap break-words">{m.content}</div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <div className="border-t p-2.5">
            <div className="flex items-end gap-2 rounded-xl border bg-muted/30 px-3 py-2 focus-within:border-primary">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                placeholder={t('inputPlaceholder')}
                rows={1}
                disabled={streaming}
                className="max-h-24 min-h-[1.25rem] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim() || streaming}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
                aria-label={t('send')}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('bubbleLabel')}
        className="fixed bottom-4 right-4 z-50 hidden h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 md:flex"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </>
  );
}
