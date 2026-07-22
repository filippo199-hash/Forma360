'use client';

import { DoorOpen, HardHat, LogOut, Plus, Search } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
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
import { trpc } from '../../../src/lib/trpc/client';

/** Viewer's timezone — check-in times are stored as absolute instants. */
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

type Compliance = 'compliant' | 'non_compliant' | 'no_requirements' | 'suspended';

const BADGE: Record<Compliance, string> = {
  compliant: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  non_compliant: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  suspended: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-100',
  no_requirements: 'bg-muted text-muted-foreground',
};

export default function ContractorsPage() {
  const t = useTranslations('contractors');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('contractors.manage');
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.contractors.list.useQuery();
  // Live "who is on site" board for the gate guard — refetch every 30s.
  const onSite = trpc.contractors.visits.onSiteNow.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const checkOut = trpc.contractors.visits.checkOut.useMutation({
    onSuccess: () => {
      toast.success(t('visits.checkedOutToast'));
      void utils.contractors.visits.onSiteNow.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : t('error')),
  });

  // Group the on-site people by contractor so the guard sees, per contractor,
  // the headcount and who exactly is still inside.
  type OnSiteRow = NonNullable<typeof onSite.data>[number];
  const onSiteTotal = onSite.data?.length ?? 0;
  const onSiteGroups = useMemo(() => {
    const map = new Map<
      string,
      { contractorId: string; contractorName: string; people: OnSiteRow[] }
    >();
    for (const v of onSite.data ?? []) {
      const g = map.get(v.contractorId) ?? {
        contractorId: v.contractorId,
        contractorName: v.contractorName,
        people: [],
      };
      g.people.push(v);
      map.set(v.contractorId, g);
    }
    return [...map.values()];
  }, [onSite.data]);
  const rows = data ?? [];
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === '') return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.category !== null && r.category.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const create = trpc.contractors.create.useMutation({
    onSuccess: () => {
      toast.success(t('createdToast'));
      void utils.contractors.list.invalidate();
      setOpen(false);
      setName('');
      setCategory('');
      setContactName('');
      setContactEmail('');
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : t('error')),
  });

  function submit() {
    if (name.trim() === '') return;
    create.mutate({
      name: name.trim(),
      category: category.trim() === '' ? null : category.trim(),
      primaryContactName: contactName.trim() === '' ? null : contactName.trim(),
      primaryContactEmail: contactEmail.trim() === '' ? null : contactEmail.trim(),
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/${locale}/contractors/calendar`}>{t('visits.calendarLink')}</Link>
          </Button>
          {canManage ? (
            <Button variant="outline" asChild>
              <Link href={`/${locale}/contractors/gate`}>{t('gate.navLink')}</Link>
            </Button>
          ) : null}
          {canManage ? (
            <Button variant="outline" asChild>
              <Link href={`/${locale}/contractors/templates`}>{t('manageTemplates')}</Link>
            </Button>
          ) : null}
          {canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('newButton')}
            </Button>
          ) : null}
        </div>
      </header>

      {/* Gate board — who is currently on site, grouped by contractor. */}
      {onSiteTotal > 0 ? (
        <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <DoorOpen className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-sm font-semibold">
                {t('onSite.heading', { count: onSiteTotal })}
              </h2>
            </div>
            <div className="space-y-4">
              {onSiteGroups.map((g) => (
                <div key={g.contractorId}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <Link
                      href={`/${locale}/contractors/${g.contractorId}`}
                      className="text-sm font-semibold hover:underline"
                    >
                      {g.contractorName}
                    </Link>
                    <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      {t('onSite.perContractor', { count: g.people.length })}
                    </span>
                  </div>
                  <ul className="divide-y divide-emerald-200/60 dark:divide-emerald-900/40">
                    {g.people.map((v) => (
                      <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {v.visitorName ?? v.title}
                            {v.isWalkIn ? (
                              <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                                {t('visits.walkInBadge')}
                              </span>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {v.visitorName !== null ? `${v.title} · ` : ''}
                            {v.siteName !== null ? `${v.siteName} · ` : ''}
                            {v.checkedInAt !== null
                              ? t('onSite.since', {
                                  time: format.dateTime(new Date(v.checkedInAt), {
                                    timeStyle: 'short',
                                    timeZone: BROWSER_TZ,
                                  }),
                                })
                              : ''}
                          </p>
                        </div>
                        {canManage ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0"
                            disabled={checkOut.isPending}
                            onClick={() => checkOut.mutate({ id: v.id })}
                          >
                            <LogOut className="mr-1 h-3.5 w-3.5" />
                            {t('visits.checkOut')}
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="h-9 pl-8"
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <HardHat className="h-6 w-6" />
            <p>{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t('colName')}</th>
                    <th className="px-4 py-3 font-medium">{t('colCategory')}</th>
                    <th className="px-4 py-3 font-medium">{t('colContact')}</th>
                    <th className="px-4 py-3 font-medium">{t('colCompliance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => {
                    const status = c.complianceStatus as Compliance;
                    return (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <Link
                            href={`/${locale}/contractors/${c.id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {c.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{c.category ?? '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {c.primaryContactName ?? c.primaryContactEmail ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                              BADGE[status],
                            )}
                          >
                            {t(`status_${status}` as 'status_compliant')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">{t('fieldName')}</Label>
              <Input
                id="c-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-cat">{t('fieldCategory')}</Label>
              <Input
                id="c-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="c-contact">{t('fieldContactName')}</Label>
                <Input
                  id="c-contact"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-email">{t('fieldContactEmail')}</Label>
                <Input
                  id="c-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  maxLength={200}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={submit} disabled={create.isPending || name.trim() === ''}>
              {t('createButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
