'use client';

import { Plus, ShieldCheck, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

function ScoreBar({
  score,
  target,
  targetLabel,
}: {
  score: number;
  target: number | null;
  targetLabel: string;
}) {
  const pct = Math.min(100, Math.max(0, score));
  const aboveTarget = target !== null && score >= target;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{score.toFixed(1)}%</span>
        {target !== null ? (
          <span className="text-xs text-muted-foreground">
            {targetLabel} {target}%
          </span>
        ) : null}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${aboveTarget ? 'bg-green-500' : 'bg-amber-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
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

export default function ComplianceDashboardPage() {
  const t = useTranslations('compliance.dashboard');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManageFrameworks = useHasPermission('compliance.frameworks.manage');

  const { data, isLoading } = trpc.compliance.dashboard.overview.useQuery();

  if (isLoading || data === undefined) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManageFrameworks ? (
          <Button asChild>
            <Link href={`/${locale}/compliance/frameworks/new`}>
              <Plus className="mr-1 h-4 w-4" />
              {t('newFrameworkButton')}
            </Link>
          </Button>
        ) : null}
      </header>

      {/* Overall score cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldCheck className="h-8 w-8 text-primary shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">{t('overallScore')}</p>
              <p className="text-2xl font-bold">{data.overallScore.toFixed(1)}%</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">{t('compliant')}</p>
              <p className="text-2xl font-bold">{data.compliantCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-8 w-8 text-amber-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">{t('dueSoon')}</p>
              <p className="text-2xl font-bold">{data.dueSoonCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-8 w-8 text-destructive shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">{t('nonCompliant')}</p>
              <p className="text-2xl font-bold">{data.nonCompliantCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Framework cards */}
      {data.frameworks.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <ShieldCheck className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p>{t('noFrameworks')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.frameworks.map((fw) => (
            <Link
              key={fw.id}
              href={`/${locale}/compliance/frameworks/${fw.id}`}
              className="group block"
            >
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight">{fw.name}</CardTitle>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                      {fw.type.replace('_', ' ')}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ScoreBar score={fw.score} target={fw.targetScore} targetLabel={t('targetLabel')} />
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span className="text-green-600 dark:text-green-400">
                      {t('scoreBarCompliant', { count: fw.compliantCount })}
                    </span>
                    {fw.dueSoonCount > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {t('scoreBarDueSoon', { count: fw.dueSoonCount })}
                      </span>
                    ) : null}
                    {fw.nonCompliantCount > 0 ? (
                      <span className="text-destructive">
                        {t('scoreBarNonCompliant', { count: fw.nonCompliantCount })}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('totalRules', { count: fw.totalRules })}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Non-compliant rules */}
      {data.nonCompliantRules.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-destructive" />
              {t('nonCompliantRulesTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {data.nonCompliantRules.map((rule) => (
                <Link
                  key={rule.ruleId}
                  href={`/${locale}/compliance/frameworks/${rule.frameworkId}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{rule.ruleName}</p>
                    <p className="text-xs text-muted-foreground">
                      {rule.clauseRef.length > 0 ? `${rule.clauseRef} · ` : ''}
                      {rule.frameworkName}
                    </p>
                  </div>
                  <StatusBadge status={rule.status} />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
