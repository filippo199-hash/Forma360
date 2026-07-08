'use client';

import { Building2, MapPin, Plus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../src/components/ui/dialog';
import { Input } from '../../../src/components/ui/input';
import { Label } from '../../../src/components/ui/label';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { cn } from '../../../src/lib/cn';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { hubTitleKey, useTerminology } from '../../../src/lib/terminology';
import { trpc } from '../../../src/lib/trpc/client';

type Kind = 'site' | 'project';
type Status = 'planning' | 'active' | 'on_hold' | 'completed';

const STATUS_COLORS: Record<Status, string> = {
  planning: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  on_hold: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
};

export default function SitesHubPage() {
  const t = useTranslations('sites');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('sites.manage');
  const terminology = useTerminology();
  const defaultKind: Kind = terminology === 'sites' ? 'site' : 'project';
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.sites.hub.useQuery();
  const rows = data ?? [];
  const projects = rows.filter((r) => r.kind === 'project');
  const plainSites = rows.filter((r) => r.kind !== 'project');

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('project');

  function openCreate() {
    setKind(defaultKind);
    setOpen(true);
  }
  const [client, setClient] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const create = trpc.sites.create.useMutation({
    onSuccess: () => {
      toast.success(t('createdToast'));
      void utils.sites.hub.invalidate();
      setOpen(false);
      setName('');
      setClient('');
      setStartDate('');
      setEndDate('');
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function submit() {
    if (name.trim().length === 0) return;
    create.mutate({
      name: name.trim(),
      kind,
      ...(kind === 'project'
        ? {
            status,
            client: client.trim() === '' ? null : client.trim(),
            startDate: startDate === '' ? null : startDate,
            endDate: endDate === '' ? null : endDate,
          }
        : {}),
    });
  }

  function statusLabel(s: string | null): string | null {
    if (s === 'planning' || s === 'active' || s === 'on_hold' || s === 'completed') {
      return t(`status_${s}` as 'status_active');
    }
    return null;
  }

  function renderCard(row: (typeof rows)[number]) {
    const isProject = row.kind === 'project';
    const label = statusLabel(row.status);
    return (
      <Link key={row.id} href={`/${locale}/sites/${row.id}`}>
        <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/30">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                {isProject ? (
                  <MapPin className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="leading-snug">{row.name}</span>
              </div>
              {label !== null ? (
                <span
                  className={cn(
                    'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
                    STATUS_COLORS[row.status as Status] ?? STATUS_COLORS.active,
                  )}
                >
                  {label}
                </span>
              ) : null}
            </div>

            {row.client !== null && row.client !== '' ? (
              <p className="text-sm text-muted-foreground">{row.client}</p>
            ) : null}

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {isProject && (row.startDate !== null || row.endDate !== null) ? (
                <span>
                  {row.startDate ?? '—'} → {row.endDate ?? '—'}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {t('membersCount', { count: row.memberCount })}
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t(hubTitleKey(terminology))}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage ? (
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            {t('newButton')}
          </Button>
        ) : null}
      </header>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {projects.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('sectionProjects')}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map(renderCard)}
              </div>
            </section>
          ) : null}
          {plainSites.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('sectionSites')}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {plainSites.map(renderCard)}
              </div>
            </section>
          ) : null}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Kind toggle — only when the tenant uses both axes */}
            {terminology === 'both' ? (
              <div className="grid grid-cols-2 gap-2">
                {(['project', 'site'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                      kind === k
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-input text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {k === 'project' ? t('kindProject') : t('kindSite')}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="site-name">{t('fieldName')}</Label>
              <Input
                id="site-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                maxLength={120}
                autoFocus
              />
            </div>

            {kind === 'project' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="site-client">{t('fieldClient')}</Label>
                  <Input
                    id="site-client"
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                    placeholder={t('clientPlaceholder')}
                    maxLength={200}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="site-start">{t('fieldStart')}</Label>
                    <Input
                      id="site-start"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="site-end">{t('fieldEnd')}</Label>
                    <Input
                      id="site-end"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="site-status">{t('fieldStatus')}</Label>
                  <select
                    id="site-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Status)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="planning">{t('status_planning')}</option>
                    <option value="active">{t('status_active')}</option>
                    <option value="on_hold">{t('status_on_hold')}</option>
                    <option value="completed">{t('status_completed')}</option>
                  </select>
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={submit} disabled={create.isPending || name.trim().length === 0}>
              {t('createButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
