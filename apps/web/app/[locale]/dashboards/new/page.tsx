'use client';

/**
 * Dashboard creation (ADR 0018): describe what you need — typed or
 * spoken — and the AI proposes a first draft, which is saved as a
 * private draft and opened for refinement.
 */
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useCallback } from 'react';
import {
  BuilderChat,
  type BuilderProposal,
} from '../../../../src/components/dashboards/builder-chat';
import {
  UpgradePanel,
  isEntitlementError,
} from '../../../../src/components/dashboards/upgrade-panel';
import { trpc } from '../../../../src/lib/trpc/client';

export default function NewDashboardPage() {
  const t = useTranslations('dashboards');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const create = trpc.dashboards.create.useMutation();

  const onProposal = useCallback(
    async (proposal: BuilderProposal) => {
      const created = await create.mutateAsync({
        title: proposal.title,
        ...(proposal.description !== null ? { description: proposal.description } : {}),
        spec: proposal.spec,
      });
      router.push(`/${locale}/dashboards/${created.id}`);
    },
    [create, router, locale],
  );

  if (create.error && isEntitlementError(create.error)) {
    return <UpgradePanel />;
  }

  return (
    <div className="min-h-screen w-full bg-[#ebefff] dark:bg-slate-900/40">
      <div className="mx-auto flex h-[calc(100vh-8rem)] w-full max-w-3xl flex-col px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">{t('new.title')}</h1>
        </div>
        <div className="min-h-0 flex-1 rounded-lg border bg-card">
          <BuilderChat
            onProposal={onProposal}
            suggestions={[
              t('new.suggestionPermits'),
              t('new.suggestionSite'),
              t('new.suggestionActions'),
            ]}
          />
        </div>
      </div>
    </div>
  );
}
