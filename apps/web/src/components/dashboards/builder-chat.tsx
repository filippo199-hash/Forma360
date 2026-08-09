'use client';

/**
 * The dashboard builder / refine chat (ADR 0018). One component serves
 * both modes: creation (no currentSpec) and refinement (currentSpec +
 * title). Streams the assistant over SSE from /api/ai/dashboard-chat and
 * hands validated proposals to the caller. Speech-to-text via the mic
 * button → /api/ai/transcribe (hidden when the server lacks a key).
 */
import type { DashboardSpec } from '@forma360/shared/dashboard-spec';
import { Loader2, Mic, Send, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { AutoGrowTextarea } from '../ui/auto-grow-textarea';

export interface BuilderProposal {
  spec: DashboardSpec;
  title: string;
  description: string | null;
  note: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BuilderChatProps {
  /** Refine mode: the spec being edited. Omit for creation. */
  currentSpec?: DashboardSpec | null;
  currentTitle?: string | null;
  /** Called with each validated proposal. Return a promise; errors are shown. */
  onProposal: (proposal: BuilderProposal) => Promise<void>;
  /** Suggested prompts shown before the first message (creation mode). */
  suggestions?: readonly string[];
  className?: string;
}

type StreamState = 'idle' | 'streaming' | 'building' | 'applying';

export function BuilderChat({
  currentSpec,
  currentTitle,
  onProposal,
  suggestions = [],
  className,
}: BuilderChatProps) {
  const t = useTranslations('dashboards');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streamText, setStreamText] = useState('');
  const [state, setState] = useState<StreamState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [micAvailable, setMicAvailable] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/ai/transcribe')
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((body: { available?: boolean }) => {
        if (!cancelled) setMicAvailable(body.available === true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamText]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || state !== 'idle') return;
      setError(null);
      const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
      setMessages(nextMessages);
      setInput('');
      setState('streaming');
      setStreamText('');

      try {
        const response = await fetch('/api/ai/dashboard-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: nextMessages,
            ...(currentSpec != null ? { currentSpec, currentTitle: currentTitle ?? undefined } : {}),
          }),
        });
        if (!response.ok || response.body === null) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? t('chat.requestFailed'));
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
              | { type: 'assistant_done'; text: string }
              | { type: 'building_started' }
              | { type: 'proposal'; spec: DashboardSpec; title: string; description: string | null; note: string }
              | { type: 'done' }
              | { type: 'error'; message: string };
            if (event.type === 'text') {
              assistantText += event.delta;
              setStreamText(assistantText);
            } else if (event.type === 'building_started') {
              setState('building');
            } else if (event.type === 'assistant_done') {
              setMessages((prev) => [...prev, { role: 'assistant', content: event.text }]);
              setStreamText('');
            } else if (event.type === 'proposal') {
              setState('applying');
              setMessages((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  content: event.note.length > 0 ? event.note : t('chat.proposalApplied'),
                },
              ]);
              setStreamText('');
              await onProposal({
                spec: event.spec,
                title: event.title,
                description: event.description,
                note: event.note,
              });
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('chat.requestFailed'));
      } finally {
        setState('idle');
        setStreamText('');
      }
    },
    [messages, state, currentSpec, currentTitle, onProposal, t],
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const parts: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) parts.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(parts, { type: recorder.mimeType });
        setTranscribing(true);
        const fileReader = new FileReader();
        fileReader.onloadend = () => {
          const result = typeof fileReader.result === 'string' ? fileReader.result : '';
          const base64 = result.split(',')[1] ?? '';
          void fetch('/api/ai/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio: base64, mimeType: recorder.mimeType }),
          })
            .then(async (r) => {
              if (!r.ok) throw new Error(t('chat.transcribeFailed'));
              const body = (await r.json()) as { text?: string };
              if (typeof body.text === 'string' && body.text.length > 0) {
                setInput((prev) => (prev.length > 0 ? `${prev} ${body.text ?? ''}` : (body.text ?? '')));
              }
            })
            .catch(() => setError(t('chat.transcribeFailed')))
            .finally(() => setTranscribing(false));
        };
        fileReader.readAsDataURL(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError(t('chat.micDenied'));
    }
  }, [t]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const busy = state !== 'idle';

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && suggestions.length > 0 ? (
          <div className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground">{t('chat.suggestionsIntro')}</p>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="block w-full rounded-md border bg-muted/40 px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        {messages.map((message, i) => (
          <div
            key={i}
            className={cn(
              'max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
              message.role === 'user'
                ? 'ml-auto bg-primary text-primary-foreground'
                : 'bg-muted',
            )}
          >
            {message.content}
          </div>
        ))}
        {streamText.length > 0 ? (
          <div className="max-w-[92%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
            {streamText}
          </div>
        ) : null}
        {state === 'building' || state === 'applying' ? (
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {state === 'building' ? t('chat.building') : t('chat.applying')}
          </div>
        ) : null}
        {error !== null ? <p className="px-1 text-sm text-destructive">{error}</p> : null}
      </div>

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <AutoGrowTextarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={currentSpec != null ? t('chat.refinePlaceholder') : t('chat.createPlaceholder')}
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
        {micAvailable ? (
          <Button
            type="button"
            size="icon"
            variant={recording ? 'destructive' : 'outline'}
            onClick={() => (recording ? stopRecording() : void startRecording())}
            disabled={busy || transcribing}
            aria-label={recording ? t('chat.stopRecording') : t('chat.startRecording')}
          >
            {transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : recording ? (
              <Square className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
        ) : null}
        <Button type="submit" size="icon" disabled={busy || input.trim().length === 0} aria-label={t('chat.send')}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
