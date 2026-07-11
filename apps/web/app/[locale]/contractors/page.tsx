'use client';

import { HardHat, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
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

type Compliance = 'compliant' | 'non_compliant' | 'no_requirements';

const BADGE: Record<Compliance, string> = {
  compliant: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  non_compliant: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  no_requirements: 'bg-muted text-muted-foreground',
};

export default function ContractorsPage() {
  const t = useTranslations('contractors');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('contractors.manage');
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.contractors.list.useQuery();
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
        <div className="flex items-center gap-2">
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
            <div className="grid grid-cols-2 gap-3">
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
