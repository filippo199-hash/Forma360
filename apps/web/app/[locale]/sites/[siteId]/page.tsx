'use client';

import { ArrowLeft, Building2, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { SiteHeaderActions } from '../../../../src/components/sites/site-header-actions';
import { SiteLocationCard } from '../../../../src/components/sites/site-location-card';
import { SiteMediaGallery } from '../../../../src/components/sites/site-media-gallery';
import { SiteOverview } from '../../../../src/components/sites/site-overview';
import { SitePlansViewer } from '../../../../src/components/sites/site-plans-viewer';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../src/components/ui/tabs';
import { cn } from '../../../../src/lib/cn';
import { trpc } from '../../../../src/lib/trpc/client';

type Status = 'planning' | 'active' | 'on_hold' | 'completed';

const STATUS_COLORS: Record<Status, string> = {
  planning: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  on_hold: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
};

export default function SiteDetailPage() {
  const t = useTranslations('sites');
  const params = useParams<{ locale: string; siteId: string }>();
  const locale = params.locale ?? 'en';
  const siteId = params.siteId ?? '';

  const { data, isLoading } = trpc.sites.getHub.useQuery(
    { id: siteId },
    { enabled: siteId !== '' },
  );
  const [tab, setTab] = useState('overview');

  if (isLoading || data === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { site, counts } = data;
  const isProject = site.kind === 'project';
  const statusLabel: string | null =
    site.status === 'planning' ||
    site.status === 'active' ||
    site.status === 'on_hold' ||
    site.status === 'completed'
      ? t(`status_${site.status}` as 'status_active')
      : null;

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/sites`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          {isProject ? (
            <MapPin className="h-6 w-6 text-primary" />
          ) : (
            <Building2 className="h-6 w-6 text-muted-foreground" />
          )}
          <h1 className="text-2xl font-semibold tracking-tight">{site.name}</h1>
          <span className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {isProject ? t('kindProject') : t('kindSite')}
          </span>
          {statusLabel !== null ? (
            <span
              className={cn(
                'rounded-md px-2 py-0.5 text-xs font-medium',
                STATUS_COLORS[site.status as Status] ?? STATUS_COLORS.active,
              )}
            >
              {statusLabel}
            </span>
          ) : null}
          <SiteHeaderActions
            site={{
              id: site.id,
              name: site.name,
              kind: site.kind,
              status: site.status,
              client: site.client,
              startDate: site.startDate,
              endDate: site.endDate,
            }}
            counts={counts}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
          {site.client !== null && site.client !== '' ? (
            <span>
              {t('detailClient')}: {site.client}
            </span>
          ) : null}
          {isProject && (site.startDate !== null || site.endDate !== null) ? (
            <span>
              {t('detailTimeline')}: {site.startDate ?? '—'} → {site.endDate ?? '—'}
            </span>
          ) : null}
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">{t('tabOverview')}</TabsTrigger>
          <TabsTrigger value="media">{t('tabMedia')}</TabsTrigger>
          <TabsTrigger value="plans">{t('tabPlans')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <SiteOverview
            siteId={siteId}
            locale={locale}
            counts={{ members: counts.members }}
            onOpenTab={setTab}
          />
          <SiteLocationCard
            siteId={siteId}
            latitude={site.latitude}
            longitude={site.longitude}
            locationAddress={site.locationAddress}
          />
        </TabsContent>

        <TabsContent value="media" className="mt-4">
          <SiteMediaGallery siteId={siteId} />
        </TabsContent>

        <TabsContent value="plans" className="mt-4">
          <SitePlansViewer siteId={siteId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
