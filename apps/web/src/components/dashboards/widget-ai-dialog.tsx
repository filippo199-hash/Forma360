'use client';

/**
 * Per-widget AI chat (ADR 0018 follow-up). A chat tagged to ONE widget:
 * the questions are answered strictly from that widget's current data,
 * streamed from /api/ai/widget-chat. Opened from the AI button on the
 * widget card.
 */
import type { DashboardDateRange } from '@forma360/shared/dashboard-spec';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { AutoGrowTextarea } from '../ui/auto-grow-textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface WidgetAiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  widgetId: string;
  widgetTitle: string;
  /** The dashboard's currently-applied filters, so the AI sees the same data. */
  filters: { dateRange: DashboardDateRange; siteIds: readonly string[] };
}

export function WidgetAiDialog({
  open,
  onOpenChange,
  dashboardId,
  widgetId,
  widgetTitle,
  filters,
}: WidgetAiDialogProps) {
  const t = useTranslations('dashboards');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streamText, setStreamText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reset the conversation each time the dialog opens for a widget.
  useEffect(() => {
    if (open) {
      setMessages([]);
      setStreamText('');
      setError(null);
      setInput('');
    }
  }, [open, widgetId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamText]);

  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setStreamText('');
    try {
      const response = await fetch('/api/ai/widget-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dashboardId,
          widgetId,
          messages: next,
          filters: { dateRange: filters.dateRange, siteIds: [...filters.siteIds] },
        }),
      });
      if (!response.ok || response.body === null) {
        throw new Error(t('widgetChat.failed'));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6)) as
            | { type: 'text'; delta: string }
            | { type: 'done'; text: string }
            | { type: 'error'; message: string };
          if (event.type === 'text') {
            assistantText += event.delta;
            setStreamText(assistantText);
          } else if (event.type === 'done') {
            setMessages((prev) => [...prev, { role: 'assistant', content: event.text }]);
            setStreamText('');
          } else {
            throw new Error(event.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('widgetChat.failed'));
    } finally {
      setBusy(false);
      setStreamText('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            {t('widgetChat.title')}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('widgetChat.subtitle', { widget: widgetTitle })}
          </p>
        </DialogHeader>

        <div ref={scrollRef} className="min-h-40 flex-1 space-y-3 overflow-y-auto py-2">
          {messages.length === 0 && streamText.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">{t('widgetChat.intro')}</p>
          ) : null}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
                m.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted',
              )}
            >
              {m.content}
            </div>
          ))}
          {streamText.length > 0 ? (
            <div className="max-w-[92%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
              {streamText}
            </div>
          ) : null}
          {busy && streamText.length === 0 ? (
            <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t('widgetChat.thinking')}
            </div>
          ) : null}
          {error !== null ? <p className="px-1 text-sm text-destructive">{error}</p> : null}
        </div>

        <form
          className="flex items-end gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <AutoGrowTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('widgetChat.placeholder')}
            className="min-h-9 flex-1 resize-none text-sm"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            disabled={busy}
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || input.trim().length === 0}
            aria-label={t('widgetChat.send')}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
