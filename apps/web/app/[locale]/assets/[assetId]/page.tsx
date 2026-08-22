'use client';

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Camera,
  ClipboardCheck,
  ImageIcon,
  ListChecks,
  Loader2,
  Pencil,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { appConfirm } from '../../../../src/components/ui/app-confirm';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { TooltipIconButton } from '../../../../src/components/ui/tooltip-icon-button';
import { DetailNotFound } from '../../../../src/components/detail-not-found';
import { TemplatePickerDialog } from '../../../../src/components/inspections/template-picker-dialog';
import { Textarea } from '../../../../src/components/ui/textarea';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { AssetContractorsSection } from '../../../../src/components/contractors/contractor-assets';
import { cn } from '../../../../src/lib/cn';
import { usePlaceTerms } from '../../../../src/lib/terminology';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../../../../src/lib/brand';
import {
  AssetActivityList,
  buildActivityRows,
  type ActivityKind,
} from '../../../../src/components/assets/asset-activity';
import {
  CustomFieldInputs,
  CustomFieldReadout,
  customFieldsOf,
  customFieldValuesOf,
  firstMissingRequired,
  type CustomFieldValues,
} from '../../../../src/components/assets/custom-field-inputs';
import { trpc } from '../../../../src/lib/trpc/client';
import { formatDate, formatDateTime } from '../../../../src/lib/format-date';
import { useServerErrorToast } from '../../../../src/lib/use-server-error';

/**
 * Four tabs, not six. Inspections, actions and observations were three
 * separate tabs each holding one thin table; none of them answered "what
 * is happening with this asset" on its own, so they merge into Activity
 * and the overview summarises the lot.
 */
type Tab = 'overview' | 'activity' | 'readings' | 'media';

/** Type chips on the Activity tab. */
const ACTIVITY_FILTERS = ['all', 'inspection', 'action', 'observation'] as const;

export default function AssetDetailPage() {
  const t = useTranslations('assets.detail');
  const tCommon = useTranslations('common');
  const tActionStatus = useTranslations('actions.status');
  const tInspectionStatus = useTranslations('inspections.status');
  const tIssueStatus = useTranslations('issues.status');
  const onServerError = useServerErrorToast(tCommon('error'));
  const params = useParams<{ locale: string; assetId: string }>();
  const locale = params.locale ?? 'en';
  const assetId = params.assetId ?? '';
  const utils = trpc.useUtils();

  const canManage = useHasPermission('assets.manage');
  const canRecord = useHasPermission('assets.readings.record');
  const canCreateActions = useHasPermission('actions.create');
  // `inspections.conduct` — the same key `inspections.create` requires
  // server-side, so the button is never offered to someone the router
  // would then refuse.
  const canConductInspections = useHasPermission('inspections.conduct');
  const canViewContractors = useHasPermission('contractors.view');
  // PF-17: the fire logbook can target this asset — show its service
  // history here so extinguisher #12 is one page, not two systems.
  const hasFireView = useHasPermission('fireSafety.view');
  const canViewFire = brandHasModule(activeBrand.id, 'fireSafety') && hasFireView;
  const canLinkContractors = useHasPermission('contractors.manage');
  const { label: placeLabel, noneLabel: placeNone } = usePlaceTerms();

  // Localise enum labels; fall back gracefully for any unexpected value.
  const inspectionStatusLabel = (s: string): string =>
    s === 'in_progress' ||
    s === 'awaiting_signatures' ||
    s === 'awaiting_approval' ||
    s === 'completed' ||
    s === 'rejected'
      ? tInspectionStatus(s)
      : s.replace(/_/g, ' ');
  const issueStatusLabel = (s: string): string =>
    s === 'open' || s === 'investigation' || s === 'closed' ? tIssueStatus(s) : s;

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
  const [editCustomFieldValues, setEditCustomFieldValues] = useState<CustomFieldValues>({});
  const [activityFilter, setActivityFilter] = useState<'all' | ActivityKind>('all');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showInspectionPicker, setShowInspectionPicker] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = trpc.assets.get.useQuery({ assetId });
  // Loaded unconditionally: read mode needs the type definition to show
  // the custom fields, and edit mode needs it to swap the field set the
  // moment the type changes.
  const { data: assetTypesList } = trpc.assetTypes.list.useQuery();
  const { data: readingsData } = trpc.assets.readings.list.useQuery(
    { assetId },
    { enabled: tab === 'readings' || tab === 'overview' },
  );
  const fireHistory = trpc.fireSafety.logbook.assetHistory.useQuery(
    { assetId },
    { enabled: assetId !== '' && canViewFire },
  );
  const { data: linkedInspections, isLoading: inspectionsLoading } =
    trpc.assets.listLinkedInspections.useQuery(
      { assetId },
      { enabled: tab === 'activity' || tab === 'overview' },
    );
  const { data: linkedActions, isLoading: actionsLoading } = trpc.assets.listLinkedActions.useQuery(
    { assetId },
    { enabled: tab === 'activity' || tab === 'overview' },
  );
  const { data: linkedObservations, isLoading: observationsLoading } =
    trpc.assets.listLinkedObservations.useQuery(
      { assetId },
      { enabled: tab === 'activity' || tab === 'overview' },
    );

  const update = trpc.assets.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      setEditing(false);
      void utils.assets.get.invalidate({ assetId });
      void utils.assets.list.invalidate();
    },
    onError: onServerError,
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
    onError: onServerError,
  });

  const archive = trpc.assets.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      void utils.assets.get.invalidate({ assetId });
    },
    onError: onServerError,
  });

  const restore = trpc.assets.restore.useMutation({
    onSuccess: () => {
      toast.success(t('restoreToast'));
      void utils.assets.get.invalidate({ assetId });
    },
    onError: onServerError,
  });

  // The fields the CURRENTLY SELECTED type defines. In edit mode this
  // follows the dropdown, so choosing a new type immediately offers that
  // type's fields — the whole point of the fix. In read mode it follows
  // the saved type.
  // One merged, newest-first stream. The overview shows the head of it;
  // the Activity tab shows all of it with type filters.
  const activityRows = buildActivityRows({
    locale,
    inspections: linkedInspections ?? [],
    actions: linkedActions ?? [],
    observations: linkedObservations ?? [],
  });
  const filteredActivity =
    activityFilter === 'all' ? activityRows : activityRows.filter((r) => r.kind === activityFilter);
  const activityLoading = inspectionsLoading || actionsLoading || observationsLoading;

  /** Each module owns its status vocabulary; keep all three translated. */
  const activityStatusLabel = (kind: ActivityKind, status: string): string => {
    if (kind === 'inspection') return inspectionStatusLabel(status);
    if (kind === 'observation') return issueStatusLabel(status);
    return status === 'open' ||
      status === 'in_progress' ||
      status === 'completed' ||
      status === 'cancelled'
      ? tActionStatus(status)
      : status.replace(/_/g, ' ');
  };

  const editCustomFields = customFieldsOf(
    (assetTypesList ?? []).find((at) => at.id === editTypeId) ?? null,
  );
  const savedCustomFields = customFieldsOf(data?.assetType ?? null);
  const savedCustomFieldValues = data === undefined ? {} : customFieldValuesOf(data.asset);

  function setCustomFieldValue(fieldId: string, value: string) {
    setEditCustomFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function startEditing() {
    if (data === undefined) return;
    const { asset } = data;
    setEditName(asset.name);
    setEditDescription(asset.description ?? '');
    setEditTypeId(asset.typeId ?? '');
    setEditSiteId(asset.siteId ?? '');
    setEditOwnerUserId(asset.ownerUserId ?? '');
    setEditCustomFieldValues(customFieldValuesOf(asset));
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
  }

  function saveEditing() {
    // Required fields mean the same thing here as on create.
    const missing = firstMissingRequired(editCustomFields, editCustomFieldValues);
    if (missing !== null) {
      toast.error(t('fieldRequired', { name: missing.name }));
      return;
    }
    update.mutate({
      assetId,
      name: editName.trim(),
      description: editDescription,
      typeId: editTypeId === '' ? null : editTypeId,
      siteId: editSiteId === '' ? null : editSiteId,
      ownerUserId: editOwnerUserId === '' ? null : editOwnerUserId,
      // `customFieldValues` replaces the whole map, so values belonging to
      // a PREVIOUS type are carried through rather than destroyed: switch
      // a car back to a pump and its pump readings are still there.
      customFieldValues: editCustomFieldValues,
    });
  }

  async function handlePhotoUpload(file: File) {
    // Matches the asset-photo route's own 10 MB cap, so the client refuses
    // before a doomed round-trip.
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('photoTooLarge'));
      return;
    }
    setPhotoUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      // DC-S02: this posted an asset PHOTO to the documents upload route,
      // which files it under `<tenant>/documents/...` and — once that route
      // gained the permission check it was missing — needs
      // `documents.manage`. There has always been a dedicated route for
      // this, gated on `assets.manage` (now capped at 10 MB for phone shots).
      const res = await fetch('/api/upload/asset-photo', { method: 'POST', body: form });
      if (!res.ok) throw new Error('upload-failed');
      const json = (await res.json()) as { key: string };
      update.mutate({ assetId, photoKey: json.key });
      void utils.assets.get.invalidate({ assetId });
      void utils.assets.list.invalidate();
    } catch {
      toast.error(t('photoUploadError'));
    } finally {
      setPhotoUploading(false);
    }
  }

  if (isLoading || data === undefined) {
    if (error !== null && error !== undefined) {
      return <DetailNotFound error={error} />;
    }
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const { asset, assetType, siteName, ownerName, childrenCount, latestReadings } = data;
  const isArchived = asset.archivedAt !== null;

  // The create-action page pre-selects both from the query string, so the
  // action arrives already linked to this asset (and its place) rather than
  // asking the user to find it again in a picker.
  const raiseActionHref =
    `/${locale}/actions/new?asset=${encodeURIComponent(assetId)}` +
    (asset.siteId !== null ? `&site=${encodeURIComponent(asset.siteId)}` : '');

  const TABS: Tab[] = ['overview', 'activity', 'readings', 'media'];

  return (
    <div className="space-y-6">
      {/* The file input the photo buttons drive. It lives here, outside the
          tabs, because the Overview card has an "Add a photo" button too and
          the input used to be rendered only inside the Media tab — so on
          Overview `photoInputRef.current` was null and the click did
          nothing at all, with no error to explain it. */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file !== undefined) void handlePhotoUpload(file);
          e.target.value = '';
        }}
      />

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
          {/* G1 / ADR 0014: the utility actions are icons, as they are on the
              register; the two things a person actually came here to DO —
              raise an action against this asset, inspect it — are the
              primary buttons. */}
          <div className="flex items-center gap-2">
            {canManage && !editing ? (
              <TooltipIconButton icon={Pencil} label={tCommon('edit')} onClick={startEditing} />
            ) : null}
            {canManage ? (
              <TooltipIconButton
                icon={isArchived ? ArchiveRestore : Archive}
                label={isArchived ? tCommon('restore') : tCommon('archive')}
                disabled={archive.isPending || restore.isPending}
                onClick={() => {
                  if (isArchived) {
                    restore.mutate({ assetId });
                    return;
                  }
                  void appConfirm({ description: t('archiveConfirm'), destructive: true }).then(
                    (ok) => {
                      if (ok) archive.mutate({ assetId });
                    },
                  );
                }}
              />
            ) : null}
            {/* Both are hidden on an archived asset: it is out of service, so
                inspecting it or raising work against it is not the offer. */}
            {canCreateActions && !isArchived ? (
              <Button asChild size="sm">
                <Link href={raiseActionHref}>
                  <ListChecks className="mr-1.5 h-4 w-4" />
                  {t('raiseAction')}
                </Link>
              </Button>
            ) : null}
            {canConductInspections && !isArchived ? (
              <Button type="button" size="sm" onClick={() => setShowInspectionPicker(true)}>
                <ClipboardCheck className="mr-1.5 h-4 w-4" />
                {t('startInspection')}
              </Button>
            ) : null}
          </div>
        </div>

        <nav className="flex flex-wrap gap-1 border-b border-slate-300 dark:border-slate-700">
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

                {/* The selected type's custom fields. These existed only on
                    the create page, so changing an asset's type to one that
                    defines fields left no way to fill them in — and a value
                    typed at creation was never editable again. */}
                {editCustomFields.length > 0 ? (
                  <div className="space-y-4 border-t pt-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('fields.customFieldsHeading')}
                    </p>
                    <CustomFieldInputs
                      fields={editCustomFields}
                      values={editCustomFieldValues}
                      onChange={setCustomFieldValue}
                      idPrefix="edit-cf"
                    />
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label>{placeLabel}</Label>
                  <SiteSelector
                    value={editSiteId !== '' ? [editSiteId] : []}
                    onChange={(next) => setEditSiteId(next[0] ?? '')}
                    multiple={false}
                    placeholder={placeNone}
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
                      <Link
                        href={`/${locale}/assets/${asset.parentId}`}
                        className="hover:underline"
                      >
                        {asset.parentId.slice(-8)}
                      </Link>
                    </DetailRow>
                  ) : null}
                  <DetailRow label={t('fields.children')}>{String(childrenCount)}</DetailRow>

                  {/* The type's custom fields. Before this they were visible
                      nowhere after creation, so a value could not be read
                      back or corrected. An unanswered field shows a dash
                      rather than vanishing — it is a prompt to go and fill
                      it in, which is exactly what a type change produces. */}
                  {savedCustomFields.length > 0 ? (
                    <div className="space-y-3 border-t pt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t('fields.customFieldsHeading')}
                      </p>
                      <CustomFieldReadout
                        fields={savedCustomFields}
                        values={savedCustomFieldValues}
                        emptyLabel={t('fields.customFieldEmpty')}
                      />
                      {canManage &&
                      firstMissingRequired(savedCustomFields, savedCustomFieldValues) !== null ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          {t('fields.customFieldsIncomplete')}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 p-6 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">{t('latestReadingsHeading')}</h2>
                    <button
                      type="button"
                      onClick={() => setTab('readings')}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {t('viewAll')}
                    </button>
                  </div>
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

            {/* Activity + media summaries, so the overview answers "what is
                happening with this asset" without a tab hop. Each card is a
                head-of-list with a way through to the full view. */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between gap-2 border-b p-4">
                    <h2 className="text-base font-semibold">{t('activity.heading')}</h2>
                    {activityRows.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setTab('activity')}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {t('viewAllCount', { count: activityRows.length })}
                      </button>
                    ) : null}
                  </div>
                  {activityLoading ? (
                    <div className="space-y-2 p-4">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                      ))}
                    </div>
                  ) : (
                    <AssetActivityList
                      rows={activityRows}
                      limit={5}
                      emptyLabel={t('activity.empty.all')}
                      statusLabel={activityStatusLabel}
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between gap-2 border-b p-4">
                    <h2 className="text-base font-semibold">{t('media.heading')}</h2>
                    <button
                      type="button"
                      onClick={() => setTab('media')}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {t('viewAll')}
                    </button>
                  </div>
                  {asset.photoKey === null ? (
                    <div className="flex flex-col items-center gap-2 p-8 text-center">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                      <p className="text-sm text-muted-foreground">{t('media.empty')}</p>
                      {canManage && !isArchived ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={photoUploading}
                          onClick={() => photoInputRef.current?.click()}
                        >
                          {t('media.addPhoto')}
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTab('media')}
                      className="block w-full p-4"
                    >
                      {/* R2 blob behind the session-gated /api/files proxy —
                          next/image cannot sign that URL, same as the other
                          asset photos on this page. */}
                      <img
                        src={`/api/files?key=${encodeURIComponent(asset.photoKey)}`}
                        alt={asset.name}
                        className="h-40 w-full rounded-md object-cover"
                      />
                    </button>
                  )}
                </CardContent>
              </Card>
            </div>

            {canViewContractors ? (
              <AssetContractorsSection assetId={assetId} canManage={canLinkContractors} />
            ) : null}
            {/* PF-17: fire logbook history for this asset. */}
            {canViewFire && (fireHistory.data?.checks.length ?? 0) > 0 ? (
              <Card>
                <CardContent className="space-y-2 p-6">
                  <h2 className="text-base font-semibold">{t('fireHistory.heading')}</h2>
                  <ul className="space-y-1 text-sm">
                    {(fireHistory.data?.checks ?? []).map((c) => (
                      <li key={c.id} className="text-muted-foreground">
                        {t('fireHistory.checkLine', {
                          type: c.checkType.replace(/_/g, ' '),
                          building: c.buildingName,
                        })}
                      </li>
                    ))}
                  </ul>
                  {(fireHistory.data?.entries ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('fireHistory.empty')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b bg-muted/40 text-left">
                          <tr>
                            <th className="px-3 py-2 font-medium">
                              {t('fireHistory.performedAt')}
                            </th>
                            <th className="px-3 py-2 font-medium">{t('fireHistory.type')}</th>
                            <th className="px-3 py-2 font-medium">{t('fireHistory.result')}</th>
                            <th className="px-3 py-2 font-medium">{t('fireHistory.notes')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(fireHistory.data?.entries ?? []).slice(0, 20).map((e) => (
                            <tr key={e.id} className="border-b last:border-0">
                              <td className="px-3 py-2 whitespace-nowrap">
                                {formatDate(e.performedAt, locale)}
                              </td>
                              <td className="px-3 py-2">{e.checkType.replace(/_/g, ' ')}</td>
                              <td className="px-3 py-2">
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 text-xs font-medium',
                                    e.result === 'fail'
                                      ? 'bg-destructive/10 text-destructive'
                                      : e.result === 'defects_found'
                                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100'
                                        : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
                                  )}
                                >
                                  {e.result}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{e.notes}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
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
              <div className="overflow-x-auto">
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
                            {formatDateTime(r.capturedAt, locale)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {r.capturedByName ?? '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
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
                        className="absolute right-1.5 top-1.5 flex rounded-full bg-background/90 p-1.5 text-muted-foreground shadow transition-colors hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
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
      {/* ── ACTIVITY ── inspections + actions + observations, merged.
             Three tabs each showing one thin table answered nothing on
             their own; the useful view is all of it, newest first. */}
      {tab === 'activity' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {ACTIVITY_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setActivityFilter(f)}
                aria-pressed={activityFilter === f}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  activityFilter === f
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {t(`activity.filters.${f}`)}
                {f !== 'all' ? (
                  <span className="ml-1.5 tabular-nums opacity-70">
                    {activityRows.filter((r) => r.kind === f).length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <Card>
            <CardContent className="p-0">
              {activityLoading ? (
                <div className="space-y-2 p-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <AssetActivityList
                  rows={filteredActivity}
                  emptyLabel={t(`activity.empty.${activityFilter}`)}
                  statusLabel={activityStatusLabel}
                />
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Pinned to the asset's site, so the inspection starts where the
          machine is rather than nowhere. */}
      <TemplatePickerDialog
        open={showInspectionPicker}
        onOpenChange={setShowInspectionPicker}
        locale={locale}
        {...(asset.siteId !== null ? { siteId: asset.siteId } : {})}
      />
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
          ? 'border-[#234fe1] text-[#234fe1] font-semibold'
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
