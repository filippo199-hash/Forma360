'use client';

import { ArrowLeft, Camera, ImageIcon, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ActionDetailPanel } from '../../../../src/components/actions/action-detail-panel';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Sheet, SheetContent } from '../../../../src/components/ui/sheet';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { AssetContractorsSection } from '../../../../src/components/contractors/contractor-assets';
import { cn } from '../../../../src/lib/cn';
import { usePlaceTerms } from '../../../../src/lib/terminology';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type Tab =
  | 'overview'
  | 'readings'
  | 'maintenance'
  | 'media'
  | 'actions'
  | 'inspections'
  | 'observations';

export default function AssetDetailPage() {
  const t = useTranslations('assets.detail');
  const tMaintPrograms = useTranslations('maintenancePrograms');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; assetId: string }>();
  const locale = params.locale ?? 'en';
  const assetId = params.assetId ?? '';
  const utils = trpc.useUtils();

  const canManage = useHasPermission('assets.manage');
  const canRecord = useHasPermission('assets.readings.record');
  const canManageMaintenance = useHasPermission('assets.maintenance.manage');
  const canViewContractors = useHasPermission('contractors.view');
  const canLinkContractors = useHasPermission('contractors.manage');
  const { label: placeLabel } = usePlaceTerms();

  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTypeId, setEditTypeId] = useState<string>('');
  const [editSiteId, setEditSiteId] = useState<string>('');
  const [editOwnerUserId, setEditOwnerUserId] = useState<string>('');
  const [readingFieldName, setReadingFieldName] = useState('');
  const [readingValue, setReadingValue] = useState('');
  const [readingUnit, setReadingUnit] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [attachProgramId, setAttachProgramId] = useState('');
  // Maintenance action detail (opens in a side sheet, like the Actions page).
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  // Program pending detach (drives the keep/cancel-actions dialog).
  const [detachTarget, setDetachTarget] = useState<{ programId: string; name: string } | null>(
    null,
  );

  const { data, isLoading } = trpc.assets.get.useQuery({ assetId });
  const { data: assetTypesList } = trpc.assetTypes.list.useQuery(undefined, { enabled: editing });
  const { data: readingsData } = trpc.assets.readings.list.useQuery(
    { assetId },
    { enabled: tab === 'readings' },
  );
  const { data: maintenanceData, isLoading: maintenanceLoading } =
    trpc.maintenancePrograms.listForAsset.useQuery({ assetId }, { enabled: tab === 'maintenance' });
  const { data: programsListData } = trpc.maintenancePrograms.list.useQuery(undefined, {
    enabled: tab === 'maintenance' && canManageMaintenance,
  });
  const { data: linkedInspections, isLoading: inspectionsLoading } =
    trpc.assets.listLinkedInspections.useQuery({ assetId }, { enabled: tab === 'inspections' });
  const { data: linkedActions, isLoading: actionsLoading } = trpc.assets.listLinkedActions.useQuery(
    { assetId },
    { enabled: tab === 'actions' },
  );
  const { data: linkedObservations, isLoading: observationsLoading } =
    trpc.assets.listLinkedObservations.useQuery({ assetId }, { enabled: tab === 'observations' });

  const update = trpc.assets.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      setEditing(false);
      void utils.assets.get.invalidate({ assetId });
      void utils.assets.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const addReading = trpc.assets.readings.add.useMutation({
    onSuccess: () => {
      toast.success(t('readingAddedToast'));
      setReadingFieldName('');
      setReadingValue('');
      setReadingUnit('');
      void utils.assets.readings.list.invalidate({ assetId });
      void utils.assets.get.invalidate({ assetId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const archive = trpc.assets.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      void utils.assets.get.invalidate({ assetId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const restore = trpc.assets.restore.useMutation({
    onSuccess: () => {
      toast.success(t('restoreToast'));
      void utils.assets.get.invalidate({ assetId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const attachProgram = trpc.maintenancePrograms.attachAsset.useMutation({
    onSuccess: (res) => {
      toast.success(tMaintPrograms('assetAttachedToast', { count: res.actionsCreated }));
      setAttachProgramId('');
      void utils.maintenancePrograms.listForAsset.invalidate({ assetId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const detachProgram = trpc.maintenancePrograms.detachAsset.useMutation({
    onSuccess: () => {
      toast.success(tMaintPrograms('detachedToast'));
      setDetachTarget(null);
      void utils.maintenancePrograms.listForAsset.invalidate({ assetId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function startEditing() {
    if (data === undefined) return;
    const { asset } = data;
    setEditName(asset.name);
    setEditDescription(asset.description ?? '');
    setEditTypeId(asset.typeId ?? '');
    setEditSiteId(asset.siteId ?? '');
    setEditOwnerUserId(asset.ownerUserId ?? '');
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
  }

  function saveEditing() {
    update.mutate({
      assetId,
      name: editName.trim(),
      description: editDescription,
      typeId: editTypeId === '' ? null : editTypeId,
      siteId: editSiteId === '' ? null : editSiteId,
      ownerUserId: editOwnerUserId === '' ? null : editOwnerUserId,
    });
  }

  async function handlePhotoUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('photoTooLarge'));
      return;
    }
    setPhotoUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/documents/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error('upload-failed');
      const json = (await res.json()) as { storageKey: string };
      update.mutate({ assetId, photoKey: json.storageKey });
      void utils.assets.get.invalidate({ assetId });
      void utils.assets.list.invalidate();
    } catch {
      toast.error(t('photoUploadError'));
    } finally {
      setPhotoUploading(false);
    }
  }

  if (isLoading || data === undefined) {
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const { asset, assetType, siteName, ownerName, childrenCount, latestReadings } = data;
  const isArchived = asset.archivedAt !== null;

  const TABS: Tab[] = [
    'overview',
    'readings',
    'maintenance',
    'media',
    'actions',
    'inspections',
    'observations',
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/assets`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {/* Asset photo thumbnail in header */}
            {asset.photoKey !== null ? (
              <img
                src={`/api/files?key=${encodeURIComponent(asset.photoKey)}`}
                alt=""
                className="h-14 w-14 shrink-0 rounded-lg object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted shadow-sm">
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
                {isArchived ? (
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {t('archivedBadge')}
                  </span>
                ) : null}
                {assetType !== null ? (
                  <span className="rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                    {assetType.name}
                  </span>
                ) : null}
              </div>
              {asset.description !== '' ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{asset.description}</p>
              ) : null}
              {asset.qrToken !== null ? (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {t('qrLabel')}: {asset.qrToken}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canManage && !editing ? (
              <Button type="button" variant="outline" size="sm" onClick={startEditing}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {tCommon('edit')}
              </Button>
            ) : null}
            {canManage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (isArchived) restore.mutate({ assetId });
                  else archive.mutate({ assetId });
                }}
                disabled={archive.isPending || restore.isPending}
              >
                {isArchived ? tCommon('restore' as never) : tCommon('archive')}
              </Button>
            ) : null}
          </div>
        </div>

        <nav className="flex flex-wrap gap-1 border-b">
          {TABS.map((t_) => (
            <TabButton
              key={t_}
              active={tab === t_}
              onClick={() => {
                setEditing(false);
                setTab(t_);
              }}
              label={t(`tabs.${t_}`)}
            />
          ))}
        </nav>
      </header>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' ? (
        editing ? (
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="text-base font-semibold">{t('editHeading')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="edit-name">{t('fields.name')}</Label>
                  <Input
                    id="edit-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={500}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="edit-description">{t('fields.description')}</Label>
                  <Textarea
                    id="edit-description"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder={t('fields.descriptionPlaceholder')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-type">{t('fields.type')}</Label>
                  <select
                    id="edit-type"
                    value={editTypeId}
                    onChange={(e) => setEditTypeId(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">{t('fields.noType')}</option>
                    {(assetTypesList ?? []).map((at) => (
                      <option key={at.id} value={at.id}>
                        {at.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>{placeLabel}</Label>
                  <SiteSelector
                    value={editSiteId !== '' ? [editSiteId] : []}
                    onChange={(next) => setEditSiteId(next[0] ?? '')}
                    multiple={false}
                    placeholder={t('fields.noSite')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('fields.owner')}</Label>
                  <GroupUserSelector
                    mode="users"
                    multiple={false}
                    value={editOwnerUserId !== '' ? [editOwnerUserId] : []}
                    onChange={(next) => setEditOwnerUserId(next[0] ?? '')}
                    placeholder={t('fields.ownerPlaceholder')}
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  disabled={update.isPending || editName.trim().length === 0}
                  onClick={saveEditing}
                >
                  {update.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  {tCommon('save')}
                </Button>
                <Button type="button" variant="ghost" onClick={cancelEditing}>
                  <X className="mr-1.5 h-4 w-4" />
                  {tCommon('cancel')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="space-y-3 p-6 text-sm">
                <h2 className="text-base font-semibold">{t('detailsHeading')}</h2>
                {asset.description !== '' ? (
                  <p className="text-muted-foreground">{asset.description}</p>
                ) : null}
                <DetailRow label={t('fields.type')}>{assetType?.name ?? '—'}</DetailRow>
                <DetailRow label={placeLabel}>{siteName ?? '—'}</DetailRow>
                <DetailRow label={t('fields.owner')}>{ownerName ?? '—'}</DetailRow>
                {asset.parentId !== null ? (
                  <DetailRow label={t('fields.parent')}>
                    <Link href={`/${locale}/assets/${asset.parentId}`} className="hover:underline">
                      {asset.parentId.slice(-8)}
                    </Link>
                  </DetailRow>
                ) : null}
                <DetailRow label={t('fields.children')}>{String(childrenCount)}</DetailRow>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 p-6 text-sm">
                <h2 className="text-base font-semibold">{t('latestReadingsHeading')}</h2>
                {latestReadings.length === 0 ? (
                  <p className="text-muted-foreground">{t('noReadings')}</p>
                ) : (
                  latestReadings.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0"
                    >
                      <span className="font-medium">{r.fieldName}</span>
                      <span>
                        {r.value} {r.unit}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            </div>
            {canViewContractors ? (
              <AssetContractorsSection assetId={assetId} canManage={canLinkContractors} />
            ) : null}
          </div>
        )
      ) : null}

      {/* ── READINGS ── */}
      {tab === 'readings' ? (
        <div className="space-y-4">
          {canRecord && !isArchived ? (
            <Card>
              <CardContent className="p-6">
                <h2 className="mb-4 text-base font-semibold">{t('addReadingHeading')}</h2>
                <div className="flex flex-wrap gap-3">
                  <Input
                    placeholder={t('readingFieldNamePlaceholder')}
                    value={readingFieldName}
                    onChange={(e) => setReadingFieldName(e.target.value)}
                    maxLength={200}
                    className="w-40"
                  />
                  <Input
                    type="number"
                    placeholder={t('readingValuePlaceholder')}
                    value={readingValue}
                    onChange={(e) => setReadingValue(e.target.value)}
                    className="w-32"
                  />
                  <Input
                    placeholder={t('readingUnitPlaceholder')}
                    value={readingUnit}
                    onChange={(e) => setReadingUnit(e.target.value)}
                    maxLength={50}
                    className="w-24"
                  />
                  <Button
                    type="button"
                    disabled={
                      addReading.isPending ||
                      readingFieldName.trim().length === 0 ||
                      readingValue === ''
                    }
                    onClick={() =>
                      addReading.mutate({
                        assetId,
                        fieldName: readingFieldName.trim(),
                        value: Number(readingValue),
                        unit: readingUnit.trim(),
                        source: 'manual',
                      })
                    }
                  >
                    {t('addReadingButton')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">{t('readingColumns.field')}</th>
                    <th className="px-3 py-2 font-medium">{t('readingColumns.value')}</th>
                    <th className="px-3 py-2 font-medium">{t('readingColumns.source')}</th>
                    <th className="px-3 py-2 font-medium">{t('readingColumns.capturedAt')}</th>
                    <th className="px-3 py-2 font-medium">{t('readingColumns.capturedBy')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(readingsData ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
                        {t('noReadings')}
                      </td>
                    </tr>
                  ) : (
                    (readingsData ?? []).map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">{r.fieldName}</td>
                        <td className="px-3 py-2">
                          {r.value} {r.unit}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.source}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(r.capturedAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.capturedByName ?? '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ── MAINTENANCE ── */}
      {tab === 'maintenance' ? (
        <div className="space-y-4">
          {/* Attach a maintenance program */}
          {canManageMaintenance ? (
            <Card>
              <CardContent className="flex flex-wrap items-end gap-2 p-6">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="attach-program">{tMaintPrograms('attachProgramLabel')}</Label>
                  <select
                    id="attach-program"
                    value={attachProgramId}
                    onChange={(e) => setAttachProgramId(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">{tMaintPrograms('selectProgram')}</option>
                    {(programsListData?.programs ?? [])
                      .filter(
                        (p) =>
                          !(maintenanceData?.programs ?? []).some((ap) => ap.programId === p.id),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </div>
                <Button
                  type="button"
                  disabled={attachProgram.isPending || attachProgramId === ''}
                  onClick={() => attachProgram.mutate({ programId: attachProgramId, assetId })}
                >
                  {tMaintPrograms('attachProgramButton')}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {maintenanceLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              {/* Attached programs */}
              <Card>
                <CardContent className="space-y-2 p-6">
                  <h2 className="text-base font-semibold">
                    {tMaintPrograms('attachedProgramsHeading')}
                  </h2>
                  {(maintenanceData?.programs ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {tMaintPrograms('noProgramsForAsset')}
                    </p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {(maintenanceData?.programs ?? []).map((p) => (
                        <li
                          key={p.programId}
                          className="flex items-center justify-between gap-2 px-3 py-2.5"
                        >
                          <Link
                            href={`/${locale}/assets/settings/programs/${p.programId}`}
                            className="font-medium hover:underline"
                          >
                            {p.programName}
                          </Link>
                          {canManageMaintenance ? (
                            <button
                              type="button"
                              onClick={() =>
                                setDetachTarget({ programId: p.programId, name: p.programName })
                              }
                              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              aria-label={tMaintPrograms('detach')}
                              title={tMaintPrograms('detach')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Maintenance actions */}
              <Card>
                <CardContent className="p-0">
                  <div className="border-b px-6 py-3">
                    <h2 className="text-base font-semibold">
                      {tMaintPrograms('maintenanceActionsHeading')}
                    </h2>
                  </div>
                  {(maintenanceData?.actions ?? []).length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground">
                      <p className="text-sm">{tMaintPrograms('noMaintenanceActions')}</p>
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/40">
                        <tr className="text-left">
                          <th className="px-3 py-2 font-medium">
                            {tMaintPrograms('actionColumns.title')}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {tMaintPrograms('actionColumns.detail')}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {tMaintPrograms('actionColumns.status')}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {tMaintPrograms('actionColumns.dueAt')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(maintenanceData?.actions ?? []).map((action) => (
                          <tr key={action.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="px-3 py-2 font-medium">
                              <button
                                type="button"
                                onClick={() => setSelectedActionId(action.id)}
                                className="text-left hover:underline"
                              >
                                {action.referenceNumber !== null ? (
                                  <span className="mr-1 text-xs text-muted-foreground">
                                    {action.referenceNumber}
                                  </span>
                                ) : null}
                                {action.title}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {action.description !== '' ? action.description : '—'}
                            </td>
                            <td className="px-3 py-2 capitalize text-muted-foreground">
                              {action.status.replace(/_/g, ' ')}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {action.dueAt !== null
                                ? new Date(action.dueAt).toLocaleDateString()
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      ) : null}

      {/* ── MEDIA ── */}
      {tab === 'media' ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold">{t('media.heading')}</h2>
                {canManage && !isArchived ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={photoUploading || update.isPending}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    {photoUploading ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="mr-1.5 h-4 w-4" />
                    )}
                    {asset.photoKey !== null ? t('media.changePhoto') : t('media.uploadPhoto')}
                  </Button>
                ) : null}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file !== undefined) void handlePhotoUpload(file);
                    e.target.value = '';
                  }}
                />
              </div>

              {asset.photoKey !== null ? (
                <div className="flex flex-wrap gap-4">
                  <div className="group relative">
                    <img
                      src={`/api/files?key=${encodeURIComponent(asset.photoKey)}`}
                      alt={asset.name}
                      className="h-48 w-48 rounded-lg object-cover shadow-sm"
                    />
                    {canManage && !isArchived ? (
                      <button
                        type="button"
                        aria-label={t('media.removePhoto')}
                        onClick={() => update.mutate({ assetId, photoKey: null })}
                        className="absolute right-1.5 top-1.5 hidden rounded-full bg-background/80 p-1 shadow group-hover:flex"
                      >
                        <X className="h-3.5 w-3.5 text-destructive" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground">
                  <ImageIcon className="h-8 w-8" />
                  <p className="text-sm">{t('media.noPhoto')}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ── ACTIONS ── */}
      {tab === 'actions' ? (
        <Card>
          <CardContent className="p-0">
            {actionsLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !linkedActions || linkedActions.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <p className="text-sm">{t('empty.actions')}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-medium">{t('cols.title')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('cols.status')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('cols.priority')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('cols.dueAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedActions.map((a) => (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <Link href={`/${locale}/actions/${a.id}`} className="hover:underline">
                          {a.referenceNumber ? (
                            <span className="mr-1 text-xs text-muted-foreground">
                              {a.referenceNumber}
                            </span>
                          ) : null}
                          {a.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2 capitalize">{a.status}</td>
                      <td className="px-4 py-2 capitalize">{a.priority ?? '—'}</td>
                      <td className="px-4 py-2">
                        {a.dueAt ? new Date(a.dueAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ── INSPECTIONS ── */}
      {tab === 'inspections' ? (
        <Card>
          <CardContent className="p-0">
            {inspectionsLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !linkedInspections || linkedInspections.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <p className="text-sm">{t('empty.inspections')}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-medium">{t('cols.title')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('cols.status')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('cols.docNumber')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('cols.startedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedInspections.map((ins) => (
                    <tr
                      key={`${ins.id}-${ins.questionId}`}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-2">
                        <Link href={`/${locale}/inspections/${ins.id}`} className="hover:underline">
                          {ins.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2 capitalize">{ins.status.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2">{ins.documentNumber ?? '—'}</td>
                      <td className="px-4 py-2">
                        {ins.startedAt ? new Date(ins.startedAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ── OBSERVATIONS ── */}
      {tab === 'observations' ? (
        <Card>
          <CardContent className="p-0">
            {observationsLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !linkedObservations || linkedObservations.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <p className="text-sm">{t('empty.observations')}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-medium">{t('cols.title')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('cols.status')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('cols.priority')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('cols.createdAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedObservations.map((obs) => (
                    <tr key={obs.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <Link
                          href={`/${locale}/observations/${obs.id}`}
                          className="hover:underline"
                        >
                          {obs.referenceNumber ? (
                            <span className="mr-1 text-xs text-muted-foreground">
                              {obs.referenceNumber}
                            </span>
                          ) : null}
                          {obs.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2 capitalize">{obs.status}</td>
                      <td className="px-4 py-2 capitalize">{obs.priority ?? '—'}</td>
                      <td className="px-4 py-2">
                        {obs.createdAt ? new Date(obs.createdAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Detach-program confirm — keep or cancel the asset's open actions. */}
      <Dialog open={detachTarget !== null} onOpenChange={(o) => !o && setDetachTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tMaintPrograms('detachTitle')}</DialogTitle>
            <DialogDescription>
              {tMaintPrograms('detachBody', { name: detachTarget?.name ?? '' })}{' '}
              {tMaintPrograms('detachExplain')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              disabled={detachProgram.isPending}
              onClick={() =>
                detachTarget !== null &&
                detachProgram.mutate({
                  programId: detachTarget.programId,
                  assetId,
                  cancelOpenActions: false,
                })
              }
            >
              {tMaintPrograms('detachKeep')}
            </Button>
            <Button
              variant="destructive"
              disabled={detachProgram.isPending}
              onClick={() =>
                detachTarget !== null &&
                detachProgram.mutate({
                  programId: detachTarget.programId,
                  assetId,
                  cancelOpenActions: true,
                })
              }
            >
              {tMaintPrograms('detachCancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Maintenance action detail — opens in a side sheet, no page change. */}
      <Sheet
        open={selectedActionId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setSelectedActionId(null);
            // Reflect any status change (complete → roll-forward, cancel, etc.).
            void utils.maintenancePrograms.listForAsset.invalidate({ assetId });
          }
        }}
      >
        <SheetContent className="w-full p-0 sm:max-w-2xl" side="right">
          {selectedActionId !== null ? (
            <ActionDetailPanel actionId={selectedActionId} locale={locale} />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-foreground text-foreground font-semibold'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[110px_1fr]">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}
