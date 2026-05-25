'use client';

import type { PriorityDueDateDays } from '@forma360/shared/actions-schema';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

const DEFAULT_DAYS: PriorityDueDateDays = { low: 30, medium: 7, high: 1, critical: 1 };

export default function ActionSettingsPage() {
  const t = useTranslations('actionsSettings');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canSettings = useHasPermission('actions.settings');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/${locale}/actions`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            {tCommon('back')}
          </Link>
        </Button>
      </div>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <PriorityDueDatesSection canSettings={canSettings} t={t} tCommon={tCommon} />
    </div>
  );
}

function PriorityDueDatesSection({
  canSettings,
  t,
  tCommon,
}: {
  canSettings: boolean;
  t: ReturnType<typeof useTranslations<'actionsSettings'>>;
  tCommon: ReturnType<typeof useTranslations<'common'>>;
}) {
  const tPriority = useTranslations('actions.priority');
  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.actionTypes.settings.get.useQuery();
  const update = trpc.actionTypes.settings.update.useMutation({
    onSuccess: () => {
      toast.success(t('dueDatesSavedToast'));
      void utils.actionTypes.settings.get.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const [draft, setDraft] = useState<PriorityDueDateDays | null>(null);
  const current = settings?.priorityDueDateDays ?? DEFAULT_DAYS;
  const editing = draft !== null;
  const view = editing && draft !== null ? draft : current;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('dueDatesHeading')}</h2>
        <p className="text-sm text-muted-foreground">{t('dueDatesSubtitle')}</p>
      </div>
      <Card>
        <CardContent className="space-y-3 p-6">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {(['low', 'medium', 'high', 'critical'] as const).map((p) => (
                  <div key={p} className="flex items-center justify-between gap-3">
                    <Label htmlFor={`due-${p}`} className="capitalize">{tPriority(p)}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`due-${p}`}
                        type="number"
                        min={0}
                        max={365}
                        value={view[p] ?? ''}
                        onChange={(e) => {
                          const next = e.target.value === '' ? null : Number(e.target.value);
                          setDraft({ ...(draft ?? current), [p]: next });
                        }}
                        disabled={!canSettings}
                        className="w-20 text-right"
                      />
                      <span className="text-xs text-muted-foreground">{t('daysSuffix')}</span>
                    </div>
                  </div>
                ))}
              </div>
              {canSettings ? (
                <div className="flex justify-end gap-2">
                  {editing ? (
                    <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={update.isPending}>
                      {tCommon('cancel')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    disabled={!editing || update.isPending}
                    onClick={() => {
                      if (draft === null) return;
                      update.mutate({ priorityDueDateDays: draft }, { onSuccess: () => setDraft(null) });
                    }}
                  >
                    {t('saveDueDates')}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
