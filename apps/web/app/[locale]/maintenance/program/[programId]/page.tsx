'use client';

import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Input } from '../../../../../src/components/ui/input';
import { Label } from '../../../../../src/components/ui/label';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../../src/lib/permissions-context';
import { trpc } from '../../../../../src/lib/trpc/client';

type TriggerType = 'time' | 'distance' | 'usage';

export default function MaintenanceProgramDetailPage() {
  const t = useTranslations('maintenancePrograms');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; programId: string }>();
  const locale = params.locale ?? 'en';
  const programId = params.programId ?? '';
  const router = useRouter();
  const utils = trpc.useUtils();
  const canManage = useHasPermission('assets.maintenance.manage');

  const { data, isLoading } = trpc.maintenancePrograms.get.useQuery({ programId });

  // Editable header fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Add-trigger form
  const [triggerTitle, setTriggerTitle] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('time');
  const [intervalDays, setIntervalDays] = useState('');
  const [intervalValue, setIntervalValue] = useState('');
  const [unit, setUnit] = useState('');
  const [usageField, setUsageField] = useState('');

  // Attach-asset
  const [attachAssetId, setAttachAssetId] = useState('');

  useEffect(() => {
    if (data?.program !== undefined) {
      setName(data.program.name);
      setDescription(data.program.description);
    }
  }, [data?.program]);

  const { data: assetsData } = trpc.assets.list.useQuery({}, { enabled: canManage });
  const allAssets = assetsData ?? [];

  const update = trpc.maintenancePrograms.update.useMutation({
    onSuccess: () => {
      toast.success(t('savedToast'));
      void utils.maintenancePrograms.get.invalidate({ programId });
      void utils.maintenancePrograms.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const addTrigger = trpc.maintenancePrograms.addTrigger.useMutation({
    onSuccess: () => {
      toast.success(t('triggerAddedToast'));
      setTriggerTitle('');
      setIntervalDays('');
      setIntervalValue('');
      setUnit('');
      setUsageField('');
      setTriggerType('time');
      void utils.maintenancePrograms.get.invalidate({ programId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const removeTrigger = trpc.maintenancePrograms.removeTrigger.useMutation({
    onSuccess: () => {
      toast.success(t('triggerRemovedToast'));
      void utils.maintenancePrograms.get.invalidate({ programId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const attachAsset = trpc.maintenancePrograms.attachAsset.useMutation({
    onSuccess: (res) => {
      toast.success(t('assetAttachedToast', { count: res.actionsCreated }));
      setAttachAssetId('');
      void utils.maintenancePrograms.get.invalidate({ programId });
      void utils.maintenancePrograms.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const detachAsset = trpc.maintenancePrograms.detachAsset.useMutation({
    onSuccess: () => {
      toast.success(t('assetDetachedToast'));
      void utils.maintenancePrograms.get.invalidate({ programId });
      void utils.maintenancePrograms.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const archive = trpc.maintenancePrograms.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archivedToast'));
      router.push(`/${locale}/maintenance`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function submitAddTrigger() {
    const base = { programId, title: triggerTitle.trim(), triggerType };
    if (triggerType === 'time') {
      addTrigger.mutate({ ...base, intervalDays: Number(intervalDays) });
    } else {
      addTrigger.mutate({
        ...base,
        intervalValue: Number(intervalValue),
        unit: unit.trim(),
        usageField: usageField.trim(),
      });
    }
  }

  const addTriggerValid =
    triggerTitle.trim().length > 0 &&
    (triggerType === 'time'
      ? intervalDays !== '' && Number(intervalDays) > 0
      : intervalValue !== '' && Number(intervalValue) > 0);

  if (isLoading || data === undefined) {
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const { triggers, assets: attachedAssets } = data;
  const attachedAssetIds = new Set(attachedAssets.map((a) => a.assetId));
  const availableAssets = allAssets.filter((a) => !attachedAssetIds.has(a.id));

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

      {/* Header / editable details */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold">{t('detailsHeading')}</h2>
          <div className="space-y-1.5">
            <Label htmlFor="program-name">{t('fields.name')}</Label>
            <Input
              id="program-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              disabled={!canManage}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-description">{t('fields.description')}</Label>
            <Textarea
              id="program-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={t('fields.descriptionPlaceholder')}
              disabled={!canManage}
            />
          </div>
          {canManage ? (
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                disabled={update.isPending || name.trim().length === 0}
                onClick={() =>
                  update.mutate({ programId, name: name.trim(), description: description.trim() })
                }
              >
                {update.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                {tCommon('save')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={archive.isPending}
                onClick={() => archive.mutate({ programId })}
              >
                {tCommon('archive')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Triggers */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold">{t('triggersHeading')}</h2>

          {triggers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noTriggers')}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {triggers.map((trigger) => (
                <li
                  key={trigger.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{trigger.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {trigger.triggerType === 'time'
                        ? t('triggerSummary.time', { days: trigger.intervalDays ?? 0 })
                        : t('triggerSummary.usage', {
                            value: trigger.intervalValue ?? '0',
                            unit: trigger.unit ?? '',
                          })}
                    </p>
                  </div>
                  {canManage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('removeTrigger')}
                      disabled={removeTrigger.isPending}
                      onClick={() => removeTrigger.mutate({ triggerId: trigger.id })}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <div className="space-y-3 rounded-md border border-dashed p-4">
              <h3 className="text-sm font-medium">{t('addTriggerHeading')}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="trigger-title">{t('fields.triggerTitle')}</Label>
                  <Input
                    id="trigger-title"
                    value={triggerTitle}
                    onChange={(e) => setTriggerTitle(e.target.value)}
                    placeholder={t('fields.triggerTitlePlaceholder')}
                    maxLength={200}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trigger-type">{t('fields.triggerType')}</Label>
                  <select
                    id="trigger-type"
                    value={triggerType}
                    onChange={(e) => setTriggerType(e.target.value as TriggerType)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="time">{t('triggerType.time')}</option>
                    <option value="distance">{t('triggerType.distance')}</option>
                    <option value="usage">{t('triggerType.usage')}</option>
                  </select>
                </div>
                {triggerType === 'time' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="trigger-days">{t('fields.intervalDays')}</Label>
                    <Input
                      id="trigger-days"
                      type="number"
                      min={1}
                      value={intervalDays}
                      onChange={(e) => setIntervalDays(e.target.value)}
                      placeholder={t('fields.intervalDaysPlaceholder')}
                    />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="trigger-value">{t('fields.intervalValue')}</Label>
                      <Input
                        id="trigger-value"
                        type="number"
                        min={1}
                        value={intervalValue}
                        onChange={(e) => setIntervalValue(e.target.value)}
                        placeholder={t('fields.intervalValuePlaceholder')}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="trigger-unit">{t('fields.unit')}</Label>
                      <Input
                        id="trigger-unit"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        placeholder={t('fields.unitPlaceholder')}
                        maxLength={50}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="trigger-field">{t('fields.usageField')}</Label>
                      <Input
                        id="trigger-field"
                        value={usageField}
                        onChange={(e) => setUsageField(e.target.value)}
                        placeholder={t('fields.usageFieldPlaceholder')}
                        maxLength={200}
                      />
                    </div>
                  </>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                disabled={addTrigger.isPending || !addTriggerValid}
                onClick={submitAddTrigger}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {t('addTriggerButton')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Attached assets */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold">{t('assetsHeading')}</h2>

          {attachedAssets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noAssets')}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {attachedAssets.map((asset) => (
                <li key={asset.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <Link
                    href={`/${locale}/assets/${asset.assetId}`}
                    className="font-medium hover:underline"
                  >
                    {asset.assetName ?? asset.assetId}
                  </Link>
                  {canManage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={detachAsset.isPending}
                      onClick={() => detachAsset.mutate({ programId, assetId: asset.assetId })}
                    >
                      {t('detach')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="attach-asset">{t('attachAssetLabel')}</Label>
                <select
                  id="attach-asset"
                  value={attachAssetId}
                  onChange={(e) => setAttachAssetId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{t('selectAsset')}</option>
                  {availableAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                disabled={attachAsset.isPending || attachAssetId === ''}
                onClick={() => attachAsset.mutate({ programId, assetId: attachAssetId })}
              >
                {t('attachAssetButton')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
