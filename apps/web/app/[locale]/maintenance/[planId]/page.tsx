'use client';

import { ArrowLeft, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
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
import { Textarea } from '../../../../src/components/ui/textarea';
import { cn } from '../../../../src/lib/cn';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type MaintenanceStatus = 'awaiting_first_reading' | 'on_schedule' | 'approaching' | 'overdue';

const STATUS_COLORS: Record<MaintenanceStatus, string> = {
  awaiting_first_reading: 'bg-slate-100 text-slate-700',
  on_schedule: 'bg-emerald-100 text-emerald-800',
  approaching: 'bg-amber-100 text-amber-800',
  overdue: 'bg-red-100 text-red-800',
};

type Tab = 'overview' | 'assets';

export default function MaintenancePlanDetailPage() {
  const t = useTranslations('maintenancePlans.detail');
  const tNew = useTranslations('maintenancePlans.new');
  const tTable = useTranslations('maintenancePlans.table');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; planId: string }>();
  const locale = params.locale ?? 'en';
  const planId = params.planId ?? '';
  const utils = trpc.useUtils();
  const canManage = useHasPermission('assets.maintenance.manage');

  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIntervalDays, setEditIntervalDays] = useState('');
  const [editIntervalUsage, setEditIntervalUsage] = useState('');
  const [editNotifDays, setEditNotifDays] = useState<number[]>([]);
  const [notifInput, setNotifInput] = useState('');
  const [linkAssetId, setLinkAssetId] = useState('');
  const [serviceDate, setServiceDate] = useState<Record<string, string>>({});

  const { data, isLoading } = trpc.maintenancePlans.get.useQuery({ planId });
  const { data: assetsList } = trpc.assets.list.useQuery(undefined, { enabled: tab === 'assets' });
  const { data: assetStatusRows } = trpc.maintenancePlans.listForAsset.useQuery(
    { assetId: '' },
    { enabled: false },
  );
  void assetStatusRows;

  const update = trpc.maintenancePlans.update.useMutation({
    onSuccess: () => {
      toast.success(t('updatedToast'));
      setEditing(false);
      void utils.maintenancePlans.get.invalidate({ planId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const archive = trpc.maintenancePlans.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archivedToast'));
      void utils.maintenancePlans.get.invalidate({ planId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const linkAssets = trpc.maintenancePlans.linkAssets.useMutation({
    onSuccess: () => {
      toast.success(t('assetLinkedToast'));
      setLinkAssetId('');
      void utils.maintenancePlans.get.invalidate({ planId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const unlinkAsset = trpc.maintenancePlans.unlinkAsset.useMutation({
    onSuccess: () => {
      toast.success(t('assetUnlinkedToast'));
      void utils.maintenancePlans.get.invalidate({ planId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const updateService = trpc.maintenancePlans.updateServiceRecord.useMutation({
    onSuccess: () => {
      toast.success(t('serviceRecordedToast'));
      void utils.maintenancePlans.get.invalidate({ planId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function startEditing() {
    if (data === undefined) return;
    const { plan } = data;
    setEditName(plan.name);
    setEditDescription(plan.description);
    setEditIntervalDays(plan.intervalDays !== null ? String(plan.intervalDays) : '');
    setEditIntervalUsage(plan.intervalUsage !== null ? String(plan.intervalUsage) : '');
    const notifArr = Array.isArray(plan.notificationDaysBefore)
      ? (plan.notificationDaysBefore as number[])
      : [];
    setEditNotifDays([...notifArr].sort((a, b) => b - a));
    setEditing(true);
  }

  function addNotifDay() {
    const n = parseInt(notifInput, 10);
    if (isNaN(n) || n < 0) return;
    if (!editNotifDays.includes(n)) setEditNotifDays((prev) => [...prev, n].sort((a, b) => b - a));
    setNotifInput('');
  }

  function saveEdit() {
    update.mutate({
      planId,
      name: editName.trim(),
      description: editDescription,
      intervalDays: editIntervalDays !== '' ? parseInt(editIntervalDays, 10) : null,
      intervalUsage: editIntervalUsage !== '' ? parseFloat(editIntervalUsage) : null,
      notificationDaysBefore: editNotifDays,
    });
  }

  if (isLoading || data === undefined) {
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const { plan, linkedAssets } = data;
  const isArchived = plan.archivedAt !== null;
  const notifDays = Array.isArray(plan.notificationDaysBefore)
    ? (plan.notificationDaysBefore as number[])
    : [];

  const unlinkedAssets = (assetsList ?? []).filter(
    (a) => !linkedAssets.some((la) => la.assetId === a.id),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/maintenance`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{plan.name}</h1>
              {isArchived ? (
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {t('archivedBadge')}
                </span>
              ) : null}
              <span className="rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                {tTable(`planType.${plan.planType}`)}
              </span>
            </div>
            {plan.description !== '' ? (
              <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {canManage && !editing && !isArchived ? (
              <Button type="button" variant="outline" size="sm" onClick={startEditing}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {tCommon('edit')}
              </Button>
            ) : null}
            {canManage && !isArchived ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => archive.mutate({ planId })}
                disabled={archive.isPending}
              >
                {tCommon('archive')}
              </Button>
            ) : null}
          </div>
        </div>

        <nav className="flex gap-1 border-b">
          {(['overview', 'assets'] as const).map((t_) => (
            <button
              key={t_}
              type="button"
              onClick={() => {
                setEditing(false);
                setTab(t_);
              }}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === t_
                  ? 'border-foreground text-foreground font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`tabs.${t_}`)}
            </button>
          ))}
        </nav>
      </header>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' ? (
        editing ? (
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">{tNew('fields.name')}</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={500}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-desc">{tNew('fields.description')}</Label>
                <Textarea
                  id="edit-desc"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  maxLength={5000}
                  rows={3}
                />
              </div>
              {plan.planType === 'time' ? (
                <div className="space-y-1.5">
                  <Label>{tNew('fields.intervalDays')}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      value={editIntervalDays}
                      onChange={(e) => setEditIntervalDays(e.target.value)}
                      className="w-28"
                    />
                    <span className="text-sm text-muted-foreground">{tNew('fields.days')}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>{tNew('fields.intervalUsage')}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={editIntervalUsage}
                      onChange={(e) => setEditIntervalUsage(e.target.value)}
                      className="w-28"
                    />
                    <span className="text-sm text-muted-foreground">{plan.usageUnit}</span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>{tNew('notificationsHeading')}</Label>
                <div className="flex flex-wrap gap-2">
                  {editNotifDays.map((n) => (
                    <span
                      key={n}
                      className="inline-flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-sm"
                    >
                      {tNew('notifDayChip', { days: n })}
                      <button
                        type="button"
                        onClick={() => setEditNotifDays((prev) => prev.filter((d) => d !== n))}
                      >
                        <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    value={notifInput}
                    onChange={(e) => setNotifInput(e.target.value)}
                    className="w-20"
                    placeholder="7"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addNotifDay}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  disabled={update.isPending || editName.trim().length === 0}
                  onClick={saveEdit}
                >
                  {update.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  {tCommon('save')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  {tCommon('cancel')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              <h2 className="text-base font-semibold">{t('detailsHeading')}</h2>
              <DetailRow label={t('fields.planType')}>
                {tTable(`planType.${plan.planType}`)}
              </DetailRow>
              {plan.planType === 'time' ? (
                <DetailRow label={t('fields.interval')}>
                  {plan.intervalDays !== null ? `${plan.intervalDays} ${tNew('fields.days')}` : '—'}
                </DetailRow>
              ) : (
                <>
                  <DetailRow label={t('fields.interval')}>
                    {plan.intervalUsage !== null ? `${plan.intervalUsage} ${plan.usageUnit}` : '—'}
                  </DetailRow>
                  <DetailRow label={t('fields.usageField')}>{plan.usageField ?? '—'}</DetailRow>
                </>
              )}
              {notifDays.length > 0 ? (
                <DetailRow label={t('fields.notifications')}>
                  {notifDays.map((n) => tNew('notifDayChip', { days: n })).join(', ')}
                </DetailRow>
              ) : null}
              <DetailRow label={t('fields.linkedAssets')}>{String(linkedAssets.length)}</DetailRow>
            </CardContent>
          </Card>
        )
      ) : null}

      {/* ── ASSETS ── */}
      {tab === 'assets' ? (
        <div className="space-y-4">
          {/* Link new asset */}
          {canManage && !isArchived ? (
            <Card>
              <CardContent className="p-6">
                <h2 className="mb-3 text-base font-semibold">{t('linkAssetHeading')}</h2>
                <div className="flex gap-2">
                  <select
                    value={linkAssetId}
                    onChange={(e) => setLinkAssetId(e.target.value)}
                    className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">{t('selectAssetPlaceholder')}</option>
                    {unlinkedAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    disabled={linkAssetId === '' || linkAssets.isPending}
                    onClick={() => linkAssets.mutate({ planId, assetIds: [linkAssetId] })}
                  >
                    {linkAssets.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t('linkAssetButton')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Linked assets table */}
          <Card>
            <CardContent className="p-0">
              {linkedAssets.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {t('noLinkedAssets')}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">{t('assetColumns.asset')}</th>
                      <th className="px-3 py-2 font-medium">{t('assetColumns.lastService')}</th>
                      {canManage ? (
                        <th className="px-3 py-2 font-medium">{t('assetColumns.recordService')}</th>
                      ) : null}
                      {canManage ? <th className="px-3 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {linkedAssets.map((link) => (
                      <tr key={link.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">
                          {link.assetId !== null ? (
                            <Link
                              href={`/${locale}/assets/${link.assetId}`}
                              className="hover:underline"
                            >
                              {link.assetName ?? link.assetId}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {link.lastServiceDate ?? '—'}
                        </td>
                        {canManage ? (
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Input
                                type="date"
                                value={serviceDate[link.id] ?? ''}
                                onChange={(e) =>
                                  setServiceDate((prev) => ({
                                    ...prev,
                                    [link.id]: e.target.value,
                                  }))
                                }
                                className="h-7 w-36 px-2 text-xs"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!serviceDate[link.id] || updateService.isPending}
                                onClick={() => {
                                  if (link.assetId === null) return;
                                  updateService.mutate({
                                    planId,
                                    assetId: link.assetId,
                                    lastServiceDate: serviceDate[link.id],
                                  });
                                  setServiceDate((prev) => ({ ...prev, [link.id]: '' }));
                                }}
                              >
                                {t('recordServiceButton')}
                              </Button>
                            </div>
                          </td>
                        ) : null}
                        {canManage ? (
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              aria-label={t('unlinkAsset')}
                              onClick={() => {
                                if (link.assetId === null) return;
                                unlinkAsset.mutate({ planId, assetId: link.assetId });
                              }}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[140px_1fr]">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}

void STATUS_COLORS;
