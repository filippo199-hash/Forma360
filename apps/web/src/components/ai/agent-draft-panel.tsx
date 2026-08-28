'use client';

/**
 * The shared Draft-with-AI panel (AI Agents feature).
 *
 * One Sheet used by every module entry point: a short brief box, the
 * streamed conversation, progress phases (the template-agent "no silent
 * phase" rule made visible), and — when the agent proposes — a summary
 * card with ONE Apply button. Review deliberately happens in the
 * module's own editor after Apply, not here: the panel's job is
 * brief → draft → apply, and the editor the user already knows is where
 * a draft gets scrutinised.
 *
 * Apply is one-shot behind `useSubmitGuard` (the SWPD-03 lesson: three
 * taps on an unguarded button once made three records in a statutory
 * register): after a success the Apply affordance is REPLACED by the
 * caller's follow-up (usually navigation), for the life of the proposal.
 *
 * The caller supplies `applyProposal` — the module-specific mapping of a
 * validated proposal onto the module's ordinary tRPC mutations, running
 * as the signed-in user with every server check intact.
 */
import { Bot, Loader2, Send, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { appConfirm } from '../ui/app-confirm';
import { useSubmitGuard } from '../../lib/use-submit-guard';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet';

type PanelEvent =
  | { type: 'text'; delta: string }
  | { type: 'assistant_done'; text: string }
  | { type: 'progress'; phase: 'thinking' | 'writing' }
  | { type: 'building_started' }
  | { type: 'proposal'; proposal: unknown; note: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentDraftPanelProps {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Module anchors forwarded to the server context builder. */
  params?: Record<string, string>;
  /**
   * Per-agent Apply wording where the generic "Create draft" would
   * mislead — the Permit Preparer fills a form and creates nothing
   * (AGS-10), so its mount passes "Fill in the form".
   */
  applyLabel?: string;
  /**
   * A page-supplied caution shown under the intro — e.g. the COSHH
   * mount warns when the substance has no SDS on file, so the agent's
   * stated grounding input is visibly absent (AGS-12).
   */
  contextNote?: string;
  /**
   * Reads the plain-language summary out of a validated proposal — every
   * agent's propose schema carries one so non-technical users see words,
   * not structure.
   */
  proposalSummary: (proposal: unknown) => string;
  /**
   * Apply the proposal via the module's own mutations. Resolves to the
   * follow-up the panel renders in place of Apply (usually a navigate
   * label + handler). Throwing keeps Apply available for a retry.
   */
  applyProposal: (proposal: unknown) => Promise<{ followUpLabel: string; onFollowUp: () => void }>;
}

export function AgentDraftPanel(props: AgentDraftPanelProps) {
  const t = useTranslations('aiAgents');
  const guard = useSubmitGuard();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [phase, setPhase] = useState<'thinking' | 'writing' | null>(null);
  const [proposal, setProposal] = useState<unknown>(null);
  const [applying, setApplying] = useState(false);
  const [followUp, setFollowUp] = useState<{ label: string; run: () => void } | null>(null);
  // A failed turn must leave a PERSISTENT trace (AGS-01): the transient
  // toast alone left the panel indistinguishable from one still working.
  const [failedRow, setFailedRow] = useState(false);
  // The refine placeholder ("Ask for changes…") must not appear until a
  // draft has actually existed — after a failure it implied one did.
  const [hadProposal, setHadProposal] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * A turn failed before producing anything usable: keep the user's
   * words (restore them into the input), drop the empty assistant
   * bubble, and leave a persistent error row in the conversation so
   * the failure stays visible after the toast fades (AGS-01).
   */
  function markFailed(history: ChatMessage[], sentText: string) {
    setMessages(history);
    setFailedRow(true);
    setInput((current) => (current.trim().length === 0 ? sentText : current));
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0 || streaming) return;
    const history = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);
    setPhase(null);
    setProposal(null);
    setFollowUp(null);
    setFailedRow(false);

    const ac = new AbortController();
    abortRef.current = ac;
    let assistantText = '';
    let turnFailed = false;
    let gotProposal = false;
    try {
      const res = await fetch('/api/ai/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: props.agentId,
          params: props.params ?? {},
          messages: history,
        }),
        signal: ac.signal,
      });
      if (res.status === 403) {
        // Read the body: only the tenant OFF switch gets the "switched
        // off for your company" wording — a revoked permission is a
        // different fact and must not blame the admin's switch.
        let code = '';
        try {
          code = ((await res.json()) as { error?: string }).error ?? '';
        } catch {
          code = '';
        }
        if (code === 'agent-disabled') toast.error(t('panel.disabled'));
        markFailed(history, trimmed);
        return;
      }
      if (!res.ok || res.body === null) {
        markFailed(history, trimmed);
        return;
      }
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
          if (!part.startsWith('data: ')) continue;
          let event: PanelEvent;
          try {
            event = JSON.parse(part.slice(6)) as PanelEvent;
          } catch {
            continue;
          }
          if (event.type === 'text') {
            assistantText += event.delta;
            const snapshot = assistantText;
            setMessages((prev) =>
              prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: snapshot } : m)),
            );
          } else if (event.type === 'progress') {
            setPhase(event.phase);
          } else if (event.type === 'building_started') {
            setPhase('writing');
          } else if (event.type === 'proposal') {
            setProposal(event.proposal);
            setHadProposal(true);
            gotProposal = true;
            setPhase(null);
          } else if (event.type === 'error') {
            turnFailed = true;
          }
        }
      }
      if (turnFailed && !gotProposal && assistantText.trim().length === 0) {
        // Nothing survived the turn — persistent error row, words kept.
        markFailed(history, trimmed);
      } else if (turnFailed) {
        // The agent said something before dying; keep it and note the cut.
        setFailedRow(true);
      }
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        if (assistantText.trim().length === 0) markFailed(history, trimmed);
        else setFailedRow(true);
      }
    } finally {
      setStreaming(false);
      setPhase(null);
    }
  }

  async function apply() {
    if (proposal === null || applying || followUp !== null) return;
    setApplying(true);
    try {
      const result = await props.applyProposal(proposal);
      setFollowUp({ label: result.followUpLabel, run: result.onFollowUp });
      toast.success(t('panel.appliedToast'));
    } catch (err) {
      // The sanctioned way for applyProposal to signal "the user declined
      // a confirm" — nothing happened, so no failure toast; Apply stays
      // available. Comparing the key, not rendering the message.
      if ((err as { message?: string }).message !== 'apply-cancelled') {
        toast.error(t('panel.applyFailedToast'));
      }
    } finally {
      setApplying(false);
    }
  }

  function reset() {
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
    setProposal(null);
    setFollowUp(null);
    setPhase(null);
    setStreaming(false);
    setFailedRow(false);
    setHadProposal(false);
    guard.release();
  }

  /**
   * Closing discards the conversation and the typed brief (the panel
   * resets on close by design) — so a close with unsaved words asks
   * first (AGS-05). A stray Escape or backdrop tap on a phone was
   * silently destroying dictated briefs. Applied conversations close
   * freely: their content is safe in the module.
   */
  function requestClose() {
    // Typed input is unsaved whatever else is true (a post-apply refine
    // brief lives only here); an in-flight apply is NOT yet "safe in
    // the module", so it counts too. Only an applied conversation with
    // an empty box closes freely.
    const hasUnsavedWords =
      input.trim().length > 0 || applying || (followUp === null && messages.length > 0);
    if (!hasUnsavedWords) {
      reset();
      props.onOpenChange(false);
      return;
    }
    void appConfirm({ description: t('panel.closeConfirm'), destructive: true }).then((ok) => {
      if (!ok) return;
      reset();
      props.onOpenChange(false);
    });
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          requestClose();
          return;
        }
        props.onOpenChange(open);
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3">
          {/* The panel names ITS agent (AGS-09): ten agents shared one
              anonymous title, and users could not tell which one they
              were briefing or where the draft would land. */}
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {t(`agents.${props.agentId}.name` as never)}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t('panel.intro')}</p>
              {/* The agent's own scope line fills the empty body — it
                  carries the "what it does and what stays human"
                  sentence users trusted on the settings page. */}
              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {t(`agents.${props.agentId}.description` as never)}
              </p>
              {props.contextNote !== undefined ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {props.contextNote}
                </p>
              ) : null}
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'user'
                    ? 'ml-8 rounded-lg bg-primary/10 px-3 py-2 text-sm'
                    : 'mr-4 whitespace-pre-wrap text-sm'
                }
              >
                {m.content.length > 0 ? (
                  m.content
                ) : streaming && i === messages.length - 1 ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    {phase === 'writing' ? t('panel.writing') : t('panel.thinking')}
                  </span>
                ) : null}
              </div>
            ))
          )}

          {failedRow ? (
            <div className="mr-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {t('panel.failedRow')}
            </div>
          ) : null}

          {proposal !== null ? (
            <div className="rounded-lg border bg-card p-3 shadow-sm">
              <p className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
                {t('panel.summaryTitle')}
              </p>
              <p className="mb-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {props.proposalSummary(proposal)}
              </p>
              {followUp !== null ? (
                <Button
                  size="sm"
                  onClick={() => {
                    // Run the follow-up, then close: when it navigates the
                    // sheet must not linger over the new page, and when the
                    // editor IS this page (the RAMS builder) the applied
                    // content sits behind the sheet — closing reveals it.
                    followUp.run();
                    reset();
                    props.onOpenChange(false);
                  }}
                >
                  {followUp.label}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={applying}
                    onClick={() => {
                      void guard.runAsync(apply);
                    }}
                  >
                    {applying ? t('panel.applying') : (props.applyLabel ?? t('panel.apply'))}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={applying} onClick={reset}>
                    {t('panel.discard')}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="border-t px-4 py-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={2}
              placeholder={
                // "Ask for changes…" only once a draft has actually
                // existed — after a FAILED first turn it implied a draft
                // was somewhere the user could not see (AGS-01).
                hadProposal ? t('panel.refinePlaceholder') : t('panel.placeholder')
              }
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
              disabled={streaming}
            />
            <Button
              type="submit"
              size="icon"
              aria-label={t('panel.send')}
              disabled={streaming || input.trim().length === 0}
            >
              {streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
