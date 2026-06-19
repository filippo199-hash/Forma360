'use client';

/**
 * "Create a template" entry point — three ways in:
 *   1. From scratch — name + description → an empty draft (the classic path).
 *   2. With AI — a short guided chat with the generation agent that drafts a
 *      full structured template (sections, response sets, flags, logic).
 *   3. Import — convert a PDF or Excel file into a template (Phase D / E).
 *
 * The AI chat streams over `/api/ai/template-chat`; once the agent emits a
 * `proposal` (a validated TemplateSpec), we call `templates.createFromSpec`
 * (which expands the spec server-side) and drop the user straight into the
 * editor.
 */
import {
  ArrowLeft,
  Bot,
  Check,
  ClipboardList,
  FileUp,
  GitBranch,
  LayoutList,
  Loader2,
  MessageSquareText,
  Palette,
  PencilLine,
  Send,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TemplateSpec } from '@forma360/shared/template-spec';
import { trpc } from '../../lib/trpc/client';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { MarkdownMessage } from '../ai/markdown-message';
import { ImportTemplatePanel } from './import-template-panel';

type Mode = 'choose' | 'scratch' | 'ai' | 'import';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'assistant_done'; text: string }
  | { type: 'building_started' }
  | { type: 'proposal'; spec: TemplateSpec; note: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export function CreateTemplateDialog({
  open,
  onOpenChange,
  locale,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locale: string;
}) {
  const t = useTranslations('templates.create');
  const [mode, setMode] = useState<Mode>('choose');

  // Reset to the chooser whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) setMode('choose');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(mode === 'ai' ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode !== 'choose' && (
              <button
                type="button"
                onClick={() => setMode('choose')}
                className="-ml-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t('back')}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {mode === 'choose' && t('title')}
            {mode === 'scratch' && t('scratchTitle')}
            {mode === 'ai' && t('aiTitle')}
            {mode === 'import' && t('importTitle')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'choose' && t('chooseSubtitle')}
            {mode === 'ai' && t('aiSubtitle')}
            {mode === 'import' && t('importSubtitle')}
          </DialogDescription>
        </DialogHeader>

        {mode === 'choose' && <ChooseMode onPick={setMode} />}
        {mode === 'scratch' && <ScratchMode locale={locale} onOpenChange={onOpenChange} />}
        {mode === 'ai' && <AiMode locale={locale} onOpenChange={onOpenChange} />}
        {mode === 'import' && <ImportTemplatePanel locale={locale} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  );
}

// ─── Chooser ────────────────────────────────────────────────────────────────

function ChooseMode({ onPick }: { onPick: (m: Mode) => void }) {
  const t = useTranslations('templates.create');
  const options: {
    mode: Mode;
    icon: typeof Sparkles;
    title: string;
    desc: string;
    accent?: boolean;
  }[] = [
    { mode: 'ai', icon: Sparkles, title: t('optAiTitle'), desc: t('optAiDesc'), accent: true },
    { mode: 'scratch', icon: PencilLine, title: t('optScratchTitle'), desc: t('optScratchDesc') },
    { mode: 'import', icon: FileUp, title: t('optImportTitle'), desc: t('optImportDesc') },
  ];
  return (
    <div className="space-y-2.5">
      {options.map((o) => (
        <button
          key={o.mode}
          type="button"
          onClick={() => onPick(o.mode)}
          className={cn(
            'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:border-primary hover:bg-accent/40',
            o.accent && 'border-primary/40 bg-primary/[0.04]',
          )}
        >
          <div
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              o.accent ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
            )}
          >
            <o.icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{o.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{o.desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── From scratch ─────────────────────────────────────────────────────────────

function ScratchMode({
  locale,
  onOpenChange,
}: {
  locale: string;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations('templates.create');
  const utils = trpc.useUtils();
  const create = trpc.templates.create.useMutation({
    onSuccess: (result) => {
      void utils.templates.list.invalidate();
      onOpenChange(false);
      window.location.href = `/${locale}/templates/${result.templateId}`;
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const name = String(data.get('name') ?? '').trim();
        const description = String(data.get('description') ?? '').trim();
        if (name.length === 0) return;
        create.mutate({ name, ...(description.length > 0 ? { description } : {}) });
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="tpl-name">{t('nameLabel')}</Label>
        <Input id="tpl-name" name="name" placeholder={t('namePlaceholder')} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tpl-desc">{t('descriptionLabel')}</Label>
        <Textarea id="tpl-desc" name="description" rows={3} />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={create.isPending}>
          {t('submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── With AI ───────────────────────────────────────────────────────────────

function AiMode({ locale, onOpenChange }: { locale: string; onOpenChange: (v: boolean) => void }) {
  const t = useTranslations('templates.create');
  const utils = trpc.useUtils();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [building, setBuilding] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const createFromSpec = trpc.templates.createFromSpec.useMutation({
    onSuccess: (result) => {
      void utils.templates.list.invalidate();
      onOpenChange(false);
      window.location.href = `/${locale}/templates/${result.templateId}`;
    },
    onError: () => setBuilding(false),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(
    async (textArg?: string) => {
      const text = (textArg ?? input).trim();
      if (!text || streaming || building) return;

      const history: ChatMessage[] = [
        ...messages,
        { id: `u-${Date.now()}`, role: 'user', content: text },
      ];
      setMessages(history);
      setInput('');
      setStreaming(true);

      const assistantId = `a-${Date.now()}`;
      let assistantContent = '';
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

      try {
        const res = await fetch('/api/ai/template-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        if (!res.ok || !res.body) throw new Error('stream failed');

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
            let event: StreamEvent;
            try {
              event = JSON.parse(line) as StreamEvent;
            } catch {
              continue;
            }
            if (event.type === 'text') {
              assistantContent += event.delta;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: assistantContent } : m)),
              );
            } else if (event.type === 'building_started') {
              // The model began writing the template — show the build animation
              // immediately (the tool call streams for tens of seconds).
              setBuilding(true);
            } else if (event.type === 'proposal') {
              setBuilding(true);
              createFromSpec.mutate({ spec: event.spec });
            } else if (event.type === 'error') {
              setBuilding(false);
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: `${t('aiError')}` } : m)),
              );
            }
          }
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: t('aiError') } : m)),
        );
      } finally {
        setStreaming(false);
      }
    },
    [input, streaming, building, messages, t, createFromSpec],
  );

  const suggestions = (t.raw('aiSuggestions') as string[] | undefined) ?? [];

  // While the model writes (and we then save) the template, take over the whole
  // panel with a specific, narrated progress animation — no input, no chat.
  if (building) {
    return (
      <div className="flex h-[60vh] flex-col">
        <BuildingTemplate />
      </div>
    );
  }

  return (
    <div className="flex h-[60vh] flex-col">
      <div className="flex-1 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">{t('aiEmpty')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn('flex gap-2.5', m.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                {m.role === 'assistant' && (
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Bot className="h-4 w-4" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground',
                  )}
                >
                  {m.content === '' && m.role === 'assistant' ? (
                    <span className="animate-pulse text-muted-foreground">{t('aiThinking')}</span>
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

      <div className="mt-3 border-t pt-3">
        <div className="flex items-end gap-2 rounded-2xl border bg-muted/30 px-3 py-2 focus-within:border-primary">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t('aiPlaceholder')}
            rows={1}
            disabled={streaming || building}
            className="max-h-32 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || streaming || building}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
            aria-label={t('aiSend')}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">{t('aiDisclaimer')}</p>
      </div>
    </div>
  );
}

// ─── Building animation ───────────────────────────────────────────────────────

/**
 * Narrated build progress shown while the model writes the spec and we expand +
 * save it. The steps are illustrative (we don't get real sub-progress from the
 * model), so the current step advances on a timer and parks on the last one
 * until navigation. Earlier steps tick off with a check; the active one spins.
 */
const BUILD_STEP_ICONS = [ClipboardList, LayoutList, MessageSquareText, Palette, GitBranch, Wand2];

function BuildingTemplate() {
  const t = useTranslations('templates.create');
  const steps = (t.raw('aiBuildSteps') as string[] | undefined) ?? [];
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (steps.length === 0) return;
    const id = setInterval(() => {
      // Advance but hold on the final step until the page navigates away.
      setActive((i) => (i < steps.length - 1 ? i + 1 : i));
    }, 2200);
    return () => clearInterval(id);
  }, [steps.length]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-2xl bg-primary/20" />
        <span className="absolute inset-0 rounded-2xl bg-primary/10" />
        <Sparkles className="relative h-7 w-7 animate-pulse text-primary" />
      </div>

      <div className="text-center">
        <p className="text-base font-semibold">{t('aiBuildingTitle')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('aiBuildingSubtitle')}</p>
      </div>

      <ol className="w-full max-w-xs space-y-2.5">
        {steps.map((label, i) => {
          const Icon = BUILD_STEP_ICONS[i % BUILD_STEP_ICONS.length] ?? Wand2;
          const done = i < active;
          const current = i === active;
          return (
            <li
              key={label}
              className={cn(
                'flex items-center gap-3 text-sm transition-opacity duration-300',
                current ? 'opacity-100' : done ? 'opacity-90' : 'opacity-40',
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors',
                  done
                    ? 'border-primary bg-primary text-primary-foreground'
                    : current
                      ? 'border-primary text-primary'
                      : 'border-muted text-muted-foreground',
                )}
              >
                {done ? (
                  <Check className="h-4 w-4" />
                ) : current ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </span>
              <span className={cn(current && 'font-medium')}>{label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
