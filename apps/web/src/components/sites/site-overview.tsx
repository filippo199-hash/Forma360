'use client';

import {
  AlertTriangle,
  ChevronRight,
  ClipboardCheck,
  FolderOpen,
  Image as ImageIcon,
  ListChecks,
  Map as MapIcon,
  Users,
  Wrench,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { trpc } from '../../lib/trpc/client';
import { Card, CardContent } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

interface SiteOverviewProps {
  siteId: string;
  locale: string;
  counts: { members: number };
  onOpenTab: (tab: string) => void;
}

interface PreviewItem {
  id: string;
  title: string;
  meta?: string;
  href?: string;
  dot?: string;
}

/** Map a free-form status string to a small status-dot colour. */
function statusDot(status: string): string {
  const s = status.toLowerCase();
  if (
    s.includes('complete') ||
    s.includes('resolved') ||
    s.includes('closed') ||
    s.includes('approved')
  )
    return 'bg-emerald-500';
  if (
    s.includes('progress') ||
    s.includes('investigation') ||
    s.includes('await') ||
    s.includes('planning')
  )
    return 'bg-amber-500';
  if (s.includes('cancel') || s.includes('reject')) return 'bg-slate-400';
  if (s.includes('open') || s.includes('active')) return 'bg-blue-500';
  return 'bg-slate-400';
}

const MAX = 4;

function fileUrl(storageKey: string): string {
  return `/api/files?key=${encodeURIComponent(storageKey)}`;
}

export function SiteOverview({ siteId, locale, counts, onOpenTab }: SiteOverviewProps) {
  const t = useTranslations('sites');

  const obs = trpc.issues.issues.list.useQuery({ siteId });
  const insp = trpc.inspections.list.useQuery({ siteId });
  const acts = trpc.actions.list.useQuery({ siteId });
  const assets = trpc.assets.list.useQuery({ siteId });
  const docs = trpc.documents.list.useQuery({ siteId });
  const media = trpc.siteMedia.list.useQuery({ siteId });
  const plans = trpc.sitePlans.listPlans.useQuery({ siteId });

  const obsItems: PreviewItem[] = (obs.data?.items ?? []).map((o) => ({
    id: o.id,
    title: o.title,
    meta: o.referenceNumber,
    href: `/${locale}/observations?observation=${o.id}`,
    dot: statusDot(o.status),
  }));
  const inspItems: PreviewItem[] = (insp.data ?? []).map((i) => ({
    id: i.id,
    title: i.title ?? t('countInspections'),
    href: `/${locale}/inspections/${i.id}`,
    dot: statusDot(i.status),
    ...(i.documentNumber != null ? { meta: String(i.documentNumber) } : {}),
  }));
  const actItems: PreviewItem[] = (acts.data ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    href: `/${locale}/actions?action=${a.id}`,
    dot: statusDot(a.status),
  }));
  const assetItems: PreviewItem[] = (assets.data ?? []).map((a) => ({
    id: a.id,
    title: a.name,
    href: `/${locale}/assets/${a.id}`,
  }));
  const docItems: PreviewItem[] = (docs.data ?? []).map((d) => ({
    id: d.id,
    title: d.name,
    href: `/${locale}/documents/${d.id}`,
  }));

  function ListCard({
    icon,
    label,
    items,
    total,
    viewAllHref,
    onViewAll,
    loading,
  }: {
    icon: ReactNode;
    label: string;
    items: PreviewItem[];
    total: number;
    viewAllHref?: string;
    onViewAll?: () => void;
    loading: boolean;
  }) {
    const header = (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-sm font-semibold">{label}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {total}
          </span>
        </div>
        {total > 0 ? (
          <span className="inline-flex items-center text-xs text-primary">
            {t('overviewViewAll')}
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
    );

    return (
      <Card className="h-full">
        <CardContent className="space-y-3 p-4">
          {viewAllHref !== undefined && total > 0 ? (
            <Link href={viewAllHref}>{header}</Link>
          ) : onViewAll !== undefined && total > 0 ? (
            <button type="button" onClick={onViewAll} className="block w-full text-left">
              {header}
            </button>
          ) : (
            header
          )}

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : total === 0 ? (
            <p className="text-sm text-muted-foreground">{t('overviewNothing')}</p>
          ) : (
            <ul className="space-y-1.5">
              {items.slice(0, MAX).map((it) => {
                const row = (
                  <div className="flex items-center gap-2">
                    {it.dot !== undefined ? (
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', it.dot)} />
                    ) : null}
                    <span className="flex-1 truncate text-sm">{it.title}</span>
                    {it.meta !== undefined ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{it.meta}</span>
                    ) : null}
                  </div>
                );
                return (
                  <li key={it.id}>
                    {it.href !== undefined ? (
                      <Link href={it.href} className="block rounded px-1 py-0.5 hover:bg-muted/50">
                        {row}
                      </Link>
                    ) : (
                      <div className="px-1 py-0.5">{row}</div>
                    )}
                  </li>
                );
              })}
              {total > MAX ? (
                <li className="px-1 pt-0.5 text-xs text-muted-foreground">
                  {t('overviewMore', { count: total - MAX })}
                </li>
              ) : null}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  const mediaRows = media.data ?? [];
  const planRows = plans.data ?? [];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ListCard
        icon={<AlertTriangle className="h-4 w-4" />}
        label={t('countObservations')}
        items={obsItems}
        total={obsItems.length}
        viewAllHref={`/${locale}/observations?site=${siteId}`}
        loading={obs.isLoading}
      />
      <ListCard
        icon={<ListChecks className="h-4 w-4" />}
        label={t('countActions')}
        items={actItems}
        total={actItems.length}
        viewAllHref={`/${locale}/actions?site=${siteId}`}
        loading={acts.isLoading}
      />
      <ListCard
        icon={<ClipboardCheck className="h-4 w-4" />}
        label={t('countInspections')}
        items={inspItems}
        total={inspItems.length}
        viewAllHref={`/${locale}/inspections?site=${siteId}`}
        loading={insp.isLoading}
      />
      <ListCard
        icon={<Wrench className="h-4 w-4" />}
        label={t('countAssets')}
        items={assetItems}
        total={assetItems.length}
        viewAllHref={`/${locale}/assets?site=${siteId}`}
        loading={assets.isLoading}
      />

      {/* Media — thumbnail strip */}
      <Card className="h-full">
        <CardContent className="space-y-3 p-4">
          <button
            type="button"
            onClick={() => onOpenTab('media')}
            className="flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                <ImageIcon className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold">{t('countMedia')}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {mediaRows.length}
              </span>
            </div>
            {mediaRows.length > 0 ? (
              <span className="inline-flex items-center text-xs text-primary">
                {t('overviewViewAll')}
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </button>
          {media.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : mediaRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('overviewNothing')}</p>
          ) : (
            <div className="flex gap-2 overflow-hidden">
              {mediaRows.slice(0, 5).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onOpenTab('media')}
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted"
                >
                  {m.kind === 'video' ? (
                    <video
                      src={fileUrl(m.storageKey)}
                      className="h-full w-full object-cover"
                      muted
                    />
                  ) : (
                    <img
                      src={fileUrl(m.storageKey)}
                      alt={m.caption.length > 0 ? m.caption : m.filename}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plans — level chips */}
      <Card className="h-full">
        <CardContent className="space-y-3 p-4">
          <button
            type="button"
            onClick={() => onOpenTab('plans')}
            className="flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                <MapIcon className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold">{t('countPlans')}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {planRows.length}
              </span>
            </div>
            {planRows.length > 0 ? (
              <span className="inline-flex items-center text-xs text-primary">
                {t('overviewViewAll')}
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </button>
          {plans.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : planRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('overviewNothing')}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {planRows.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onOpenTab('plans')}
                  className="rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ListCard
        icon={<FolderOpen className="h-4 w-4" />}
        label={t('countDocuments')}
        items={docItems}
        total={docItems.length}
        viewAllHref={`/${locale}/documents?site=${siteId}`}
        loading={docs.isLoading}
      />

      {/* Members — count only (no per-site name list endpoint) */}
      <Card className="h-full">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              <Users className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold">{t('countMembers')}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {counts.members}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {counts.members === 0
              ? t('overviewNothing')
              : t('membersCount', { count: counts.members })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
