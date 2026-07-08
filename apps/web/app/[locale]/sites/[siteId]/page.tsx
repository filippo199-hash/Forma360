'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  ClipboardCheck,
  FolderOpen,
  Image as ImageIcon,
  ListChecks,
  Map as MapIcon,
  MapPin,
  Users,
  Wrench,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { SiteLocationCard } from '../../../../src/components/sites/site-location-card';
import { SiteMediaGallery } from '../../../../src/components/sites/site-media-gallery';
import { SitePlansViewer } from '../../../../src/components/sites/site-plans-viewer';
import { Card, CardContent } from '../../../../src/components/ui/card';
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

  const tiles: Array<{
    key: string;
    label: string;
    value: number;
    icon: ReactNode;
    href: string | null;
    selectsTab?: string;
  }> = [
    {
      key: 'observations',
      label: t('countObservations'),
      value: counts.observations,
      icon: <AlertTriangle className="h-5 w-5" />,
      href: `/${locale}/observations?site=${siteId}`,
    },
    {
      key: 'inspections',
      label: t('countInspections'),
      value: counts.inspections,
      icon: <ClipboardCheck className="h-5 w-5" />,
      href: `/${locale}/inspections?site=${siteId}`,
    },
    {
      key: 'actions',
      label: t('countActions'),
      value: counts.actions,
      icon: <ListChecks className="h-5 w-5" />,
      href: `/${locale}/actions?site=${siteId}`,
    },
    {
      key: 'assets',
      label: t('countAssets'),
      value: counts.assets,
      icon: <Wrench className="h-5 w-5" />,
      href: `/${locale}/assets?site=${siteId}`,
    },
    {
      key: 'documents',
      label: t('countDocuments'),
      value: counts.documents,
      icon: <FolderOpen className="h-5 w-5" />,
      href: `/${locale}/documents?site=${siteId}`,
    },
    {
      key: 'media',
      label: t('countMedia'),
      value: counts.media,
      icon: <ImageIcon className="h-5 w-5" />,
      href: null,
      selectsTab: 'media',
    },
    {
      key: 'plans',
      label: t('countPlans'),
      value: counts.plans,
      icon: <MapIcon className="h-5 w-5" />,
      href: null,
      selectsTab: 'plans',
    },
    {
      key: 'members',
      label: t('countMembers'),
      value: counts.members,
      icon: <Users className="h-5 w-5" />,
      href: null,
    },
  ];

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

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map((tile) => {
              const interactive = tile.href !== null || tile.selectsTab !== undefined;
              const inner = (
                <Card
                  className={cn(
                    'h-full',
                    interactive
                      ? 'transition-colors hover:border-primary/50 hover:bg-muted/30'
                      : '',
                  )}
                >
                  <CardContent className="space-y-2 p-4">
                    <div className="text-muted-foreground">{tile.icon}</div>
                    <div className="text-2xl font-semibold">{tile.value}</div>
                    <div className="text-xs text-muted-foreground">{tile.label}</div>
                  </CardContent>
                </Card>
              );
              if (tile.href !== null) {
                return (
                  <Link key={tile.key} href={tile.href}>
                    {inner}
                  </Link>
                );
              }
              if (tile.selectsTab !== undefined) {
                const target = tile.selectsTab;
                return (
                  <button
                    key={tile.key}
                    type="button"
                    onClick={() => setTab(target)}
                    className="text-left"
                  >
                    {inner}
                  </button>
                );
              }
              return <div key={tile.key}>{inner}</div>;
            })}
          </div>

          <div className="mt-4">
            <SiteLocationCard
              siteId={siteId}
              latitude={site.latitude}
              longitude={site.longitude}
              locationAddress={site.locationAddress}
            />
          </div>
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
