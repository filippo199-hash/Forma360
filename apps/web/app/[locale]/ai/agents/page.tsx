'use client';

/**
 * /ai/agents — the full agent gallery. The same tiles the AI page's
 * landing state shows, on a page of their own so the bottom-bar tab and
 * links have a stable home for "all agents".
 */
import { useTranslations } from 'next-intl';
import { AgentTiles } from '../../../../src/components/ai/agent-tiles';

export default function AiAgentsPage() {
  const t = useTranslations('aiAgents');
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('hub.allAgents')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('hub.subheading')}</p>
      </header>
      <AgentTiles />
    </div>
  );
}
