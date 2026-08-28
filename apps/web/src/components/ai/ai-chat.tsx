'use client';

import { Bot, Check, Copy, MessageSquarePlus, Plus, Send, Square, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { trpc } from '../../lib/trpc/client';
import { cn } from '../../lib/cn';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { AgentTiles } from './agent-tiles';
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
  const tAgents = useTranslations('aiAgents');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [toolsActive, setToolsActive] = useState<string[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Touch keyboards have no Shift+Enter, so Enter can't both send AND insert a
  // newline. On a coarse pointer we make Enter insert a newline and rely on the
  // Send button to submit (#1).
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

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

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setIsCoarsePointer(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  /** Collapse the composer back to its resting height (#2). */
  function resetInputHeight() {
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  function startNew() {
    abortRef.current?.abort();
    setActiveConvId(null);
    setMessages([]);
    setStreaming(false);
    setToolsActive([]);
    setInput('');
    resetInputHeight();
    setHistoryOpen(false);
    textareaRef.current?.focus();
  }

  async function loadConversation(convId: string) {
    setHistoryOpen(false);
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

  const send = useCallback(
    async (textArg?: string) => {
      const text = (textArg ?? input).trim();
      if (!text || streaming) return;

      const userMsg: Message = { id: `local-${Date.now()}`, role: 'user', content: text };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      resetInputHeight();
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
                  prev.map((m) => (m.id === assistantId ? { ...m, content: assistantContent } : m)),
                );
              } else if (event.type === 'tool_call') {
                setToolsActive((prev) =>
                  prev.includes(event.toolName) ? prev : [...prev, event.toolName],
                );
              } else if (event.type === 'done') {
                setToolsActive([]);
                void utils.aiAssistant.listConversations.invalidate();
              } else if (event.type === 'error') {
                // Never surface the raw provider payload (status codes,
                // request ids) — translate to the same human message the
                // catch below uses. UXW1-05.
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: t('streamError') } : m)),
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
            prev.map((m) => (m.id === assistantId ? { ...m, content: t('streamError') } : m)),
          );
        }
      } finally {
        setStreaming(false);
        setToolsActive([]);
      }
    },
    [input, streaming, activeConvId, utils, t],
  );

  /** Cancel an in-flight response, keeping whatever streamed so far (#4). */
  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
    setToolsActive([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on a mouse/keyboard device; Shift+Enter always inserts a
    // newline. On touch (no Shift+Enter) Enter inserts a newline instead, so
    // multi-line stays possible — the Send button submits (#1).
    if (e.key === 'Enter' && !e.shiftKey && !isCoarsePointer) {
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

  async function copyMessage(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  // Example prompts shown on the empty state to hint at what can be asked.
  const suggestions = (t.raw('suggestions') as string[] | undefined) ?? [];

  // Shared input control — reused in the centered welcome and the
  // pinned-to-bottom conversation layouts.
  const inputBox = (
    <div>
      <div className="flex items-end gap-2 rounded-2xl border bg-background px-4 py-3 focus-within:border-primary">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={autoResize}
          onKeyDown={onKeyDown}
          placeholder={t('inputPlaceholder')}
          rows={2}
          className="max-h-40 min-h-[2.75rem] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {streaming ? (
          <button
            type="button"
            onClick={stop}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity"
            aria-label={t('stop')}
          >
            <Square className="h-3.5 w-3.5" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
            aria-label={t('send')}
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">{t('inputHint')}</p>
    </div>
  );

  // Conversation list — reused in the desktop aside and the mobile sheet (#3).
  function conversationNav() {
    return conversations.length === 0 ? (
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
    );
  }

  return (
    <div className="flex h-[calc(100svh-4rem)] overflow-hidden bg-muted dark:bg-slate-900/40">
      {/* ── Center: chat ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar — the desktop aside is hidden < lg, so New chat +
            history live here on small screens (#3). */}
        <div className="flex items-center justify-between border-b px-3 py-2 lg:hidden">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Bot className="h-3.5 w-3.5" />
                {t('historyTitle')}
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="border-b px-4 py-3 text-left">
                <SheetTitle className="text-sm">{t('historyTitle')}</SheetTitle>
              </SheetHeader>
              <nav className="overflow-y-auto py-2">{conversationNav()}</nav>
            </SheetContent>
          </Sheet>
          <button
            type="button"
            onClick={startNew}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('newChat')}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            {t('newChat')}
          </button>
        </div>

        {messages.length === 0 ? (
          /* Centered welcome: greeting + input + suggested prompts, then the
             agent tiles (AI Agents). `overflow-y-auto` + `justify-start`
             because the tile grid outgrows the fixed-height column — the
             root is h-[calc(100svh-4rem)] overflow-hidden. */
          <div className="flex flex-1 flex-col items-center justify-start gap-5 overflow-y-auto px-6 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Bot className="h-7 w-7" />
            </div>
            <div className="text-center">
              <p className="text-xl font-semibold">{t('emptyTitle')}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                {t('emptySubtitle')}
              </p>
            </div>
            <div className="w-full max-w-2xl">{inputBox}</div>
            <div className="flex max-w-2xl flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  disabled={streaming}
                  className="rounded-full border bg-background px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="text-center text-[11px] text-muted-foreground">{t('disclaimer')}</p>
            <div className="w-full max-w-3xl pt-4">
              <p className="mb-1 text-sm font-semibold">{tAgents('hub.heading')}</p>
              <p className="mb-3 text-xs text-muted-foreground">{tAgents('hub.subheading')}</p>
              <AgentTiles />
            </div>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl space-y-6 p-6">
                {messages.map((msg, index) => {
                  const isStreamingMsg =
                    streaming && index === messages.length - 1 && msg.role === 'assistant';
                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        'group flex gap-3',
                        msg.role === 'user' ? 'justify-end' : 'justify-start',
                      )}
                    >
                      {msg.role === 'assistant' && (
                        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Bot className="h-4 w-4" />
                        </div>
                      )}
                      <div className="flex max-w-[75%] flex-col gap-1">
                        <div
                          className={cn(
                            'rounded-2xl px-4 py-2.5 text-sm',
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground',
                          )}
                        >
                          {msg.content === '' && msg.role === 'assistant' ? (
                            <span className="animate-pulse text-muted-foreground">
                              {t('thinking')}
                            </span>
                          ) : msg.role === 'assistant' && isStreamingMsg ? (
                            // Render plain while streaming so half-written markdown
                            // (links/tables) doesn't flash raw; snap to formatted
                            // once the message settles (#7).
                            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                          ) : msg.role === 'assistant' ? (
                            <MarkdownMessage content={msg.content} />
                          ) : (
                            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                          )}
                        </div>
                        {/* Copy affordance on settled assistant answers (#8). */}
                        {msg.role === 'assistant' && msg.content !== '' && !isStreamingMsg && (
                          <button
                            type="button"
                            onClick={() => void copyMessage(msg.id, msg.content)}
                            className="flex w-fit items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check className="h-3 w-3" />
                                {t('copied')}
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                {t('copy')}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {toolsActive.length > 0 && (
                  <div className="flex justify-start gap-3">
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                      <span className="animate-pulse">{t('working')}</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input area pinned to the bottom during a conversation. */}
            <div className="border-t bg-background p-4">
              <div className="mx-auto max-w-3xl">
                {inputBox}
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  {t('disclaimer')}
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Right: conversation history (desktop) ───────────────────────── */}
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
        <nav className="flex-1 overflow-y-auto py-2">{conversationNav()}</nav>
      </aside>
    </div>
  );
}
