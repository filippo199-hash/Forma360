'use client';

/**
 * LEV register — local exhaust ventilation plant and its thorough
 * examination & test record (statutory 14-month default interval).
 * A failed test takes the unit out of service; the register shows
 * overdue units first.
 */
import { Fan, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { usePlaceTerms } from '../../../../src/lib/terminology';
import { trpc } from '../../../../src/lib/trpc/client';

function formatDate(d: Date | string | null | undefined, locale: string): string {
  if (d == null) return '—';
  return new Date(d).toLocaleDateString(locale, { dateStyle: 'medium' });
}

export default function LevRegisterPage() {
  const t = useTranslations('coshh.lev');
  const tCoshh = useTranslations('coshh');
  const locale = useLocale();
  const { label: placeLabel } = usePlaceTerms();
  const canManage = useHasPermission('coshh.manage');

  const utils = trpc.useUtils();
  const { data: units, isLoading } = trpc.coshh.lev.list.useQuery({});
  const refresh = (): void => {
    void utils.coshh.lev.list.invalidate();
    void utils.coshh.overview.invalidate();
  };
  const onError = () => toast.error(tCoshh('saveError'));

  const createUnit = trpc.coshh.lev.create.useMutation({
    onSuccess: () => {
      toast.success(t('createdToast'));
      refresh();
    },
    onError,
  });
  const updateUnit = trpc.coshh.lev.update.useMutation({ onSuccess: refresh, onError });
  const recordTest = trpc.coshh.lev.recordTest.useMutation({
    onSuccess: () => {
      toast.success(t('testRecordedToast'));
      refresh();
    },
    onError,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [siteId, setSiteId] = useState('');
  const [locationText, setLocationText] = useState('');
  const [interval, setIntervalMonths] = useState('14');

  const [testFor, setTestFor] = useState<string | null>(null);
  const [testDate, setTestDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [testResult, setTestResult] = useState('pass');
  const [examiner, setExaminer] = useState('');
  const [defects, setDefects] = useState('');

  const sorted = [...(units ?? [])].sort((a, b) => Number(b.overdue) - Number(a.overdue));

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-4 sm:space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/${locale}/coshh`} className="text-sm text-muted-foreground hover:underline">
            ← {tCoshh('backToList')}
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Fan className="h-6 w-6 text-muted-foreground" />
            {t('title')}
          </h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
        </div>
        {canManage ? (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('addButton')}
          </Button>
        ) : null}
      </header>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">{t('columns.name')}</th>
                  <th className="px-3 py-2 font-medium">{placeLabel}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.interval')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.lastTest')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.nextDue')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.status')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-4">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      {t('empty')}
                    </td>
                  </tr>
                ) : (
                  sorted.map((u) => (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <span className="font-medium">{u.name}</span>
                        {u.locationText !== '' ? (
                          <span className="text-muted-foreground"> · {u.locationText}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{u.siteName ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {t('intervalMonths', { count: u.testIntervalMonths })}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(u.lastTestAt, locale)}
                        {u.latestResult !== null ? (
                          <span
                            className={`ml-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium ${
                              u.latestResult === 'fail'
                                ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
                                : u.latestResult === 'pass_with_defects'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100'
                            }`}
                          >
                            {t(`results.${u.latestResult}` as never)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            u.overdue
                              ? 'font-medium text-red-700 dark:text-red-300'
                              : 'text-muted-foreground'
                          }
                        >
                          {formatDate(u.nextTestDueAt, locale)}
                        </span>
                        {u.overdue ? (
                          <span className="ml-1.5 rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">
                            {t('overdue')}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                            u.status === 'in_service'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100'
                              : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
                          }`}
                        >
                          {t(`status.${u.status}` as never)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canManage ? (
                          <div className="flex justify-end gap-2">
                            {u.status === 'out_of_service' ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                  updateUnit.mutate({ levUnitId: u.id, status: 'in_service' })
                                }
                              >
                                {t('returnToService')}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => setTestFor(u.id)}
                            >
                              {t('recordTestButton')}
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Add unit dialog ─────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addDialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="lev-name">{t('nameLabel')}</Label>
              <Input
                id="lev-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{placeLabel}</Label>
              <SiteSelector
                value={siteId !== '' ? [siteId] : []}
                onChange={(next) => setSiteId(next[0] ?? '')}
                multiple={false}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="lev-location">{t('locationLabel')}</Label>
                <Input
                  id="lev-location"
                  value={locationText}
                  onChange={(e) => setLocationText(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lev-interval">{t('intervalLabel')}</Label>
                <Input
                  id="lev-interval"
                  type="number"
                  min="1"
                  max="14"
                  value={interval}
                  onChange={(e) => setIntervalMonths(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('intervalHint')}</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={name.trim() === '' || createUnit.isPending}
              onClick={() => {
                createUnit.mutate({
                  name: name.trim(),
                  ...(siteId !== '' ? { siteId } : {}),
                  locationText: locationText.trim(),
                  testIntervalMonths: Math.min(14, Math.max(1, Number(interval) || 14)),
                });
                setAddOpen(false);
                setName('');
                setSiteId('');
                setLocationText('');
                setIntervalMonths('14');
              }}
            >
              {t('addSaveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record test dialog ──────────────────────────────────────── */}
      <Dialog open={testFor !== null} onOpenChange={(open) => !open && setTestFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('testDialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="test-date">{t('testDateLabel')}</Label>
                <Input
                  id="test-date"
                  type="date"
                  value={testDate}
                  onChange={(e) => setTestDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="test-result">{t('testResultLabel')}</Label>
                <select
                  id="test-result"
                  value={testResult}
                  onChange={(e) => setTestResult(e.target.value)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {(['pass', 'pass_with_defects', 'fail'] as const).map((r) => (
                    <option key={r} value={r}>
                      {t(`results.${r}` as never)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="test-examiner">{t('examinerLabel')}</Label>
              <Input
                id="test-examiner"
                value={examiner}
                onChange={(e) => setExaminer(e.target.value)}
                placeholder={t('examinerPlaceholder')}
              />
            </div>
            {testResult !== 'pass' ? (
              <div className="space-y-1.5">
                <Label htmlFor="test-defects">{t('defectsLabel')}</Label>
                <Textarea
                  id="test-defects"
                  value={defects}
                  onChange={(e) => setDefects(e.target.value)}
                  rows={2}
                />
              </div>
            ) : null}
            {testResult === 'fail' ? (
              <p className="text-xs text-red-700 dark:text-red-300">{t('failHint')}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              disabled={recordTest.isPending}
              onClick={() => {
                if (testFor === null) return;
                recordTest.mutate({
                  levUnitId: testFor,
                  testedAt: new Date(testDate),
                  result: testResult as never,
                  examiner: examiner.trim(),
                  defectsSummary: defects.trim(),
                });
                setTestFor(null);
                setExaminer('');
                setDefects('');
                setTestResult('pass');
              }}
            >
              {t('testSaveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
