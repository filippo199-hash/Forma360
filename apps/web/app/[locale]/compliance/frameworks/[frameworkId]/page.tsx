'use client';

import { ArrowLeft, Plus, Archive, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../../src/lib/permissions-context';
import { trpc } from '../../../../../src/lib/trpc/client';

function StatusBadge({ status, neverEvaluatedLabel }: { status: string | null; neverEvaluatedLabel: string }) {
  if (status === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        {neverEvaluatedLabel}
      </span>
    );
  }
  const colours: Record<string, string> = {
    compliant: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    due_soon: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    non_compliant: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    not_evaluable: 'bg-muted text-muted-foreground',
  };
  const labels: Record<string, string> = {
    compliant: 'Compliant',
    due_soon: 'Due soon',
    non_compliant: 'Non-compliant',
    not_evaluable: 'Not evaluable',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colours[status] ?? colours['not_evaluable']}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  once: 'Once',
};

export default function FrameworkDetailPage() {
  const t = useTranslations('compliance.frameworks.detail');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; frameworkId: string }>();
  const locale = params.locale ?? 'en';
  const frameworkId = params.frameworkId ?? '';
  const utils = trpc.useUtils();

  const canManage = useHasPermission('compliance.manage');
  const canManageFrameworks = useHasPermission('compliance.frameworks.manage');

  const { data: fw, isLoading: fwLoading } = trpc.compliance.frameworks.get.useQuery({
    frameworkId,
  });
  const { data: rulesData, isLoading: rulesLoading } = trpc.compliance.rules.list.useQuery({
    frameworkId,
  });
  const rules = rulesData ?? [];

  const archive = trpc.compliance.frameworks.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archivedToast'));
      void utils.compliance.frameworks.get.invalidate({ frameworkId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const evaluateRule = trpc.compliance.rules.evaluate.useMutation({
    onSuccess: () => {
      toast.success(t('evaluateEnqueued'));
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  if (fwLoading || fw === undefined) {
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const isArchived = fw.archivedAt !== null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/${locale}/compliance`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
        {canManageFrameworks && !isArchived ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => archive.mutate({ frameworkId })}
            disabled={archive.isPending}
          >
            <Archive className="mr-1 h-4 w-4" />
            {tCommon('archive')}
          </Button>
        ) : null}
      </div>

      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{fw.name}</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
            {fw.type.replace('_', ' ')}
          </span>
          {isArchived ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t('archived')}
            </span>
          ) : null}
        </div>
        {fw.description.length > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{fw.description}</p>
        ) : null}

        {/* Scope + jurisdiction metadata row */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* Scope */}
          {Array.isArray(fw.applicableSites) && (fw.applicableSites as string[]).length > 0 ? (
            <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
              {t('scopeSites', { count: (fw.applicableSites as string[]).length })}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
              {t('scopeCompanyWide')}
            </span>
          )}
          {/* Jurisdiction */}
          {fw.jurisdiction !== null && fw.jurisdiction.length > 0 ? (
            <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
              {t('jurisdictionLabel')}: {fw.jurisdiction}
            </span>
          ) : null}
          {/* Target score */}
          {fw.targetScore !== null ? (
            <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
              {t('targetScore')}: {fw.targetScore}%
            </span>
          ) : null}
        </div>
      </div>

      {/* Rules table */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{t('rulesTitle')}</h2>
          {canManage && !isArchived ? (
            <Button asChild size="sm">
              <Link href={`/${locale}/compliance/frameworks/${frameworkId}/rules/new`}>
                <Plus className="mr-1 h-4 w-4" />
                {t('addRuleButton')}
              </Link>
            </Button>
          ) : null}
        </div>

        {rulesLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rules.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {t('noRules')}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">{t('table.name')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.clauseRef')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.frequency')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.status')}</th>
                      {canManage ? (
                        <th className="px-4 py-3 text-right font-medium">{t('table.actions')}</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rules.map((rule) => (
                      <tr key={rule.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium">{rule.name}</p>
                          {rule.description.length > 0 ? (
                            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                              {rule.description}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {rule.clauseRef.length > 0 ? rule.clauseRef : '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {FREQUENCY_LABELS[rule.frequency] ?? rule.frequency}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={rule.latestEvalStatus} neverEvaluatedLabel={t('neverEvaluated')} />
                          {rule.latestEvaluatedAt !== null ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {new Date(rule.latestEvaluatedAt).toLocaleDateString()}
                            </p>
                          ) : null}
                        </td>
                        {canManage ? (
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => evaluateRule.mutate({ ruleId: rule.id })}
                              disabled={evaluateRule.isPending || isArchived}
                              title={t('evaluateRuleButton')}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
