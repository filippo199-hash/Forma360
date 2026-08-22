'use client';

import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Flame,
  FlaskConical,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  ListChecks,
  Map as MapIcon,
  Plus,
  Search,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../../lib/brand';
import { cn } from '../../lib/cn';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { useServerErrorMessage } from '../../lib/use-server-error';
import { TemplatePickerDialog } from '../inspections/template-picker-dialog';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { toast } from 'sonner';

interface SiteOverviewProps {
  siteId: string;
  locale: string;
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

type LinkKind = 'inspection' | 'action' | 'asset';

/**
 * Picker to attach an *existing* inspection / action / asset to this site.
 * Lists candidates not already on the site; selecting one sets its site via
 * the entity's own update mutation (a thin `inspections.setSite` for inspections).
 */
function LinkPickerDialog({
  kind,
  siteId,
  title,
  onClose,
}: {
  kind: LinkKind;
  siteId: string;
  title: string;
  onClose: () => void;
}) {
  const t = useTranslations('sites');
  const tCommon = useTranslations('common');
  const tInspStatus = useTranslations('inspections.status');
  const tActStatus = useTranslations('actions.status');
  const resolveServerError = useServerErrorMessage();
  const utils = trpc.useUtils();
  const [q, setQ] = useState('');

  const inspQ = trpc.inspections.list.useQuery({}, { enabled: kind === 'inspection' });
  const actQ = trpc.actions.list.useQuery({}, { enabled: kind === 'action' });
  const assetQ = trpc.assets.list.useQuery(undefined, { enabled: kind === 'asset' });
  const sitesQ = trpc.sites.list.useQuery();
  const siteNameOf = (id: string | null | undefined): string | null =>
    id == null ? null : ((sitesQ.data ?? []).find((s) => s.id === id)?.name ?? null);

  const onErr = (err: { message: string }) =>
    toast.error(resolveServerError(err, tCommon('error')));
  const done = () => {
    toast.success(t('linkedToast'));
    void utils.inspections.list.invalidate();
    void utils.actions.list.invalidate();
    void utils.assets.list.invalidate();
    onClose();
  };
  const setInspSite = trpc.inspections.setSite.useMutation({ onSuccess: done, onError: onErr });
  const updateAction = trpc.actions.update.useMutation({ onSuccess: done, onError: onErr });
  const updateAsset = trpc.assets.update.useMutation({ onSuccess: done, onError: onErr });
  const pending = setInspSite.isPending || updateAction.isPending || updateAsset.isPending;

  // Each candidate carries a `meta` line (status · current place) so the user
  // can tell otherwise-identically-named entries apart.
  const candidates = useMemo(() => {
    // `as readonly string[]` widens the const tuple only so `.includes` accepts a
    // free-form status string; the guard still narrows the return type.
    const isInspStatusKey = (
      s: string,
    ): s is
      | 'in_progress'
      | 'awaiting_signatures'
      | 'awaiting_approval'
      | 'completed'
      | 'rejected' =>
      (
        [
          'in_progress',
          'awaiting_signatures',
          'awaiting_approval',
          'completed',
          'rejected',
        ] as readonly string[]
      ).includes(s);
    const isActStatusKey = (s: string): s is 'open' | 'in_progress' | 'completed' | 'cancelled' =>
      (['open', 'in_progress', 'completed', 'cancelled'] as readonly string[]).includes(s);
    // Localise a known status enum; fall back to a humanised form for statuses
    // that have no translation key yet (e.g. workflow-only states).
    const inspStatusLabel = (s: string): string =>
      isInspStatusKey(s) ? tInspStatus(s) : s.replace(/_/g, ' ');
    const actStatusLabel = (s: string): string =>
      isActStatusKey(s) ? tActStatus(s) : s.replace(/_/g, ' ');
    const withPlace = (
      statusLabel: string | null,
      otherSiteId: string | null | undefined,
    ): string => {
      const place = siteNameOf(otherSiteId);
      const parts = [
        statusLabel,
        place ? t('linkCurrentlyOn', { place }) : t('linkUnassigned'),
      ].filter((p): p is string => p !== null && p !== undefined && p !== '');
      return parts.join(' · ');
    };
    if (kind === 'inspection') {
      return (inspQ.data ?? [])
        .filter((i) => i.siteId !== siteId && i.archivedAt === null)
        .map((i) => {
          // Prefer the template name — the inspection "title" is auto-set to the
          // conduct date, which isn't a recognisable name.
          const name = (i.templateName ?? '').trim();
          const title = (i.title ?? '').trim();
          const label =
            name !== ''
              ? name
              : title !== ''
                ? title
                : i.documentNumber != null
                  ? `#${i.documentNumber}`
                  : t('pinType_inspection');
          // Show the doc number as a suffix in the meta so identical templates differ.
          const num = i.documentNumber != null ? `#${i.documentNumber}` : null;
          const base = withPlace(inspStatusLabel(i.status), i.siteId);
          return { id: i.id, label, meta: [num, base].filter(Boolean).join(' · ') };
        });
    }
    if (kind === 'action') {
      return (actQ.data?.rows ?? [])
        .filter((a) => a.siteId !== siteId)
        .map((a) => ({
          id: a.id,
          label: a.title,
          meta: withPlace(actStatusLabel(a.status), a.siteId),
        }));
    }
    return (assetQ.data?.assets ?? [])
      .filter((a) => a.siteId !== siteId && a.archivedAt === null)
      .map((a) => {
        const place = siteNameOf(a.siteId);
        const meta = [a.typeName, place ? t('linkCurrentlyOn', { place }) : t('linkUnassigned')]
          .filter((p): p is string => p !== null && p !== undefined && p !== '')
          .join(' · ');
        return { id: a.id, label: a.name, meta };
      });
  }, [kind, siteId, inspQ.data, actQ.data, assetQ.data, sitesQ.data, t, tInspStatus, tActStatus]);

  const filtered = candidates.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()));
  const loading = inspQ.isLoading || actQ.isLoading || assetQ.isLoading;

  function link(id: string) {
    if (kind === 'inspection') setInspSite.mutate({ inspectionId: id, siteId });
    else if (kind === 'action') updateAction.mutate({ actionId: id, siteId });
    else updateAsset.mutate({ assetId: id, siteId });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('linkSearchPlaceholder')}
              className="h-9 pl-8"
              autoFocus
            />
          </div>
          <div className="max-h-72 overflow-y-auto overflow-x-hidden rounded-md border">
            {loading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">{t('linkNone')}</p>
            ) : (
              <ul className="divide-y">
                {filtered.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => link(c.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate" title={c.label}>
                          {c.label}
                        </p>
                        {c.meta !== '' ? (
                          <p
                            className="truncate text-xs capitalize text-muted-foreground"
                            title={c.meta}
                          >
                            {c.meta}
                          </p>
                        ) : null}
                      </div>
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SiteOverview({ siteId, locale, onOpenTab }: SiteOverviewProps) {
  const t = useTranslations('sites');
  const canManageInspections = useHasPermission('inspections.manage');
  const canManageActions = useHasPermission('actions.manage');
  const canManageAssets = useHasPermission('assets.manage');
  const canReportObservations = useHasPermission('issues.report');
  const canCreateActions = useHasPermission('actions.create');
  const canManageDocuments = useHasPermission('documents.manage');
  const [linkKind, setLinkKind] = useState<LinkKind | null>(null);
  const [showInspectionPicker, setShowInspectionPicker] = useState(false);

  const canManageSchedules = useHasPermission('templates.schedules.manage');

  // ── Per-site compliance roll-up ──────────────────────────────────────────
  // FreeHS modules, each gated twice: the viewer's permission AND the brand
  // catalogue (ADR 0010) — a Forma360 tenant must never fire a FreeHS-module
  // query. The server re-checks both; this gating is UX, not security.
  const canViewPermits = useHasPermission('permits.view');
  const canViewFireSafety = useHasPermission('fireSafety.view');
  const canViewRiskAssessments = useHasPermission('riskAssessments.view');
  const canViewCoshh = useHasPermission('coshh.view');
  const showPermits = canViewPermits && brandHasModule(activeBrand.id, 'permits');
  const showFire = canViewFireSafety && brandHasModule(activeBrand.id, 'fireSafety');
  const showRa = canViewRiskAssessments && brandHasModule(activeBrand.id, 'riskAssessments');
  const showCoshh = canViewCoshh && brandHasModule(activeBrand.id, 'coshh');

  const permitsOverview = trpc.permits.overview.useQuery({ siteId }, { enabled: showPermits });
  const fireOverview = trpc.fireSafety.overview.useQuery({ siteId }, { enabled: showFire });
  const raList = trpc.riskAssessments.list.useQuery(
    { status: 'active', type: 'all', siteId },
    { enabled: showRa },
  );
  // COSHH site scope is via substance storage locations, not a column —
  // see coshh.siteSummary.
  const coshhSummary = trpc.coshh.siteSummary.useQuery({ siteId }, { enabled: showCoshh });

  const obs = trpc.issues.issues.list.useQuery({ siteId });
  const insp = trpc.inspections.list.useQuery({ siteId });
  const acts = trpc.actions.list.useQuery({ siteId });
  const assets = trpc.assets.list.useQuery({ siteId });
  const docs = trpc.documents.list.useQuery({ siteId });
  const media = trpc.siteMedia.list.useQuery({ siteId });
  const plans = trpc.sitePlans.listPlans.useQuery({ siteId });
  // schedules.list requires the manage permission — only fetch when held.
  const schedules = trpc.schedules.list.useQuery({ siteId }, { enabled: canManageSchedules });

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
  const actItems: PreviewItem[] = (acts.data?.rows ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    href: `/${locale}/actions?action=${a.id}`,
    dot: statusDot(a.status),
  }));
  const assetItems: PreviewItem[] = (assets.data?.assets ?? []).map((a) => ({
    id: a.id,
    title: a.name,
    href: `/${locale}/assets/${a.id}`,
  }));
  const docItems: PreviewItem[] = (docs.data?.documents ?? []).map((d) => ({
    id: d.id,
    title: d.name,
    href: `/${locale}/documents/${d.id}`,
  }));
  const scheduleItems: PreviewItem[] = (schedules.data ?? []).map((s) => ({
    id: s.id,
    title: s.name,
    href: `/${locale}/schedules/${s.id}`,
    dot: s.paused ? 'bg-slate-400' : 'bg-emerald-500',
  }));

  // One shared inline "couldn't load" line for every card, so a failed query
  // reads as an error rather than a misleading empty/zero state.
  function CardError() {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {t('overviewCardError')}
      </p>
    );
  }

  function ListCard({
    icon,
    label,
    items,
    total,
    viewAllHref,
    onViewAll,
    loading,
    error,
    footer,
  }: {
    icon: ReactNode;
    label: string;
    items: PreviewItem[];
    total: number;
    viewAllHref?: string;
    onViewAll?: () => void;
    loading: boolean;
    error?: boolean;
    footer?: ReactNode;
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
          ) : error === true ? (
            <CardError />
          ) : total === 0 ? null : ( // compact zero-state: header + action buttons only
            <ul className="space-y-1.5">
              {items.slice(0, MAX).map((it) => {
                const row = (
                  <div className="flex items-center gap-2">
                    {it.dot !== undefined ? (
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', it.dot)} />
                    ) : null}
                    <span className="flex-1 truncate text-sm" title={it.title}>
                      {it.title}
                    </span>
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
          {footer !== undefined ? <div className="pt-1">{footer}</div> : null}
        </CardContent>
      </Card>
    );
  }

  /** One compact compliance tile: header link + amber/red counters. */
  function ComplianceCard({
    icon,
    label,
    headline,
    stats,
    href,
    loading,
    error,
  }: {
    icon: ReactNode;
    label: string;
    /** Neutral context count for the header badge (e.g. open permits). */
    headline?: number;
    stats: Array<{ key: string; count: number; label: string; severity: 'red' | 'amber' }>;
    href: string;
    loading: boolean;
    error: boolean;
  }) {
    const visible = stats.filter((s) => s.count > 0);
    return (
      <Card className="h-full">
        <CardContent className="space-y-3 p-4">
          <Link href={href} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{icon}</span>
              <span className="text-sm font-semibold">{label}</span>
              {headline !== undefined ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {headline}
                </span>
              ) : null}
            </div>
            <span className="inline-flex items-center text-xs text-primary">
              {t('overviewViewAll')}
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </Link>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : error ? (
            <CardError />
          ) : visible.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('compliance.allClear')}</p>
          ) : (
            <ul className="space-y-1">
              {visible.map((s) => (
                <li
                  key={s.key}
                  className={cn(
                    'text-xs font-medium',
                    s.severity === 'red'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {s.label}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  const linkButton = (kind: LinkKind, label: string) => (
    <Button variant="outline" size="sm" className="h-7 flex-1" onClick={() => setLinkKind(kind)}>
      <Link2 className="mr-1 h-3.5 w-3.5" />
      {label}
    </Button>
  );

  /** Primary "create here" — the new record arrives pre-linked to this place. */
  const createLinkButton = (href: string, label: string) => (
    <Button size="sm" className="h-7 flex-1" asChild>
      <Link href={href}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {label}
      </Link>
    </Button>
  );

  /** Pair a primary create button with the secondary link-existing one. */
  const footerRow = (...buttons: (ReactNode | undefined)[]) => {
    const visible = buttons.filter((b): b is ReactNode => b !== undefined);
    if (visible.length === 0) return undefined;
    return <div className="flex gap-2">{visible}</div>;
  };

  const mediaRows = media.data ?? [];
  const planRows = plans.data ?? [];

  const raActive = raList.data ?? [];
  const raReviewsDue = raActive.filter((a) => a.reviewDue).length;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Compliance roll-up — FreeHS modules, permission + brand gated. */}
      {showRa || showCoshh || showPermits || showFire ? (
        <div className="md:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            {t('compliance.title')}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {showRa ? (
              <ComplianceCard
                icon={<ShieldAlert className="h-4 w-4" />}
                label={t('compliance.riskAssessments')}
                headline={raActive.length}
                href={`/${locale}/risk-assessments?site=${siteId}`}
                loading={raList.isLoading}
                error={raList.isError}
                stats={[
                  {
                    key: 'reviewsDue',
                    count: raReviewsDue,
                    label: t('compliance.reviewsDue', { count: raReviewsDue }),
                    severity: 'amber',
                  },
                ]}
              />
            ) : null}
            {showCoshh ? (
              <ComplianceCard
                icon={<FlaskConical className="h-4 w-4" />}
                label={t('compliance.coshh')}
                headline={coshhSummary.data?.substancesOnSite ?? 0}
                href={`/${locale}/coshh?site=${siteId}`}
                loading={coshhSummary.isLoading}
                error={coshhSummary.isError}
                stats={[
                  {
                    key: 'assessmentsDue',
                    count: coshhSummary.data?.assessmentsDue ?? 0,
                    label: t('compliance.assessmentsDue', {
                      count: coshhSummary.data?.assessmentsDue ?? 0,
                    }),
                    severity: 'amber',
                  },
                  {
                    key: 'levTestsOverdue',
                    count: coshhSummary.data?.levTestsOverdue ?? 0,
                    label: t('compliance.levTestsOverdue', {
                      count: coshhSummary.data?.levTestsOverdue ?? 0,
                    }),
                    severity: 'red',
                  },
                ]}
              />
            ) : null}
            {showPermits ? (
              <ComplianceCard
                icon={<ClipboardList className="h-4 w-4" />}
                label={t('compliance.permits')}
                headline={permitsOverview.data?.openTotal ?? 0}
                href={`/${locale}/permits?site=${siteId}`}
                loading={permitsOverview.isLoading}
                error={permitsOverview.isError}
                stats={[
                  {
                    key: 'overdue',
                    count: permitsOverview.data?.overdue ?? 0,
                    label: t('compliance.permitsOverdue', {
                      count: permitsOverview.data?.overdue ?? 0,
                    }),
                    severity: 'red',
                  },
                  {
                    key: 'expiringSoon',
                    count: permitsOverview.data?.expiringSoon ?? 0,
                    label: t('compliance.permitsExpiringSoon', {
                      count: permitsOverview.data?.expiringSoon ?? 0,
                    }),
                    severity: 'amber',
                  },
                ]}
              />
            ) : null}
            {showFire ? (
              <ComplianceCard
                icon={<Flame className="h-4 w-4" />}
                label={t('compliance.fireSafety')}
                href={`/${locale}/fire-safety?site=${siteId}`}
                loading={fireOverview.isLoading}
                error={fireOverview.isError}
                stats={[
                  {
                    key: 'checksFailed',
                    count: fireOverview.data?.checksFailed ?? 0,
                    label: t('compliance.checksFailed', {
                      count: fireOverview.data?.checksFailed ?? 0,
                    }),
                    severity: 'red',
                  },
                  {
                    key: 'checksOverdue',
                    count: fireOverview.data?.checksOverdue ?? 0,
                    label: t('compliance.checksOverdue', {
                      count: fireOverview.data?.checksOverdue ?? 0,
                    }),
                    severity: 'amber',
                  },
                  {
                    key: 'doorsFailed',
                    count: fireOverview.data?.doorsFailed ?? 0,
                    label: t('compliance.doorsFailed', {
                      count: fireOverview.data?.doorsFailed ?? 0,
                    }),
                    severity: 'red',
                  },
                  {
                    key: 'doorsOverdue',
                    count: fireOverview.data?.doorsOverdue ?? 0,
                    label: t('compliance.doorsOverdue', {
                      count: fireOverview.data?.doorsOverdue ?? 0,
                    }),
                    severity: 'amber',
                  },
                  {
                    key: 'frasReviewDue',
                    count: fireOverview.data?.frasReviewDue ?? 0,
                    label: t('compliance.frasReviewDue', {
                      count: fireOverview.data?.frasReviewDue ?? 0,
                    }),
                    severity: 'amber',
                  },
                ]}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <ListCard
        icon={<AlertTriangle className="h-4 w-4" />}
        label={t('countObservations')}
        items={obsItems}
        total={obsItems.length}
        viewAllHref={`/${locale}/observations?site=${siteId}`}
        loading={obs.isLoading}
        error={obs.isError}
        footer={footerRow(
          canReportObservations
            ? createLinkButton(
                `/${locale}/observations/new?site=${siteId}`,
                t('createObservationButton'),
              )
            : undefined,
        )}
      />
      <ListCard
        icon={<ListChecks className="h-4 w-4" />}
        label={t('countActions')}
        items={actItems}
        total={actItems.length}
        viewAllHref={`/${locale}/actions?site=${siteId}`}
        loading={acts.isLoading}
        error={acts.isError}
        footer={footerRow(
          canCreateActions
            ? createLinkButton(`/${locale}/actions/new?site=${siteId}`, t('createActionButton'))
            : undefined,
          canManageActions ? linkButton('action', t('linkAction')) : undefined,
        )}
      />
      <ListCard
        icon={<ClipboardCheck className="h-4 w-4" />}
        label={t('countInspections')}
        items={inspItems}
        total={inspItems.length}
        viewAllHref={`/${locale}/inspections?site=${siteId}`}
        loading={insp.isLoading}
        error={insp.isError}
        footer={footerRow(
          canManageInspections ? (
            <Button size="sm" className="h-7 flex-1" onClick={() => setShowInspectionPicker(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('startInspectionButton')}
            </Button>
          ) : undefined,
          canManageInspections ? linkButton('inspection', t('linkInspection')) : undefined,
        )}
      />
      <ListCard
        icon={<Wrench className="h-4 w-4" />}
        label={t('countAssets')}
        items={assetItems}
        total={assetItems.length}
        viewAllHref={`/${locale}/assets?site=${siteId}`}
        loading={assets.isLoading}
        error={assets.isError}
        footer={footerRow(
          canManageAssets
            ? createLinkButton(`/${locale}/assets/new?site=${siteId}`, t('createAssetButton'))
            : undefined,
          canManageAssets ? linkButton('asset', t('linkAsset')) : undefined,
        )}
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
          ) : media.isError ? (
            <CardError />
          ) : mediaRows.length === 0 ? null : ( // compact zero-state
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
          ) : plans.isError ? (
            <CardError />
          ) : planRows.length === 0 ? null : ( // compact zero-state
            <div className="flex flex-wrap gap-1.5">
              {planRows.map((p) => {
                // Guard against file-hash names from uploads without a title.
                const planName = /^[0-9a-f]{24,}$/i.test(p.name) ? t('plansUntitled') : p.name;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpenTab('plans')}
                    title={planName}
                    className="max-w-[180px] truncate rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    {planName}
                  </button>
                );
              })}
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
        error={docs.isError}
        footer={footerRow(
          canManageDocuments
            ? createLinkButton(`/${locale}/documents/new?site=${siteId}`, t('uploadDocumentButton'))
            : undefined,
        )}
      />

      {/* Members card removed — the Team & access tab is the single home
          for membership; a count-only duplicate card added noise. */}

      {canManageSchedules ? (
        <ListCard
          icon={<CalendarClock className="h-4 w-4" />}
          label={t('countSchedules')}
          items={scheduleItems}
          total={scheduleItems.length}
          viewAllHref={`/${locale}/schedules?site=${siteId}`}
          loading={schedules.isLoading}
          error={schedules.isError}
        />
      ) : null}

      <TemplatePickerDialog
        open={showInspectionPicker}
        onOpenChange={setShowInspectionPicker}
        locale={locale}
        siteId={siteId}
      />

      {linkKind !== null ? (
        <LinkPickerDialog
          kind={linkKind}
          siteId={siteId}
          title={
            linkKind === 'action'
              ? t('linkAction')
              : linkKind === 'inspection'
                ? t('linkInspection')
                : t('linkAsset')
          }
          onClose={() => setLinkKind(null)}
        />
      ) : null}
    </div>
  );
}
