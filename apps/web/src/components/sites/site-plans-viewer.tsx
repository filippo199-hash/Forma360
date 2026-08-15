'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ClipboardCheck,
  Image as ImageIcon,
  Layers,
  MapPin,
  Maximize2,
  Minus,
  Plus,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toast } from 'sonner';
import { cn } from '../../lib/cn';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Sheet, SheetContent } from '../ui/sheet';
import { Skeleton } from '../ui/skeleton';

// 'note' is retained for rendering legacy pins but is no longer offered.
type EntityType = 'note' | 'observation' | 'asset' | 'media' | 'inspection';

const ENTITY_META: Record<EntityType, { color: string; ring: string; Icon: typeof MapPin }> = {
  note: { color: 'bg-slate-500', ring: 'ring-slate-300', Icon: MapPin },
  observation: { color: 'bg-amber-500', ring: 'ring-amber-300', Icon: AlertTriangle },
  asset: { color: 'bg-blue-500', ring: 'ring-blue-300', Icon: Wrench },
  media: { color: 'bg-purple-500', ring: 'ring-purple-300', Icon: ImageIcon },
  inspection: { color: 'bg-emerald-500', ring: 'ring-emerald-300', Icon: ClipboardCheck },
};

// Pin types shown in the view filter (legacy inspection/note pins still
// render under "All").
const FILTER_TYPES: readonly Exclude<EntityType, 'note' | 'inspection'>[] = [
  'observation',
  'asset',
  'media',
];

// What a user can drop: link/create an observation, link/create an asset,
// or upload a photo (which auto-tags).
type CreateType = 'observation' | 'asset' | 'photo';
const CREATE_TYPES: readonly CreateType[] = ['observation', 'asset', 'photo'];
const NEW = '__new__';

const SELECT_CLS = 'block w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

function fileUrl(storageKey: string): string {
  return `/api/files?key=${encodeURIComponent(storageKey)}`;
}

export function SitePlansViewer({ siteId }: { siteId: string }) {
  const t = useTranslations('sites');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('sites.manage');
  const utils = trpc.useUtils();
  const planFileRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const { data: plans = [], isLoading: plansLoading } = trpc.sitePlans.listPlans.useQuery({
    siteId,
  });
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const activePlanId = selectedPlanId ?? plans[0]?.id ?? null;
  const activePlan = plans.find((p) => p.id === activePlanId) ?? null;

  const { data: pins = [] } = trpc.sitePlans.listPins.useQuery(
    { planId: activePlanId ?? '' },
    { enabled: activePlanId !== null },
  );

  const [uploading, setUploading] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [typeFilter, setTypeFilter] = useState<EntityType | null>(null);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [hoverPin, setHoverPin] = useState<{
    id: string;
    label: string;
    entityType: string;
    left: number;
    top: number;
  } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  // Pin-create dialog state
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [draftType, setDraftType] = useState<CreateType>('observation');
  const [linkId, setLinkId] = useState<string>(''); // existing entity id, or NEW
  const [newObs, setNewObs] = useState({ title: '', categoryId: '', description: '' });
  const [newAsset, setNewAsset] = useState({ name: '', typeId: '' });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoLabel, setPhotoLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function resetDraft() {
    setDraft(null);
    setDraftType('observation');
    setLinkId('');
    setNewObs({ title: '', categoryId: '', description: '' });
    setNewAsset({ name: '', typeId: '' });
    setPhotoFile(null);
    setPhotoLabel('');
  }

  // Pan/zoom
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [smooth, setSmooth] = useState(false);
  const panRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  const createPlan = trpc.sitePlans.createPlan.useMutation();
  const renamePlan = trpc.sitePlans.renamePlan.useMutation({
    onSuccess: () => {
      void utils.sitePlans.listPlans.invalidate({ siteId });
      toast.success(t('editSavedToast'));
    },
  });
  const reorderPlan = trpc.sitePlans.reorderPlan.useMutation();
  const archivePlan = trpc.sitePlans.archivePlan.useMutation({
    onSuccess: () => {
      void utils.sitePlans.listPlans.invalidate({ siteId });
      void utils.sites.getHub.invalidate({ id: siteId });
      setSelectedPlanId(null);
      toast.success(t('planDeletedToast'));
    },
  });
  const createPin = trpc.sitePlans.createPin.useMutation({
    onSuccess: () => {
      if (activePlanId !== null) void utils.sitePlans.listPins.invalidate({ planId: activePlanId });
      resetDraft();
    },
  });
  const archivePin = trpc.sitePlans.archivePin.useMutation({
    onSuccess: () => {
      if (activePlanId !== null) void utils.sitePlans.listPins.invalidate({ planId: activePlanId });
      setActivePinId(null);
    },
  });
  const createIssue = trpc.issues.issues.create.useMutation();
  const createAsset = trpc.assets.create.useMutation();
  const createMediaRow = trpc.siteMedia.create.useMutation();

  // Option lists — loaded only while the create dialog is open.
  const optsEnabled = draft !== null;
  const { data: obsList } = trpc.issues.issues.list.useQuery(
    { siteId },
    { enabled: optsEnabled && draftType === 'observation' },
  );
  const { data: categories } = trpc.issues.categories.list.useQuery(
    {},
    { enabled: optsEnabled && draftType === 'observation' },
  );
  const { data: assetList } = trpc.assets.list.useQuery(
    { siteId },
    { enabled: optsEnabled && draftType === 'asset' },
  );
  const { data: assetTypeList } = trpc.assetTypes.list.useQuery(
    {},
    { enabled: optsEnabled && draftType === 'asset' },
  );

  const obsOptions = useMemo(
    () =>
      (obsList?.items ?? [])
        .filter((o) => o.status !== 'closed')
        .map((o) => ({ id: o.id, label: o.title })),
    [obsList],
  );
  const assetOptions = useMemo(
    () => (assetList?.assets ?? []).map((a) => ({ id: a.id, label: a.name })),
    [assetList],
  );

  const visiblePins = typeFilter === null ? pins : pins.filter((p) => p.entityType === typeFilter);
  const activePin = activePinId === null ? null : (pins.find((p) => p.id === activePinId) ?? null);

  async function handlePlanUpload(files: FileList | null) {
    const file = files?.[0];
    if (file === undefined) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set('siteId', siteId);
      form.set('file', file);
      const res = await fetch('/api/upload/site-plan', { method: 'POST', body: form });
      if (!res.ok) {
        toast.error(t('planUploadError'));
        return;
      }
      const body = (await res.json()) as { storageKey: string; filename: string; mimeType: string };
      const created = await createPlan.mutateAsync({
        siteId,
        name: t('planDefaultName', { n: plans.length + 1 }),
        storageKey: body.storageKey,
        mimeType: body.mimeType,
      });
      await utils.sitePlans.listPlans.invalidate({ siteId });
      await utils.sites.getHub.invalidate({ id: siteId });
      setSelectedPlanId(created.id);
    } finally {
      setUploading(false);
      if (planFileRef.current !== null) planFileRef.current.value = '';
    }
  }

  function onImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!addMode || imgRef.current === null) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setDraft({ x, y });
    setAddMode(false);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (addMode) return;
    setSmooth(false);
    panRef.current = { startX: e.clientX, startY: e.clientY, ox: tx, oy: ty };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current === null) return;
    setTx(panRef.current.ox + (e.clientX - panRef.current.startX));
    setTy(panRef.current.oy + (e.clientY - panRef.current.startY));
  }
  function onPointerUp() {
    panRef.current = null;
  }
  function zoomBy(factor: number) {
    setSmooth(false);
    setScale((s) => Math.min(6, Math.max(1, s * factor)));
  }
  function resetView() {
    setSmooth(true);
    setScale(1);
    setTx(0);
    setTy(0);
  }

  /** Centre the plan on a pin (normalised x,y) so it's visible beside the sheet. */
  function focusPin(px: number, py: number) {
    const cont = containerRef.current;
    const img = imgRef.current;
    if (cont === null || img === null || img.naturalWidth === 0) return;
    const cw = cont.clientWidth;
    const ch = cont.clientHeight;
    const s = Math.max(scale, 2);
    // Bias left so the pin isn't hidden behind the right-hand detail sheet.
    const targetX = cw * 0.36;
    const targetY = ch * 0.5;
    setSmooth(true);
    setScale(s);
    setTx(targetX - px * img.naturalWidth * s);
    setTy(targetY - py * img.naturalHeight * s);
  }

  function openPin(pin: { id: string; x: number; y: number }) {
    setActivePinId(pin.id);
    setHoverPin(null);
    focusPin(pin.x, pin.y);
  }

  function showHover(
    e: React.MouseEvent<HTMLButtonElement>,
    pin: { id: string; label: string; entityType: string },
  ) {
    const cont = containerRef.current;
    if (cont === null) return;
    const btnRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const contRect = cont.getBoundingClientRect();
    setHoverPin({
      id: pin.id,
      label: pin.label,
      entityType: pin.entityType,
      left: btnRect.left - contRect.left + btnRect.width / 2,
      top: btnRect.top - contRect.top,
    });
  }

  const canSubmitPin =
    draftType === 'observation'
      ? linkId === NEW
        ? newObs.title.trim() !== '' && newObs.categoryId !== ''
        : linkId !== ''
      : draftType === 'asset'
        ? linkId === NEW
          ? newAsset.name.trim() !== ''
          : linkId !== ''
        : photoFile !== null;

  async function submitPin() {
    if (draft === null || activePlanId === null || !canSubmitPin) return;
    setSubmitting(true);
    try {
      let entityType: EntityType = 'observation';
      let entityId: string;
      let label = '';

      if (draftType === 'observation') {
        entityType = 'observation';
        if (linkId === NEW) {
          const issue = await createIssue.mutateAsync({
            categoryId: newObs.categoryId,
            title: newObs.title.trim(),
            siteId,
            ...(newObs.description.trim() !== '' ? { description: newObs.description.trim() } : {}),
          });
          entityId = issue.issueId;
          label = newObs.title.trim();
          void utils.sites.getHub.invalidate({ id: siteId });
        } else {
          entityId = linkId;
          label = obsOptions.find((o) => o.id === linkId)?.label ?? '';
        }
      } else if (draftType === 'asset') {
        entityType = 'asset';
        if (linkId === NEW) {
          const asset = await createAsset.mutateAsync({
            name: newAsset.name.trim(),
            siteId,
            ...(newAsset.typeId !== '' ? { typeId: newAsset.typeId } : {}),
          });
          entityId = asset.assetId;
          label = newAsset.name.trim();
          void utils.sites.getHub.invalidate({ id: siteId });
        } else {
          entityId = linkId;
          label = assetOptions.find((a) => a.id === linkId)?.label ?? '';
        }
      } else {
        // photo — upload, register, auto-tag, pin
        entityType = 'media';
        if (photoFile === null) return;
        const form = new FormData();
        form.set('siteId', siteId);
        form.set('file', photoFile);
        const res = await fetch('/api/upload/site-media', { method: 'POST', body: form });
        if (!res.ok) {
          toast.error(t('mediaUploadError'));
          return;
        }
        const body = (await res.json()) as {
          storageKey: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
        };
        const media = await createMediaRow.mutateAsync({
          siteId,
          storageKey: body.storageKey,
          filename: body.filename,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes,
          ...(photoLabel.trim() !== '' ? { caption: photoLabel.trim() } : {}),
        });
        entityId = media.id;
        label = photoLabel.trim();
        // Auto-tag the photo (best-effort) then refresh the gallery.
        void fetch('/api/site-media/analyze', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: media.id }),
        }).then(() => utils.siteMedia.list.invalidate({ siteId }));
        void utils.sites.getHub.invalidate({ id: siteId });
      }

      await createPin.mutateAsync({
        planId: activePlanId,
        x: draft.x,
        y: draft.y,
        entityType,
        entityId,
        label,
      });
    } catch {
      toast.error(t('planPinError'));
    } finally {
      setSubmitting(false);
    }
  }

  function pinHref(pin: { entityType: string; entityId: string | null }): string | null {
    if (pin.entityId === null) return null;
    if (pin.entityType === 'observation')
      return `/${locale}/observations?observation=${pin.entityId}`;
    if (pin.entityType === 'asset') return `/${locale}/assets/${pin.entityId}`;
    if (pin.entityType === 'inspection') return `/${locale}/inspections/${pin.entityId}`;
    return null;
  }

  async function moveLevel(planId: string, dir: -1 | 1) {
    const ordered = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = ordered.findIndex((p) => p.id === planId);
    const swap = ordered[idx + dir];
    const self = ordered[idx];
    if (swap === undefined || self === undefined) return;
    await Promise.all([
      reorderPlan.mutateAsync({ id: self.id, sortOrder: swap.sortOrder }),
      reorderPlan.mutateAsync({ id: swap.id, sortOrder: self.sortOrder }),
    ]);
    await utils.sitePlans.listPlans.invalidate({ siteId });
  }

  if (plansLoading) {
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }

  // Highest level on top, matching an indoor-map floor selector.
  const levelsTopDown = [...plans].sort((a, b) => b.sortOrder - a.sortOrder);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('plansTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('plansSubtitle')}</p>
        </div>
        {canManage ? (
          <Button onClick={() => planFileRef.current?.click()} disabled={uploading}>
            <Upload className="mr-1.5 h-4 w-4" />
            {uploading ? t('planUploading') : t('planAdd')}
          </Button>
        ) : null}
        <input
          ref={planFileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif,image/avif,.heic,.heif,application/pdf"
          className="hidden"
          onChange={(e) => void handlePlanUpload(e.target.files)}
        />
      </div>

      {plans.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          {t('plansEmpty')}
        </div>
      ) : (
        <>
          {/* Type filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTypeFilter(null)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                typeFilter === null
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input text-muted-foreground hover:text-foreground',
              )}
            >
              {t('mediaAllTags')}
            </button>
            {FILTER_TYPES.map((ty2) => (
              <button
                key={ty2}
                type="button"
                onClick={() => setTypeFilter(ty2)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                  typeFilter === ty2
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input text-muted-foreground hover:text-foreground',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', ENTITY_META[ty2].color)} />
                {t(`pinType_${ty2}` as 'pinType_observation')}
              </button>
            ))}
          </div>

          {activePlan !== null && activePlan.kind === 'pdf' ? (
            <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
              <p>{t('planPdfNotice')}</p>
              <a
                href={fileUrl(activePlan.storageKey)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-primary underline"
              >
                {t('planOpenPdf')}
              </a>
            </div>
          ) : activePlan !== null ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  variant={addMode ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAddMode((v) => !v)}
                >
                  <MapPin className="mr-1.5 h-4 w-4" />
                  {addMode ? t('planDropCancel') : t('planDropPin')}
                </Button>
                <div className="ml-auto flex items-center gap-1">
                  {canManage ? (
                    <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}>
                      <Layers className="mr-1.5 h-4 w-4" />
                      {t('planManageLevels')}
                    </Button>
                  ) : null}
                  <Button variant="outline" size="icon" onClick={() => zoomBy(1 / 1.2)}>
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => zoomBy(1.2)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={resetView}>
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div
                ref={containerRef}
                className={cn(
                  'relative h-[62vh] overflow-hidden rounded-lg border bg-muted/40',
                  addMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing',
                )}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
              >
                <div
                  className={cn(
                    'absolute left-0 top-0 origin-top-left',
                    smooth ? 'transition-transform duration-500' : '',
                  )}
                  style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
                >
                  <div className="relative">
                    <img
                      ref={imgRef}
                      src={fileUrl(activePlan.storageKey)}
                      alt={activePlan.name}
                      className="block max-w-none select-none"
                      draggable={false}
                      onClick={onImageClick}
                    />
                    {visiblePins.map((pin) => {
                      const meta = ENTITY_META[(pin.entityType as EntityType) ?? 'note'];
                      const Icon = meta.Icon;
                      const isActive = pin.id === activePinId;
                      const dimmed = activePinId !== null && !isActive;
                      return (
                        <button
                          key={pin.id}
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            openPin(pin);
                          }}
                          onMouseEnter={(e) => showHover(e, pin)}
                          onMouseLeave={() => setHoverPin(null)}
                          className={cn(
                            'absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white shadow ring-2 transition-all',
                            meta.color,
                            meta.ring,
                            isActive ? 'z-20 h-8 w-8 ring-4 ring-offset-1' : 'h-6 w-6',
                            dimmed ? 'opacity-40' : 'opacity-100',
                          )}
                          style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                        >
                          <Icon className={isActive ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
                          {isActive ? (
                            <span
                              className={cn(
                                'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
                                meta.color,
                              )}
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Hover detail popup (unscaled, container-relative) */}
                {hoverPin !== null ? (
                  <div
                    className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full"
                    style={{ left: hoverPin.left, top: hoverPin.top - 8 }}
                  >
                    <div className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-lg">
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full',
                          ENTITY_META[(hoverPin.entityType as EntityType) ?? 'note'].color,
                        )}
                      />
                      <span className="font-medium">
                        {hoverPin.label.length > 0 ? hoverPin.label : t('planPinUntitled')}
                      </span>
                      <span className="opacity-70">
                        ·{' '}
                        {t(
                          `pinType_${(hoverPin.entityType as EntityType) ?? 'note'}` as 'pinType_observation',
                        )}
                      </span>
                    </div>
                  </div>
                ) : null}

                {/* Google-Maps-style vertical level selector. stopPropagation on
                    pointerdown so the container's pan handler doesn't capture the
                    pointer and swallow the button click. */}
                {plans.length > 1 ? (
                  <div
                    className="absolute right-3 top-3 flex max-h-[80%] flex-col overflow-y-auto rounded-lg border bg-background/95 shadow-sm backdrop-blur"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {levelsTopDown.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedPlanId(p.id);
                          setActivePinId(null);
                          resetView();
                        }}
                        className={cn(
                          'min-w-[3rem] px-3 py-2 text-sm font-medium transition-colors',
                          p.id === activePlanId
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted',
                        )}
                        title={p.name}
                      >
                        {p.name.length > 10 ? `${p.name.slice(0, 10)}…` : p.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{t('planHint')}</p>
            </div>
          ) : null}
        </>
      )}

      {/* Create-pin dialog */}
      <Dialog open={draft !== null} onOpenChange={(o) => !o && resetDraft()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('planNewPin')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pin-type">{t('planPinType')}</Label>
              <select
                id="pin-type"
                value={draftType}
                onChange={(e) => {
                  setDraftType(e.target.value as CreateType);
                  setLinkId('');
                }}
                className={SELECT_CLS}
              >
                {CREATE_TYPES.map((ty3) => (
                  <option key={ty3} value={ty3}>
                    {ty3 === 'observation'
                      ? t('pinType_observation')
                      : ty3 === 'asset'
                        ? t('pinType_asset')
                        : t('pinType_media')}
                  </option>
                ))}
              </select>
            </div>

            {/* Observation: link an open one or create a new one */}
            {draftType === 'observation' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="pin-obs">{t('planPinLink')}</Label>
                  <select
                    id="pin-obs"
                    value={linkId}
                    onChange={(e) => setLinkId(e.target.value)}
                    className={SELECT_CLS}
                  >
                    <option value="">{t('planPinLinkChoose')}</option>
                    <option value={NEW}>{t('planPinNewObservation')}</option>
                    {obsOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {linkId === NEW ? (
                  <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="obs-title">{t('planObsTitle')}</Label>
                      <Input
                        id="obs-title"
                        value={newObs.title}
                        onChange={(e) => setNewObs((s) => ({ ...s, title: e.target.value }))}
                        placeholder={t('planObsTitlePlaceholder')}
                        maxLength={500}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="obs-cat">{t('planObsCategory')}</Label>
                      <select
                        id="obs-cat"
                        value={newObs.categoryId}
                        onChange={(e) => setNewObs((s) => ({ ...s, categoryId: e.target.value }))}
                        className={SELECT_CLS}
                      >
                        <option value="">{t('planPinLinkChoose')}</option>
                        {(categories ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {(categories ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t('mediaNoCategory')}</p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="obs-desc">{t('planObsDescription')}</Label>
                      <textarea
                        id="obs-desc"
                        value={newObs.description}
                        onChange={(e) => setNewObs((s) => ({ ...s, description: e.target.value }))}
                        rows={2}
                        maxLength={2000}
                        className={SELECT_CLS}
                      />
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {/* Asset: link an existing one or create a new one */}
            {draftType === 'asset' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="pin-asset">{t('planPinLink')}</Label>
                  <select
                    id="pin-asset"
                    value={linkId}
                    onChange={(e) => setLinkId(e.target.value)}
                    className={SELECT_CLS}
                  >
                    <option value="">{t('planPinLinkChoose')}</option>
                    <option value={NEW}>{t('planPinNewAsset')}</option>
                    {assetOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
                {linkId === NEW ? (
                  <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="asset-name">{t('planAssetName')}</Label>
                      <Input
                        id="asset-name"
                        value={newAsset.name}
                        onChange={(e) => setNewAsset((s) => ({ ...s, name: e.target.value }))}
                        placeholder={t('planAssetNamePlaceholder')}
                        maxLength={500}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="asset-type">{t('planAssetType')}</Label>
                      <select
                        id="asset-type"
                        value={newAsset.typeId}
                        onChange={(e) => setNewAsset((s) => ({ ...s, typeId: e.target.value }))}
                        className={SELECT_CLS}
                      >
                        <option value="">{t('planAssetTypeNone')}</option>
                        {(assetTypeList ?? []).map((ty) => (
                          <option key={ty.id} value={ty.id}>
                            {ty.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {/* Photo: upload + auto-tag, no linking */}
            {draftType === 'photo' ? (
              <>
                <div className="space-y-1.5">
                  <Label>{t('planPhotoUpload')}</Label>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,image/avif,.heic,.heif"
                    className="hidden"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <ImageIcon className="mr-1.5 h-4 w-4" />
                    {photoFile !== null ? photoFile.name : t('planPhotoChoose')}
                  </Button>
                  <p className="text-xs text-muted-foreground">{t('planPhotoAutoTag')}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="photo-label">{t('planPinLabel')}</Label>
                  <Input
                    id="photo-label"
                    value={photoLabel}
                    onChange={(e) => setPhotoLabel(e.target.value)}
                    placeholder={t('mediaCaptionPlaceholder')}
                    maxLength={500}
                  />
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={resetDraft}>
              {t('mediaCompareCancel')}
            </Button>
            <Button onClick={() => void submitPin()} disabled={submitting || !canSubmitPin}>
              {draftType !== 'photo' && linkId === NEW ? t('planPinCreateAdd') : t('planPinSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage levels dialog */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('planManageLevels')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {[...plans]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((p, idx, arr) => (
                <div key={p.id} className="flex items-center gap-2">
                  <Input
                    defaultValue={p.name}
                    className="flex-1"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v.length > 0 && v !== p.name) renamePlan.mutate({ id: p.id, name: v });
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={idx === 0 || reorderPlan.isPending}
                    onClick={() => void moveLevel(p.id, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={idx === arr.length - 1 || reorderPlan.isPending}
                    onClick={() => void moveLevel(p.id, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (window.confirm(t('planDeleteConfirm'))) archivePlan.mutate({ id: p.id });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setManageOpen(false)}>{t('planManageDone')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pin detail side sheet */}
      <Sheet open={activePin !== null} onOpenChange={(o) => !o && setActivePinId(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {activePin !== null ? (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-white',
                    ENTITY_META[(activePin.entityType as EntityType) ?? 'note'].color,
                  )}
                >
                  {(() => {
                    const Icon = ENTITY_META[(activePin.entityType as EntityType) ?? 'note'].Icon;
                    return <Icon className="h-4 w-4" />;
                  })()}
                </span>
                <div>
                  <div className="font-medium">
                    {activePin.label.length > 0 ? activePin.label : t('planPinUntitled')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t(
                      `pinType_${(activePin.entityType as EntityType) ?? 'note'}` as 'pinType_observation',
                    )}
                  </div>
                </div>
              </div>

              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t('planPinLocatedHint')}
              </p>

              {pinHref(activePin) !== null ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={pinHref(activePin) as string}>{t('planPinView')}</Link>
                </Button>
              ) : null}

              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={archivePin.isPending}
                  onClick={() => {
                    if (window.confirm(t('plans.deletePinConfirm')))
                      archivePin.mutate({ id: activePin.id });
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  {t('planPinDelete')}
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
