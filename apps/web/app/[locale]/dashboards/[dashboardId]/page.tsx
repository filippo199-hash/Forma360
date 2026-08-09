'use client';

/**
 * The dashboard itself (ADR 0018): filter bar on top (always), widget
 * grid, refine chat in a side panel, status/visibility/schedule controls
 * for those who hold them. Collapses the nav on entry — the dashboard is
 * a full-width surface.
 */
import type { DashboardSpec } from '@forma360/shared/dashboard-spec';
import {
  Archive,
  ArchiveRestore,
  Download,
  MessageSquareText,
  Send,
  Share2,
  CalendarClock,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  BuilderChat,
  type BuilderProposal,
} from '../../../../src/components/dashboards/builder-chat';
import { FilterBar, type DashboardFilters } from '../../../../src/components/dashboards/filter-bar';
import { ScheduleDialog } from '../../../../src/components/dashboards/schedule-dialog';
import { ShareDialog } from '../../../../src/components/dashboards/share-dialog';
import {
  UpgradePanel,
  isEntitlementError,
} from '../../../../src/components/dashboards/upgrade-panel';
import {
  WidgetCard,
  type WidgetDataShape,
} from '../../../../src/components/dashboards/widget-card';
import { Button } from '../../../../src/components/ui/button';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { cn } from '../../../../src/lib/cn';
import { trpc } from '../../../../src/lib/trpc/client';

function exportQueryFor(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  if (typeof filters.dateRange === 'string') {
    params.set('range', filters.dateRange);
  } else {
    params.set('from', filters.dateRange.from);
    params.set('to', filters.dateRange.to);
  }
  if (filters.siteIds.length > 0) params.set('sites', filters.siteIds.join(','));
  return params.toString();
}

export default function DashboardPage() {
  const t = useTranslations('dashboards');
  const params = useParams<{ locale: string; dashboardId: string }>();
  const locale = params.locale ?? 'en';
  const dashboardId = params.dashboardId ?? '';

  // The dashboard wants the room — collapse the nav rail on entry. The
  // user can re-expand; we never force it twice in one visit.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('forma360:nav-collapse'));
  }, []);

  const utils = trpc.useUtils();
  const query = trpc.dashboards.get.useQuery({ id: dashboardId }, { retry: false });
  const dashboard = query.data;

  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const effectiveFilters: DashboardFilters | null = useMemo(() => {
    if (filters !== null) return filters;
    if (dashboard?.spec != null) {
      return {
        dateRange: dashboard.spec.filterDefaults.dateRange,
        siteIds: dashboard.spec.filterDefaults.siteIds,
      };
    }
    return null;
  }, [filters, dashboard?.spec]);

  const data = trpc.dashboards.data.useQuery(
    {
      id: dashboardId,
      ...(effectiveFilters !== null
        ? {
            filters: {
              dateRange: effectiveFilters.dateRange,
              siteIds: [...effectiveFilters.siteIds],
            },
          }
        : {}),
    },
    { enabled: dashboard?.spec != null, retry: false },
  );

  const [chatOpen, setChatOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const updateSpec = trpc.dashboards.updateSpec.useMutation();
  const updateMeta = trpc.dashboards.update.useMutation();
  const setStatus = trpc.dashboards.setStatus.useMutation();
  const archive = trpc.dashboards.archive.useMutation();
  const restore = trpc.dashboards.restore.useMutation();

  const refresh = async () => {
    await Promise.all([
      utils.dashboards.get.invalidate({ id: dashboardId }),
      utils.dashboards.data.invalidate(),
      utils.dashboards.list.invalidate(),
    ]);
  };

  const onProposal = async (proposal: BuilderProposal) => {
    if (dashboard === undefined) return;
    await updateSpec.mutateAsync({
      id: dashboardId,
      spec: proposal.spec,
      expectedUpdatedAt: dashboard.updatedAt,
    });
    if (proposal.title !== dashboard.title && proposal.title.length > 0) {
      await updateMeta.mutateAsync({ id: dashboardId, title: proposal.title });
    }
    await refresh();
    toast.success(t('detail.updated'));
  };

  if (query.error) {
    if (isEntitlementError(query.error)) return <UpgradePanel />;
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-muted-foreground">
        {t('detail.notFound')}
      </div>
    );
  }

  if (dashboard === undefined || effectiveFilters === null) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6">
        <Skeleton className="mb-4 h-8 w-72" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (dashboard.spec === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-destructive">{t('detail.specInvalid')}</p>
        <ul className="mt-2 text-left text-xs text-muted-foreground">
          {dashboard.specErrors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }

  const spec: DashboardSpec = dashboard.spec;
  const exportQuery = exportQueryFor(effectiveFilters);

  return (
    <div className="flex h-full">
      <div className={cn('min-w-0 flex-1 px-4 py-5', chatOpen && 'lg:mr-[24rem]')}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold">{dashboard.title}</h1>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs',
                  dashboard.status === 'published' &&
                    'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400',
                  dashboard.status === 'archived' && 'text-muted-foreground',
                )}
              >
                {t(`status.${dashboard.status}`)}
              </span>
              <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {t(`visibility.${dashboard.visibility}`)}
              </span>
            </div>
            {dashboard.description ? (
              <p className="mt-1 text-sm text-muted-foreground">{dashboard.description}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {dashboard.canEdit ? (
              <>
                {dashboard.status === 'draft' ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      void setStatus
                        .mutateAsync({ id: dashboardId, status: 'published' })
                        .then(refresh)
                        .then(() => toast.success(t('detail.published')))
                    }
                  >
                    <Send className="mr-1.5 h-4 w-4" aria-hidden />
                    {t('detail.publish')}
                  </Button>
                ) : dashboard.status === 'published' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void setStatus.mutateAsync({ id: dashboardId, status: 'draft' }).then(refresh)
                    }
                  >
                    {t('detail.unpublish')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void restore.mutateAsync({ id: dashboardId }).then(refresh)}
                  >
                    <ArchiveRestore className="mr-1.5 h-4 w-4" aria-hidden />
                    {t('detail.restore')}
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`/api/exports/dashboard-pdf?dashboardId=${dashboardId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download className="mr-1.5 h-4 w-4" aria-hidden />
                    {t('detail.downloadPdf')}
                  </a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
                  <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
                  {t('detail.share')}
                </Button>
                {dashboard.canSchedule ? (
                  <Button size="sm" variant="outline" onClick={() => setScheduleOpen(true)}>
                    <CalendarClock className="mr-1.5 h-4 w-4" aria-hidden />
                    {t('detail.schedule')}
                  </Button>
                ) : null}
                {dashboard.status !== 'archived' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(t('detail.archiveConfirm'))) {
                        void archive.mutateAsync({ id: dashboardId }).then(refresh);
                      }
                    }}
                    aria-label={t('detail.archive')}
                  >
                    <Archive className="h-4 w-4" aria-hidden />
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant={chatOpen ? 'default' : 'outline'}
                  onClick={() => setChatOpen((v) => !v)}
                >
                  <MessageSquareText className="mr-1.5 h-4 w-4" aria-hidden />
                  {t('detail.refine')}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className="mb-5">
          <FilterBar value={effectiveFilters} onChange={setFilters} />
        </div>

        {data.isError ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            <span className="text-destructive">{t('detail.dataError')}</span>
            <Button size="sm" variant="outline" onClick={() => void data.refetch()}>
              {t('detail.retry')}
            </Button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {spec.widgets.map((widget) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              // A failed data query must show each widget's failed state, not
              // an eternal skeleton (which `undefined` would render).
              data={
                data.isError
                  ? { error: 'failed' }
                  : (data.data?.widgets[widget.id] as WidgetDataShape | undefined)
              }
              locale={locale}
              exportQuery={exportQuery}
              dashboardId={dashboardId}
            />
          ))}
        </div>
      </div>

      {chatOpen && dashboard.canEdit ? (
        <aside className="fixed inset-y-0 right-0 z-30 mt-14 hidden w-[24rem] border-l bg-background lg:block">
          <div className="flex h-full flex-col">
            <div className="border-b px-3 py-2">
              <p className="text-sm font-medium">{t('chat.refineTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('chat.refineHint')}</p>
            </div>
            <BuilderChat
              currentSpec={spec}
              currentTitle={dashboard.title}
              onProposal={onProposal}
              className="min-h-0 flex-1"
            />
          </div>
        </aside>
      ) : null}

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        dashboardId={dashboardId}
        visibility={dashboard.visibility}
        shares={dashboard.shares}
        onSaved={refresh}
      />
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        dashboardId={dashboardId}
      />
    </div>
  );
}
