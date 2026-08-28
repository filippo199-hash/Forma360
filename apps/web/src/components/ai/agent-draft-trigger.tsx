'use client';

/**
 * The module entry point for a task agent: one consistent "Draft with AI"
 * button plus the shared panel. Mounts beside a module's primary action.
 *
 * Visibility follows the agent's gates (brand is implied — the module
 * page itself is brand-gated; permission is the caller's page too), but
 * the per-tenant OFF switch renders the button disabled with "turned off
 * by your administrator" rather than vanishing it — an invisible admin
 * toggle generates support calls (the HSE walkthrough's finding).
 */
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AiAgentId } from '@forma360/shared/ai-agents';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { trpc } from '../../lib/trpc/client';
import { AgentDraftPanel, type AgentDraftPanelProps } from './agent-draft-panel';

export interface AgentDraftTriggerProps {
  agentId: AiAgentId;
  params?: Record<string, string>;
  proposalSummary: AgentDraftPanelProps['proposalSummary'];
  applyProposal: AgentDraftPanelProps['applyProposal'];
  /** Render a compact outline button (default) or a plain menu-ish one. */
  variant?: 'outline' | 'default';
}

export function AgentDraftTrigger(props: AgentDraftTriggerProps) {
  const t = useTranslations('aiAgents');
  const [open, setOpen] = useState(false);
  const { data } = trpc.aiAgents.list.useQuery();
  const agent = data?.find((a) => a.id === props.agentId);
  if (agent === undefined) return null;

  const button = (
    <Button
      variant={props.variant ?? 'outline'}
      disabled={!agent.enabled}
      onClick={() => setOpen(true)}
    >
      <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {t('panel.title')}
    </Button>
  );

  return (
    <>
      {agent.enabled ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{button}</span>
          </TooltipTrigger>
          <TooltipContent>{t('panel.disabled')}</TooltipContent>
        </Tooltip>
      )}
      <AgentDraftPanel
        agentId={props.agentId}
        open={open}
        onOpenChange={setOpen}
        {...(props.params === undefined ? {} : { params: props.params })}
        proposalSummary={props.proposalSummary}
        applyProposal={props.applyProposal}
      />
    </>
  );
}
