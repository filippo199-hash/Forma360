'use client';

import { Bot, Plus, Send, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { trpc } from '../../lib/trpc/client';
import { cn } from '../../lib/cn';
import { MarkdownMessage } from './markdown-message';

interface Message {
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

export function AiChat() {
  const t = useTranslations('ai');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [toolsActive, setToolsActive] = useState<string[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Only load convMessages into state when navigating to a historical conversation,
  // not after a live stream ends (stale convMessages would wipe accumulated text).
  const loadingHistoryRef = useRef(false);

  const utils = trpc.useUtils();
  const { data: conversations = [] } = trpc.aiAssistant.listConversations.useQuery();
  const deleteConv = trpc.aiAssistant.deleteConversation.useMutation({
    onSuccess: () => void utils.aiAssistant.listConversations.invalidate(),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function startNew() {
    abortRef.current?.abort();
    setActiveConvId(null);
    setMessages([]);
    setStreaming(false);
    setToolsActive([]);
    textareaRef.current?.focus();
  }

  async function loadConversation(convId: string) {
    if (convId === activeConvId) return;
    abortRef.current?.abort();
    loadingHistoryRef.current = true;
    setActiveConvId(convId);
    setStreaming(false);
    setToolsActive([]);
    setMessages([]);
  }

  const { data: convMessages } = trpc.aiAssistant.getMessages.useQuery(
    { conversationId: activeConvId ?? '' },
    { enabled: activeConvId !== null },
  );

  useEffect(() => {
    if (convMessages && activeConvId && !streaming && loadingHistoryRef.current) {
      loadingHistoryRef.current = false;
      setMessages(
        convMessages.map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      );
    }
  }, [convMessages, activeConvId, streaming]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { id: `local-${Date.now()}`, role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    setToolsActive([]);

    const ac = new AbortController();
    abortRef.current = ac;

    const assistantId = `stream-${Date.now()}`;
    let assistantContent = '';

    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConvId, message: text }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) throw new Error('Stream failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.startsWith('data: ') ? part.slice(6) : null;
          if (!line) continue;
          try {
            const event: StreamEvent = JSON.parse(line) as StreamEvent;
            if (event.type === 'conversation') {
              setActiveConvId(event.conversationId);
              void utils.aiAssistant.listConversations.invalidate();
            } else if (event.type === 'text') {
              assistantContent += event.delta;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: assistantContent } : m,
                ),
              );
            } else if (event.type === 'tool_call') {
              setToolsActive((prev) =>
                prev.includes(event.toolName) ? prev : [...prev, event.toolName],
              );
            } else if (event.type === 'done') {
              setToolsActive([]);
              void utils.aiAssistant.listConversations.invalidate();
            } else if (event.type === 'error') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: `Error: ${event.message}` }
                    : m,
                ),
              );
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: t('streamError') }
              : m,
          ),
        );
      }
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, activeConvId, utils, t]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  return (
    <div className="flex h-[calc(100svh-4rem)] overflow-hidden">
      {/* ── Center: chat ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <Bot className="h-12 w-12 text-muted-foreground/40" />
              <div>
                <p className="text-lg font-semibold">{t('emptyTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('emptySubtitle')}</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 p-6">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  {msg.role === 'assistant' && (
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm',
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground',
                    )}
                  >
                    {msg.content === '' && msg.role === 'assistant' ? (
                      <span className="animate-pulse text-muted-foreground">{t('thinking')}</span>
                    ) : msg.role === 'assistant' ? (
                      <MarkdownMessage content={msg.content} />
                    ) : (
                      <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                    )}
                  </div>
                </div>
              ))}
              {toolsActive.length > 0 && (
                <div className="flex justify-start gap-3">
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                    <span className="animate-pulse">
                      {t('lookingUp', { tool: toolsActive[toolsActive.length - 1] ?? '' })}
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t bg-background p-4">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2 rounded-2xl border bg-muted/30 px-4 py-3 focus-within:border-primary">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={autoResize}
                onKeyDown={onKeyDown}
                placeholder={t('inputPlaceholder')}
                rows={1}
                disabled={streaming}
                className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim() || streaming}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
                aria-label={t('send')}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">{t('disclaimer')}</p>
          </div>
        </div>
      </div>

      {/* ── Right: conversation history ─────────────────────────────────── */}
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-l bg-card lg:flex lg:flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">{t('historyTitle')}</span>
          <button
            type="button"
            onClick={startNew}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('newChat')}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('newChat')}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {conversations.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t('noHistory')}</p>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  'group flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60',
                  conv.id === activeConvId && 'bg-accent text-accent-foreground',
                )}
                role="button"
                tabIndex={0}
                onClick={() => void loadConversation(conv.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') void loadConversation(conv.id);
                }}
              >
                <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">{conv.title}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConv.mutate({ conversationId: conv.id });
                    if (conv.id === activeConvId) startNew();
                  }}
                  className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:flex"
                  aria-label={t('deleteConversation')}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </nav>
      </aside>
    </div>
  );
}
